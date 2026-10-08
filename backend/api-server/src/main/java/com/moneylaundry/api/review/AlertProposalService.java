package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Affected owners vote independently; scope changes require unanimous consent. */
@Service
public class AlertProposalService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final ReviewService reviews;

  public AlertProposalService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, ReviewService reviews) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.reviews = reviews;
  }

  private void authorize(long proposal, long user) {
    if (!"STAFF".equals(reviews.actor(user).get("role"))
        || !jdbc.queryForObject(
            "select exists(select 1 from review.alert_proposal_cases pc join review.alerts a using(alert_id) where pc.proposal_id=? and a.assignee_id=?)",
            Boolean.class,
            proposal,
            user))
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "제안의 현재 담당자만 접근할 수 있습니다.");
  }

  public Map<String, Object> detail(long proposal, long user) {
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          authorize(proposal, user);
          var out =
              new LinkedHashMap<>(
                  jdbc.queryForMap(
                      "select p.*,v.evidence from review.alert_change_proposals p join review.alert_versions v on v.alert_id=p.target_alert_id and v.version=p.proposed_version where proposal_id=?",
                      proposal));
          out.put("evidence", object(out.get("evidence")));
          out.remove("payload");
          out.put(
              "cases",
              jdbc.queryForList(
                  "select * from review.alert_proposal_cases where proposal_id=? order by alert_id",
                  proposal));
          return out;
        });
  }

  public record Vote(
      UUID requestId,
      long expectedProposalRevision,
      String decision,
      Map<Long, Long> caseRevisions,
      String comment) {}

  public Map<String, Object> vote(long proposal, long user, Vote vote) {
    if (vote.requestId() == null
        || !Set.of("ACCEPT", "REJECT").contains(Objects.toString(vote.decision(), ""))
        || vote.caseRevisions() == null
        || vote.comment() == null
        || vote.comment().isBlank()
        || vote.comment().length() > 4000) throw AnalysisService.invalid();
    var result =
        tx.execute(
            s -> {
              com.moneylaundry.api.analysis.AnalysisRunService.integrationLock(jdbc);
              jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
              jdbc.queryForList("select id from ops.business_clock where id for update");
              authorize(proposal, user);
              var payload = Map.of("proposalId", proposal, "vote", vote);
              var cached =
                  jdbc.queryForList(
                      "select payload,response from review.requests where actor_id=? and request_id=?",
                      user,
                      vote.requestId());
              if (!cached.isEmpty()) {
                if (!object(cached.getFirst().get("payload")).equals(object(encode(payload))))
                  throw ApiException.invalidTransition("같은 요청 번호의 내용이 다릅니다.");
                return object(cached.getFirst().get("response"));
              }
              var p =
                  jdbc.queryForMap(
                      "select * from review.alert_change_proposals where proposal_id=? for update",
                      proposal);
              var cases =
                  jdbc.queryForList(
                      "select pc.*,a.revision,a.published_version,a.assignee_id as current_owner,a.status,a.merged_into_alert_id from review.alert_proposal_cases pc join review.alerts a using(alert_id) where pc.proposal_id=? order by a.alert_id for update of a",
                      proposal);
              if (!"OPEN".equals(p.get("status"))
                  || number(p.get("revision")) != vote.expectedProposalRevision())
                throw ApiException.invalidTransition("제안이 변경됐습니다. 다시 조회하세요.");
              boolean stale =
                  cases.stream()
                      .anyMatch(
                          c ->
                              !"OPEN".equals(c.get("status"))
                                  || c.get("merged_into_alert_id") != null
                                  || number(c.get("expected_revision")) != number(c.get("revision"))
                                  || number(c.get("expected_published_version"))
                                      != number(c.get("published_version"))
                                  || number(c.get("assignee_id"))
                                      != number(c.get("current_owner")));
              if (stale || cases.isEmpty() || !new AlertPublisher(jdbc).proposalInputCurrent(p)) {
                jdbc.update(
                    "update review.alert_change_proposals set status='SUPERSEDED',revision=revision+1,resolved_at=? where proposal_id=?",
                    Timestamp.from(time.now()),
                    proposal);
                audit(
                    p,
                    user,
                    "PROPOSAL_SUPERSEDED",
                    vote.comment(),
                    Map.of("proposalId", proposal, "votes", cases));
                return Map.<String, Object>of("conflict", "PROPOSAL_SUPERSEDED");
              }
              var ownedIds = new HashSet<Long>();
              for (var c : cases)
                if (number(c.get("current_owner")) == user) {
                  long id = number(c.get("alert_id"));
                  ownedIds.add(id);
                  if (!Objects.equals(vote.caseRevisions().get(id), number(c.get("revision"))))
                    throw ApiException.invalidTransition("사건이 변경됐습니다. 다시 조회하세요.");
                }
              if (!vote.caseRevisions().keySet().equals(ownedIds)) throw AnalysisService.invalid();
              Timestamp at = Timestamp.from(time.now());
              for (long id : ownedIds) {
                jdbc.update(
                    "update review.alerts set review_started_at=coalesce(review_started_at,?),review_started_by=coalesce(review_started_by,?) where alert_id=?",
                    at,
                    user,
                    id);
                jdbc.update(
                    "update review.alert_proposal_cases set response=?,response_actor=?,response_at=? where proposal_id=? and alert_id=?",
                    "ACCEPT".equals(vote.decision()) ? "APPROVED" : "REJECTED",
                    user,
                    at,
                    proposal,
                    id);
              }
              String state = "REJECT".equals(vote.decision()) ? "REJECTED" : "OPEN";
              if ("OPEN".equals(state)
                  && jdbc.queryForObject(
                          "select count(*) from review.alert_proposal_cases where proposal_id=? and response<>'APPROVED'",
                          Integer.class,
                          proposal)
                      == 0) {
                new AlertPublisher(jdbc).accept(p, at);
                state = "ACCEPTED";
              }
              jdbc.update(
                  "update review.alert_change_proposals set status=?,revision=revision+1,resolved_at=? where proposal_id=?",
                  state,
                  "OPEN".equals(state) ? null : at,
                  proposal);
              audit(
                  p,
                  user,
                  "PROPOSAL_" + vote.decision(),
                  vote.comment(),
                  Map.of("proposalId", proposal, "caseIds", ownedIds, "status", state));
              var response =
                  Map.<String, Object>of(
                      "proposalId",
                      proposal,
                      "status",
                      state,
                      "revision",
                      number(p.get("revision")) + 1);
              jdbc.update(
                  "insert into review.requests values(?,?,?::jsonb,?::jsonb)",
                  user,
                  vote.requestId(),
                  encode(payload),
                  encode(response));
              return response;
            });
    if (result.containsKey("conflict"))
      throw ApiException.invalidTransition("사건이 변경되어 제안이 만료됐습니다. 새 제안을 확인하세요.");
    return result;
  }

  private void audit(
      Map<String, Object> proposal, long actor, String action, String comment, Object snapshot) {
    jdbc.update(
        "insert into review.events(alert_id,actor_id,action,comment,business_at,snapshot) values(?,?,?,?,?,?::jsonb)",
        proposal.get("target_alert_id"),
        actor,
        action,
        comment,
        Timestamp.from(time.now()),
        encode(snapshot));
  }
}
