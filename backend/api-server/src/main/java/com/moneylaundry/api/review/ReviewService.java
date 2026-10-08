package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReviewService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final TransactionTemplate readTx;
  private final BusinessTime time;
  private final AlertQueryService alerts;

  public ReviewService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, AlertQueryService alerts) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.readTx = new TransactionTemplate(tx.getTransactionManager());
    this.readTx.setReadOnly(true);
    this.readTx.setIsolationLevel(
        org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
    this.time = time;
    this.alerts = alerts;
  }

  public long userId(java.security.Principal principal) {
    if (principal == null)
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
    var ids =
        jdbc.queryForList(
            "select user_id from core.users where username=? and role in ('STAFF','ADMIN')",
            Long.class,
            principal.getName());
    if (ids.isEmpty())
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
    return ids.getFirst();
  }

  public Map<String, Object> actor(long id) {
    time.workbenchOnly();
    var users =
        jdbc.queryForList(
            "select user_id as id,name,role from core.users where user_id=? and role in ('STAFF','ADMIN')",
            id);
    if (users.isEmpty())
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "시연 직원을 선택하세요.");
    return users.getFirst();
  }

  public List<Map<String, Object>> users() {
    time.workbenchOnly();
    return jdbc.queryForList(
        "select user_id as id,name,role from core.users where role in ('STAFF','ADMIN') order by user_id");
  }

  private Map<String, Object> caseRow(long id) {
    var found =
        jdbc.queryForList(
            "select c.*,u.name as assignee_name from review.cases c join core.users u on u.user_id=c.assignee_id where c.case_id=?",
            id);
    if (found.isEmpty()) throw ApiException.notFound("사건이 없습니다.");
    return found.getFirst();
  }

  private void editable(Map<String, Object> c, long user) {
    if (c.get("merged_into_alert_id") != null)
      throw ApiException.invalidTransition(
          "병합된 Alert입니다. 현재 Alert " + c.get("merged_into_alert_id") + "를 조회하세요.");
    var who = actor(user);
    if (number(c.get("assignee_id")) != user || !"STAFF".equals(who.get("role")))
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "담당 직원만 변경할 수 있습니다.");
    if (!"OPEN".equals(c.get("status"))) throw ApiException.invalidTransition("종결 사건은 변경할 수 없습니다.");
  }

  private List<Map<String, Object>> initial(Map<String, Object> c) {
    return initial(number(c.get("alert_id")), null);
  }

  private List<Map<String, Object>> initial(long alertId, Integer version) {
    var d = alerts.detail(alertId, version);
    double threshold =
        jdbc.queryForObject(
            "select b.threshold_value from analysis.runs r join analysis.jobs b on b.job_id=r.job_id where r.run_id=?::uuid",
            Double.class,
            d.get("runId").toString());
    CaseSummary.annotateSuspicion(d, threshold);
    var members = new ArrayList<Map<String, Object>>();
    for (var t : rows(d.get("transactions"))) {
      var evidence = new LinkedHashMap<>(t);
      var m = new LinkedHashMap<String, Object>();
      m.put("txId", t.get("txId"));
      m.put("reviewRole", "CONTEXT".equals(t.get("role")) ? "CONTEXT" : "SUBJECT");
      m.put("state", "PENDING");
      m.put("decision", null);
      m.put("transaction", evidence);
      m.put(
          "sources",
          new ArrayList<>(List.of(Map.of("alertId", alertId, "version", d.get("version")))));
      members.add(m);
    }
    String sourceType = CaseSummary.summarize(members).get("primaryType").toString();
    for (var m : members)
      m.put(
          "sources",
          new ArrayList<>(
              List.of(
                  Map.of(
                      "alertId",
                      alertId,
                      "version",
                      d.get("version"),
                      "primaryType",
                      sourceType))));
    return new ArrayList<>(
        List.of(
            new LinkedHashMap<>(
                Map.of(
                    "groupId",
                    0L,
                    "label",
                    "Alert " + alertId,
                    "revision",
                    0L,
                    "evidenceVersion",
                    d.get("version"),
                    "members",
                    members))));
  }

  private List<Map<String, Object>> groups(Map<String, Object> c) {
    boolean episode = "EPISODE".equals(c.get("kind"));
    var found =
        jdbc.queryForList(
            episode
                ? "select group_id as \"groupId\",label,revision,alert_version as \"evidenceVersion\",decision,alert_id as \"sourceAlertId\" from review.episode_alerts where episode_id=? order by group_id"
                : "select group_id as \"groupId\",label,revision,evidence_version as \"evidenceVersion\",decision,alert_id as \"sourceAlertId\" from review.alert_groups where alert_id=? order by group_id",
            c.get("case_id"));
    for (var g : found) {
      var evidence = new HashMap<Integer, Map<Long, Map<String, Object>>>();
      var members = new ArrayList<Map<String, Object>>();
      var stored =
          jdbc.queryForList(
              "select tx_id,evidence_version,review_role,state,decision from "
                  + (episode ? "review.episode_members" : "review.effective_members")
                  + " where group_id=? order by tx_id",
              g.get("groupId"));
      for (var row : stored) {
        int version = ((Number) row.get("evidence_version")).intValue();
        var byId =
            evidence.computeIfAbsent(
                version,
                key -> {
                  var map = new HashMap<Long, Map<String, Object>>();
                  for (var m :
                      rows(initial(number(g.get("sourceAlertId")), key).getFirst().get("members")))
                    map.put(number(m.get("txId")), m);
                  return map;
                });
        var m = new LinkedHashMap<>(byId.get(number(row.get("tx_id"))));
        m.put("reviewRole", row.get("review_role"));
        m.put("state", row.get("state"));
        m.put("decision", row.get("decision"));
        members.add(m);
      }
      g.put("members", members);
    }
    if ("ALERT".equals(c.get("kind")) && found.isEmpty()) return initial(c);
    return found;
  }

  private long revision(Map<String, Object> c) {
    long base = number(c.get("revision"));
    if ("ALERT".equals(c.get("kind")))
      return base * 1000000L
          + number(alerts.detail(number(c.get("alert_id")), null).get("version"));
    return base;
  }

  private List<Map<String, Object>> all(List<Map<String, Object>> groups) {
    var result = new ArrayList<Map<String, Object>>();
    for (var g : groups) result.addAll(rows(g.get("members")));
    return result;
  }

  public Map<String, Object> detail(long id) {
    return detail(id, true);
  }

  private Map<String, Object> detail(long id, boolean includeHistory) {
    time.workbenchOnly();
    var c = caseRow(id);
    var gs = groups(c);
    var members = all(gs);
    var out = new LinkedHashMap<String, Object>();
    out.put("caseId", id);
    out.put("kind", c.get("kind"));
    out.put("alertId", c.get("alert_id"));
    out.put("status", c.get("status"));
    out.put("outcome", c.get("outcome"));
    out.put("revision", revision(c));
    out.put("scopeRevision", c.get("revision"));
    if ("ALERT".equals(c.get("kind"))) {
      out.put("publishedVersion", c.get("published_version"));
      out.put("reviewStartedAt", c.get("review_started_at"));
      out.put(
          "relatedFlows",
          alerts.relatedFlows(
              id,
              rows(
                  jdbc.queryForObject(
                      "select coalesce(evidence->'boundaryWitnesses','[]'::jsonb)::text from review.alert_versions where alert_id=? and version=?",
                      String.class,
                      id,
                      c.get("published_version")))));
      // Keep employee judgments in storage; a new publication changes only current scope.
      out.put(
          "withdrawnMembers",
          jdbc.queryForList(
              "select m.tx_id as \"txId\",m.evidence_version as \"evidenceVersion\",m.review_role as \"reviewRole\",m.state,m.decision from review.alert_members m where m.alert_id=? and not exists(select 1 from review.alert_transactions t where t.alert_id=m.alert_id and t.version=? and t.tx_id=m.tx_id) order by m.group_id,m.tx_id",
              id,
              c.get("published_version")));
      out.put(
          "canonicalAlertId",
          c.get("merged_into_alert_id") == null ? id : c.get("merged_into_alert_id"));
      out.put("resolution", c.get("merged_into_alert_id") == null ? c.get("outcome") : "MERGED");
      out.put(
          "pendingProposalIds",
          jdbc.queryForList(
              "select p.proposal_id from review.alert_proposal_cases pc join review.alert_change_proposals p using(proposal_id) where pc.alert_id=? and p.status='OPEN' order by p.proposal_id",
              Long.class,
              id));
      out.put(
          "relations",
          jdbc.queryForList(
              "select source_alert_id,target_alert_id,kind,event_id from review.alert_lineage where source_alert_id=? or target_alert_id=? order by event_id",
              id,
              id));
    }
    out.put("assigneeId", c.get("assignee_id"));
    out.put("assigneeName", c.get("assignee_name"));
    for (String key : List.of("created_at", "assigned_at", "closed_at"))
      out.put(
          switch (key) {
            case "created_at" -> "createdAt";
            case "assigned_at" -> "assignedAt";
            default -> "closedAt";
          },
          c.get(key) == null ? null : ((Timestamp) c.get(key)).toInstant().toString());
    out.put(
        "ageDays",
        Math.max(
            0,
            Duration.between(((Timestamp) c.get("created_at")).toInstant(), time.now()).toDays()));
    out.put("groups", gs);
    out.put("summary", CaseSummary.summarize(members));
    out.put(
        "pendingCount",
        members.stream()
            .filter(
                m ->
                    "OPEN".equals(c.get("status"))
                        && "SUBJECT".equals(m.get("reviewRole"))
                        && "PENDING".equals(m.get("state")))
            .map(m -> number(m.get("txId")))
            .distinct()
            .count());
    var sourceIds = new TreeSet<Long>();
    for (var m : members)
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state")))
        for (var source : rows(m.get("sources"))) sourceIds.add(number(source.get("alertId")));
    if ("EPISODE".equals(c.get("kind"))) {
      sourceIds.clear();
      sourceIds.addAll(
          jdbc.queryForList(
              "select alert_id from review.episode_alerts where episode_id=? order by alert_id",
              Long.class,
              id));
    }
    out.put(
        "episodeId",
        "ALERT".equals(c.get("kind"))
            ? jdbc
                .queryForList(
                    "select episode_id from review.episode_alerts where alert_id=?",
                    Long.class,
                    c.get("alert_id"))
                .stream()
                .findFirst()
                .orElse(null)
            : null);
    out.put("sourceAlertIds", sourceIds);
    var types = new TreeSet<String>();
    for (var m : members)
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state")))
        for (var source : rows(m.get("sources")))
          if (source.get("primaryType") != null) types.add(source.get("primaryType").toString());
    out.put("primaryTypes", types);
    if (includeHistory) {
      var accountIds = new TreeSet<String>();
      for (var member : members) {
        if (Set.of("EXCLUDED", "TRANSFERRED").contains(member.get("state"))) continue;
        var transaction = object(member.get("transaction"));
        for (String key : List.of("fromAccountId", "toAccountId")) {
          if (transaction.get(key) != null) accountIds.add(transaction.get(key).toString());
        }
      }
      out.put("accounts", new LedgerQueryService(jdbc).accounts(accountIds));
      out.put(
          "history",
          jdbc.queryForList(
              "select e.event_id as \"eventId\",e.action,e.comment,e.business_at as \"businessAt\",e.recorded_at as \"recordedAt\",u.name as actor from review.event_history e left join core.users u on u.user_id=e.actor_id where case_id=? order by event_id desc",
              id));
      var detachments =
          jdbc.queryForList(
              "select event_id as \"eventId\",action,comment,business_at as \"businessAt\",snapshot::text as snapshot from review.event_history where case_id=? and action in ('UNLINK','DISSOLVE') order by event_id desc",
              id);
      for (var entry : detachments) entry.put("snapshot", object(entry.get("snapshot")));
      out.put("detachments", detachments);
    }
    if (includeHistory && !members.isEmpty()) {
      var ids = members.stream().map(m -> number(m.get("txId"))).distinct().toList();
      var args = new ArrayList<Object>(ids);
      args.add(id);
      out.put(
          "relatedDecisions",
          jdbc.queryForList(
              "select c.case_id as \"caseId\",c.kind,c.status,m.group_id as \"groupId\",m.tx_id::text as \"txId\",m.decision "
                  + "from review.saved_members m join review.cases c using(case_id) "
                  + "where m.state='DECIDED' and m.tx_id in ("
                  + String.join(",", Collections.nCopies(ids.size(), "?"))
                  + ") and c.case_id<>? order by c.case_id,m.group_id",
              args.toArray()));
    }
    return out;
  }

  public Map<String, Object> list(
      String kind, String status, Long assignee, LocalDate from, LocalDate to, int page, int size) {
    return list(kind, status, assignee, from, to, page, size, ReviewCaseFilter.EMPTY);
  }

  public Map<String, Object> list(
      String kind,
      String status,
      Long assignee,
      LocalDate from,
      LocalDate to,
      int page,
      int size,
      ReviewCaseFilter filter) {
    time.workbenchOnly();
    AnalysisService.validatePage(page, size);
    if (!Set.of("ALERT", "EPISODE").contains(kind)
        || (status != null && !Set.of("OPEN", "CLOSED").contains(status)))
      throw AnalysisService.invalid();
    var args = new ArrayList<Object>(List.of(kind));
    String sql = " where c.kind=?";
    if (status != null) {
      sql += " and c.status=?";
      args.add(status);
    }
    if (assignee != null) {
      sql += " and c.assignee_id=?";
      args.add(assignee);
    }
    if (from != null) {
      sql += " and c.created_at>=?";
      args.add(Timestamp.from(from.atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (to != null) {
      sql += " and c.created_at<?";
      args.add(Timestamp.from(to.plusDays(1).atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (from != null && to != null && from.isAfter(to)) throw AnalysisService.invalid();
    sql += filter.append(args, time.now());
    String countSource = filter.risk() == null ? ReviewCaseSql.PUBLISHED : ReviewCaseSql.WITH_RISK;
    long count =
        jdbc.queryForObject(
            "select count(*) from " + countSource + " c" + sql, Long.class, args.toArray());
    if (count == 0)
      return Map.of(
          "content", List.of(), "page", page, "size", size, "totalElements", 0L, "totalPages", 0L);
    args.add(size);
    args.add((long) page * size);
    var pageRows =
        jdbc.queryForList(
            "select "
                + ReviewCaseSql.LIST_COLUMNS
                + ",u.name as assignee_name,(select ea.episode_id from review.episode_alerts ea where ea.alert_id=c.alert_id limit 1) as linked_episode_id from "
                + ReviewCaseSql.WITH_RISK
                + " c join core.users u on u.user_id=c.assignee_id"
                + sql
                + " order by risk desc,c.created_at desc,case_id desc limit ? offset ?",
            args.toArray());
    var content = new ArrayList<Map<String, Object>>();
    Instant now = time.now();
    for (var row : pageRows) content.add(listItem(row, now));
    return Map.of(
        "content",
        content,
        "page",
        page,
        "size",
        size,
        "totalElements",
        count,
        "totalPages",
        (count + size - 1) / size);
  }

  private Map<String, Object> listItem(Map<String, Object> c, Instant now) {
    var out = new LinkedHashMap<String, Object>();
    boolean alert = "ALERT".equals(c.get("kind"));
    for (var field :
        Map.of(
                "caseId",
                "case_id",
                "alertId",
                "alert_id",
                "assigneeId",
                "assignee_id",
                "assigneeName",
                "assignee_name",
                "episodeId",
                "linked_episode_id",
                "scopeRevision",
                "revision")
            .entrySet()) out.put(field.getKey(), c.get(field.getValue()));
    for (String key : List.of("kind", "status", "outcome")) out.put(key, c.get(key));
    out.put(
        "revision",
        number(c.get("revision")) * (alert ? 1000000L : 1L)
            + (alert ? number(c.get("published_version")) : 0L));
    if (alert) {
      out.put("publishedVersion", c.get("published_version"));
      out.put("reviewStartedAt", c.get("review_started_at"));
      out.put("canonicalAlertId", c.get("alert_id"));
      out.put("resolution", c.get("outcome"));
    }
    for (var field :
        Map.of("createdAt", "created_at", "assignedAt", "assigned_at", "closedAt", "closed_at")
            .entrySet()) {
      var value = (Timestamp) c.get(field.getValue());
      out.put(field.getKey(), value == null ? null : value.toInstant().toString());
    }
    out.put(
        "ageDays",
        Math.max(0, Duration.between(((Timestamp) c.get("created_at")).toInstant(), now).toDays()));
    var summary = object(c.get("summary"));
    for (String key : List.of("pendingCount", "sourceAlertIds", "primaryTypes"))
      out.put(key, summary.remove(key));
    summary.remove("hasScoredSeed");
    out.put("summary", summary);
    return out;
  }

  private void updateCase(long id, String assignments, Object... values) {
    boolean episode = "EPISODE".equals(caseRow(id).get("kind"));
    var args = new ArrayList<Object>(Arrays.asList(values));
    args.add(id);
    jdbc.update(
        "update "
            + (episode ? "review.episodes" : "review.alerts")
            + " set "
            + assignments
            + " where "
            + (episode ? "episode_id" : "alert_id")
            + "=?",
        args.toArray());
    new CaseSummaryStore(jdbc).refresh(id);
  }

  private void save(long id, List<Map<String, Object>> gs) {
    boolean episode = "EPISODE".equals(caseRow(id).get("kind"));
    for (var g : gs) {
      long alertId = episode ? number(g.get("sourceAlertId")) : id;
      if (number(g.get("groupId")) == 0) {
        long gid =
            jdbc.queryForObject(
                episode
                    ? "insert into review.episode_alerts(episode_id,alert_id,label,alert_version) values(?,?,?,?) returning group_id"
                    : "insert into review.alert_groups(alert_id,label,evidence_version) values(?,?,?) returning group_id",
                Long.class,
                episode
                    ? new Object[] {id, alertId, g.get("label"), g.get("evidenceVersion")}
                    : new Object[] {id, g.get("label"), g.get("evidenceVersion")});
        g.put("groupId", gid);
      } else {
        jdbc.update(
            episode
                ? "update review.episode_alerts set decision=?,alert_version=?,revision=revision+1 where group_id=? and episode_id=?"
                : "update review.alert_groups set decision=?,evidence_version=?,revision=revision+1 where group_id=? and alert_id=?",
            g.get("decision"),
            g.get("evidenceVersion"),
            g.get("groupId"),
            id);
      }
      String table = episode ? "review.episode_members" : "review.alert_members";
      var values = new ArrayList<Object[]>();
      for (var m : rows(g.get("members"))) {
        var source = rows(m.get("sources")).getFirst();
        if (number(source.get("alertId")) != alertId)
          throw new IllegalStateException("MEMBER_SOURCE_MISMATCH");
        values.add(
            new Object[] {
              g.get("groupId"),
              alertId,
              m.get("txId"),
              source.get("version"),
              m.get("reviewRole"),
              m.get("state"),
              m.get("decision")
            });
      }
      jdbc.batchUpdate(
          "insert into "
              + table
              + "(group_id,alert_id,tx_id,evidence_version,review_role,state,decision) values(?,?,?,?,?,?,?) "
              + "on conflict(group_id,tx_id) do update set evidence_version=excluded.evidence_version,review_role=excluded.review_role,state=excluded.state,decision=excluded.decision",
          values);
    }
    updateCase(id, "revision=revision+1");
  }

  private void event(long id, long user, String action, String comment, Object snapshot) {
    boolean episode = "EPISODE".equals(caseRow(id).get("kind"));
    if (!episode)
      jdbc.update(
          "update review.alerts set review_started_at=coalesce(review_started_at,?),review_started_by=coalesce(review_started_by,?) where alert_id=?",
          Timestamp.from(time.now()),
          user,
          id);
    jdbc.update(
        "insert into review.events("
            + (episode ? "episode_id" : "alert_id")
            + ",actor_id,action,comment,business_at,snapshot) values(?,?,?,?,?,?::jsonb)",
        id,
        user,
        action,
        comment,
        Timestamp.from(time.now()),
        encode(snapshot));
  }

  private Map<String, Object> moneyScope(long id) {
    var found =
        jdbc.queryForList(
            "select snapshot::text from review.event_history where case_id=? and action='MONEY_SCOPE' order by event_id desc limit 1",
            id);
    return found.isEmpty() ? null : object(found.getFirst().get("snapshot"));
  }

  public Map<String, Object> money(long id, int minutes) {
    time.workbenchOnly();
    if (!Set.of(5, 15, 30, 60, 180, 360, 1440).contains(minutes)) throw AnalysisService.invalid();
    return readTx.execute(
        s -> {
          // All facts below share one MVCC snapshot. Reading the current money
          // view must not queue behind an unrelated upload/publication lock.
          var c = caseRow(id);
          if ("CLOSED".equals(c.get("status"))) {
            var fixed =
                jdbc.queryForList(
                    "select snapshot::text from review.event_history where case_id=? and action='MONEY_SNAPSHOT' order by event_id desc limit 1",
                    id);
            if (!fixed.isEmpty()) return object(fixed.getFirst().get("snapshot"));
            return Map.<String, Object>of(
                "available",
                false,
                "reason",
                "NO_CLOSED_SNAPSHOT",
                "selectedAccounts",
                List.of(),
                "candidateAccounts",
                List.of(),
                "delayMinutes",
                180);
          }
          return new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), minutes);
        });
  }

  public record MoneyScope(UUID requestId, long revision, List<UUID> accounts, String comment) {}

  public Map<String, Object> setMoneyScope(long id, long user, MoneyScope scope) {
    actor(user);
    if (scope.requestId() == null
        || scope.accounts() == null
        || scope.accounts().size() > 1000
        || scope.accounts().stream().anyMatch(Objects::isNull)
        || scope.comment() == null
        || scope.comment().isBlank()
        || scope.comment().length() > 4000) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          var payload = Map.of("action", "MONEY_SCOPE", "caseId", id, "body", scope);
          var cached =
              jdbc.queryForList(
                  "select payload::text,response::text from review.requests where actor_id=? and request_id=?",
                  user,
                  scope.requestId());
          if (!cached.isEmpty()) {
            if (!object(cached.getFirst().get("payload")).equals(object(encode(payload))))
              throw ApiException.invalidTransition("같은 요청 번호의 내용이 다릅니다.");
            return object(cached.getFirst().get("response"));
          }
          var c = caseRow(id);
          editable(c, user);
          if (revision(c) != scope.revision())
            throw ApiException.invalidTransition("사건이 변경됐습니다. 다시 조회하세요.");
          for (var account : new HashSet<>(scope.accounts()))
            if (!jdbc.queryForObject(
                "select exists(select 1 from core.accounts where service_account_id=?)",
                Boolean.class,
                account)) throw AnalysisService.invalid();
          event(id, user, "MONEY_SCOPE", scope.comment(), Map.of("accounts", scope.accounts()));
          updateCase(id, "revision=revision+1");
          var response = Map.<String, Object>of("caseId", id, "revision", revision(caseRow(id)));
          jdbc.update(
              "insert into review.requests values(?,?,?::jsonb,?::jsonb)",
              user,
              scope.requestId(),
              encode(payload),
              encode(response));
          return response;
        });
  }

  public record Selection(long caseId, long revision, long groupId, List<Long> txIds) {}

  public record Command(
      UUID requestId,
      String action,
      List<Selection> selections,
      Long targetCaseId,
      Long targetRevision,
      Long targetGroupId,
      String decision,
      String comment) {}

  public Map<String, Object> command(long user, Command cmd) {
    actor(user);
    if (cmd.requestId() == null
        || cmd.action() == null
        || cmd.comment() == null
        || cmd.comment().isBlank()
        || cmd.comment().length() > 4000
        || cmd.selections() == null
        || cmd.selections().isEmpty()
        || cmd.selections().size() > 100
        || cmd.selections().stream().anyMatch(Objects::isNull)) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          // Shared ordering serializes local clock updates and multi-case writes without deadlocks.
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          jdbc.queryForList("select id from ops.business_clock where id for update");
          var cached =
              jdbc.queryForList(
                  "select payload::text,response::text from review.requests where actor_id=? and request_id=?",
                  user,
                  cmd.requestId());
          if (!cached.isEmpty()) {
            if (!object(cached.getFirst().get("payload")).equals(object(encode(cmd))))
              throw ApiException.invalidTransition("같은 요청 번호의 내용이 다릅니다.");
            return object(cached.getFirst().get("response"));
          }
          var loaded = new LinkedHashMap<Long, List<Map<String, Object>>>();
          var cases = new LinkedHashMap<Long, Map<String, Object>>();
          for (var sel : cmd.selections()) {
            var c = caseRow(sel.caseId());
            editable(c, user);
            if (revision(c) != sel.revision())
              throw ApiException.invalidTransition("사건이 변경됐습니다. 다시 조회하세요.");
            cases.put(sel.caseId(), c);
            loaded.computeIfAbsent(sel.caseId(), id -> groups(c));
          }

          if ("TRANSFER".equals(cmd.action())) return transferWholeAlerts(user, cmd, cases, loaded);
          if ("UNLINK".equals(cmd.action())) return unlinkAlerts(user, cmd, cases, loaded);
          if (Set.of("MOVE", "SPLIT").contains(cmd.action()))
            throw ApiException.invalidTransition("Alert를 분할하거나 다른 Episode로 부분 이동할 수 없습니다.");
          Long target = null;
          for (var sel : cmd.selections()) {
            var gs = loaded.get(sel.caseId());
            boolean episode = "EPISODE".equals(cases.get(sel.caseId()).get("kind"));
            if ("CLOSE".equals(cmd.action()) && cmd.decision() != null) {
              if (episode
                  || !Set.of("NORMAL", "SUSPICIOUS").contains(cmd.decision())
                  || sel.txIds() == null
                  || !sel.txIds().isEmpty()
                  || cases.size() != cmd.selections().size()) throw AnalysisService.invalid();
              var subjects =
                  all(gs).stream()
                      .filter(
                          m ->
                              "SUBJECT".equals(m.get("reviewRole"))
                                  && !Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state")))
                      .toList();
              if (subjects.isEmpty()) throw ApiException.invalidTransition("판정할 조사 대상이 없습니다.");
              event(sel.caseId(), user, "BEFORE_RESOLUTION", cmd.comment(), gs);
              for (var m : subjects) {
                m.put("state", "DECIDED");
                m.put("decision", cmd.decision());
              }
            }
            if (Set.of("CLOSE", "COMMENT", "REVIEW_START").contains(cmd.action())) continue;
            var g =
                gs.stream()
                    .filter(x -> number(x.get("groupId")) == sel.groupId())
                    .findFirst()
                    .orElseThrow(AnalysisService::invalid);
            var members = rows(g.get("members"));
            if (sel.txIds() == null
                || sel.txIds().isEmpty()
                || new HashSet<>(sel.txIds()).size() != sel.txIds().size())
              throw AnalysisService.invalid();
            var selected =
                members.stream().filter(m -> sel.txIds().contains(number(m.get("txId")))).toList();
            if (selected.size() != sel.txIds().size()
                || selected.stream()
                    .anyMatch(
                        m ->
                            !"PENDING".equals(m.get("state"))
                                && !(("RECONSIDER".equals(cmd.action())
                                        || (!episode && "EXCLUDE".equals(cmd.action())))
                                    && "DECIDED".equals(m.get("state")))))
              throw ApiException.invalidTransition("선택 범위에 이미 처리된 거래가 있습니다.");
            if ("DECIDE".equals(cmd.action())) {
              if (!Set.of("NORMAL", "SUSPICIOUS").contains(Objects.toString(cmd.decision(), "")))
                throw AnalysisService.invalid();
              if (selected.stream().anyMatch(m -> !"SUBJECT".equals(m.get("reviewRole"))))
                throw AnalysisService.invalid();
              if (episode
                  && members.stream()
                          .filter(
                              m ->
                                  "SUBJECT".equals(m.get("reviewRole"))
                                      && "PENDING".equals(m.get("state")))
                          .count()
                      != selected.size())
                throw ApiException.invalidTransition(
                    "Episode는 묶음 단위로 판정합니다. 다른 결론이 필요하면 먼저 분리하세요.");
              for (var m : selected) {
                m.put("state", "DECIDED");
                m.put("decision", cmd.decision());
              }
              if (episode) g.put("decision", cmd.decision());
            } else if ("RECONSIDER".equals(cmd.action())) {
              if (!episode) throw AnalysisService.invalid();
              for (var m : members)
                if ("DECIDED".equals(m.get("state"))) {
                  m.put("state", "PENDING");
                  m.put("decision", null);
                }
              g.put("decision", null);
            } else if ("EXCLUDE".equals(cmd.action())) {
              event(sel.caseId(), user, "BEFORE_EXCLUDE", cmd.comment(), gs);
              selected.forEach(m -> m.put("state", "EXCLUDED"));
            } else if ("SUBJECT".equals(cmd.action()) || "CONTEXT".equals(cmd.action()))
              selected.forEach(m -> m.put("reviewRole", cmd.action()));
            else throw AnalysisService.invalid();
          }
          for (var entry : loaded.entrySet()) {
            long id = entry.getKey();
            var gs = entry.getValue();
            if ("CLOSE".equals(cmd.action())) close(id, user, gs);
            else if (!Set.of(
                    "COMMENT",
                    "REVIEW_START",
                    "DECIDE",
                    "EXCLUDE",
                    "SUBJECT",
                    "CONTEXT",
                    "TRANSFER",
                    "MOVE",
                    "SPLIT",
                    "RECONSIDER")
                .contains(cmd.action())) throw AnalysisService.invalid();
            save(id, gs);
            event(id, user, cmd.action(), cmd.comment(), gs);
          }
          var response = new LinkedHashMap<String, Object>();
          response.put("caseIds", loaded.keySet());
          response.put("targetCaseId", target);
          jdbc.update(
              "insert into review.requests values(?,?,?::jsonb,?::jsonb)",
              user,
              cmd.requestId(),
              encode(cmd),
              encode(response));
          return response;
        });
  }

  private Map<String, Object> unlinkAlerts(
      long user,
      Command cmd,
      Map<Long, Map<String, Object>> cases,
      Map<Long, List<Map<String, Object>>> loaded) {
    if (cases.size() != 1
        || cmd.targetCaseId() != null
        || cmd.targetRevision() != null
        || cmd.targetGroupId() != null
        || cmd.decision() != null) throw AnalysisService.invalid();
    var c = cases.values().iterator().next();
    if (!"EPISODE".equals(c.get("kind"))) throw AnalysisService.invalid();
    long id = number(c.get("case_id"));
    var current = loaded.get(id);
    var selectedGroups = new HashSet<Long>();
    for (var selection : cmd.selections()) {
      if (selection.txIds() == null
          || !selection.txIds().isEmpty()
          || !selectedGroups.add(selection.groupId())
          || current.stream()
              .noneMatch(
                  g ->
                      number(g.get("groupId")) == selection.groupId()
                          && g.get("sourceAlertId") != null)) throw AnalysisService.invalid();
    }
    boolean dissolve = current.size() - selectedGroups.size() < 2;
    var removed =
        current.stream()
            .filter(g -> dissolve || selectedGroups.contains(number(g.get("groupId"))))
            .toList();
    var selectedAlerts =
        current.stream()
            .filter(g -> selectedGroups.contains(number(g.get("groupId"))))
            .map(g -> number(g.get("sourceAlertId")))
            .toList();
    var removedAlerts = removed.stream().map(g -> number(g.get("sourceAlertId"))).toList();
    var reopened = new ArrayList<Long>();
    // Snapshot before deleting active groups. Past decisions remain in review_events,
    // and are never copied over the source Alert's own investigation decisions.
    var snapshot =
        Map.of(
            "selectedAlertIds",
            selectedAlerts,
            "removedAlertIds",
            removedAlerts,
            "groups",
            removed);
    if (dissolve) {
      event(
          id,
          user,
          "MONEY_SNAPSHOT",
          "Episode 해체 시점 자금 관측 지표",
          new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), 180));
    }
    event(id, user, dissolve ? "DISSOLVE" : "UNLINK", cmd.comment(), snapshot);
    for (var group : removed) {
      long alertId = number(group.get("sourceAlertId"));
      long source =
          jdbc.queryForObject(
              "select case_id from review.cases where alert_id=?", Long.class, alertId);
      var sourceCase = caseRow(source);
      if (!"CLOSED".equals(sourceCase.get("status"))
          || !"TRANSFERRED".equals(sourceCase.get("outcome")))
        throw ApiException.invalidTransition("원본 Alert 상태가 변경됐습니다. 다시 조회하세요.");
      jdbc.update(
          "delete from review.episode_alerts where group_id=? and episode_id=?",
          group.get("groupId"),
          id);
      updateCase(
          source, "status='OPEN',outcome=null,closed_at=null,closed_by=null,revision=revision+1");
      event(
          source,
          user,
          "UNLINK",
          cmd.comment(),
          Map.of("episodeCaseId", id, "dissolved", dissolve, "groups", List.of(group)));
      reopened.add(source);
    }
    if (dissolve) {
      updateCase(
          id,
          "status='CLOSED',outcome='DISSOLVED',closed_at=?,closed_by=?,revision=revision+1",
          Timestamp.from(time.now()),
          user);
    } else {
      updateCase(id, "revision=revision+1");
    }
    var affected = new ArrayList<Long>();
    affected.add(id);
    affected.addAll(reopened);
    var response = new LinkedHashMap<String, Object>();
    response.put("caseIds", affected);
    response.put("targetCaseId", null);
    response.put("dissolved", dissolve);
    response.put("reopenedCaseIds", reopened);
    jdbc.update(
        "insert into review.requests values(?,?,?::jsonb,?::jsonb)",
        user,
        cmd.requestId(),
        encode(cmd),
        encode(response));
    return response;
  }

  private Map<String, Object> transferWholeAlerts(
      long user,
      Command cmd,
      Map<Long, Map<String, Object>> cases,
      Map<Long, List<Map<String, Object>>> loaded) {
    if (cmd.targetGroupId() != null
        || cmd.decision() != null
        || cases.size() != cmd.selections().size()) throw AnalysisService.invalid();
    if (cmd.targetCaseId() == null && cases.size() < 2)
      throw ApiException.invalidTransition("새 Episode에는 서로 다른 Alert가 2개 이상 필요합니다.");
    for (var sel : cmd.selections()) {
      var c = cases.get(sel.caseId());
      if (!"ALERT".equals(c.get("kind"))) throw AnalysisService.invalid();
      var members = all(loaded.get(sel.caseId()));
      var ids = new HashSet<Long>();
      for (var m : members) ids.add(number(m.get("txId")));
      // Empty selection explicitly means the entire Alert; a supplied list must
      // contain every member, including context and previously reviewed rows.
      if (sel.txIds() == null
          || (!sel.txIds().isEmpty()
              && (sel.txIds().size() != ids.size() || !ids.equals(new HashSet<>(sel.txIds())))))
        throw ApiException.invalidTransition("거래 일부가 아닌 Alert 전체를 선택하세요.");
      if (members.isEmpty()
          || members.stream().anyMatch(m -> "TRANSFERRED".equals(m.get("state")))
          || jdbc.queryForObject(
              "select exists(select 1 from review.episode_alerts where alert_id=?)",
              Boolean.class,
              c.get("alert_id")))
        throw ApiException.invalidTransition("이미 편입됐거나 이관할 수 없는 Alert입니다.");
    }
    long target;
    if (cmd.targetCaseId() == null) {
      long assignee = StaffAssignment.next(jdbc);
      target =
          jdbc.queryForObject(
              "insert into review.episodes(assignee_id,created_at,assigned_at) values(?,?,?) returning episode_id",
              Long.class,
              assignee,
              Timestamp.from(time.now()),
              Timestamp.from(time.now()));
    } else {
      target = cmd.targetCaseId();
      var dest = caseRow(target);
      if (!"EPISODE".equals(dest.get("kind"))
          || !"OPEN".equals(dest.get("status"))
          || cmd.targetRevision() == null
          || revision(dest) != cmd.targetRevision())
        throw ApiException.invalidTransition("목적지 상태/버전이 변경됐습니다.");
    }
    var destination = groups(caseRow(target));
    for (var c : cases.values()) {
      long id = number(c.get("case_id")), alertId = number(c.get("alert_id"));
      var source = loaded.get(id);
      var members = copy(all(source));
      int version = ((Number) source.getFirst().get("evidenceVersion")).intValue();
      var group = new LinkedHashMap<String, Object>();
      group.put("groupId", 0L);
      group.put("sourceAlertId", alertId);
      group.put("label", "Alert " + alertId);
      group.put("evidenceVersion", version);
      group.put("members", members);
      // Keep the original review snapshot, including context/exclusions/decisions.
      // Each source Alert remains one group; shared transactions are not merged.
      save(target, new ArrayList<>(List.of(group)));
      destination.add(group);
      var snapshot = new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), 180);
      event(id, user, "MONEY_SNAPSHOT", "Episode 편입 시점 자금 관측 지표", snapshot);
      // The Alert remains a whole visible block; only its case disposition changes.
      save(id, source);
      updateCase(
          id,
          "status='CLOSED',outcome='TRANSFERRED',closed_at=?,closed_by=?",
          Timestamp.from(time.now()),
          user);
      event(id, user, "TRANSFER", cmd.comment(), Map.of("targetCaseId", target, "groups", source));
    }
    event(target, user, "TRANSFER", cmd.comment(), destination);
    var response = new LinkedHashMap<String, Object>();
    response.put("caseIds", cases.keySet());
    response.put("targetCaseId", target);
    jdbc.update(
        "insert into review.requests values(?,?,?::jsonb,?::jsonb)",
        user,
        cmd.requestId(),
        encode(cmd),
        encode(response));
    return response;
  }

  private void close(long id, long user, List<Map<String, Object>> gs) {
    var members = all(gs);
    if (members.stream()
        .anyMatch(m -> "SUBJECT".equals(m.get("reviewRole")) && "PENDING".equals(m.get("state"))))
      throw ApiException.invalidTransition("미판정 조사 대상이 남아 있습니다.");
    var decided = members.stream().filter(m -> "DECIDED".equals(m.get("state"))).toList();
    var verdicts = new HashMap<Long, String>();
    for (var m : decided) {
      String previous = verdicts.putIfAbsent(number(m.get("txId")), m.get("decision").toString());
      if (previous != null && !previous.equals(m.get("decision")))
        throw ApiException.invalidTransition("같은 거래의 묶음 판정이 상충합니다. 범위를 재검토하세요.");
    }
    boolean transferred =
        members.stream()
            .anyMatch(
                m ->
                    "TRANSFERRED".equals(m.get("state"))
                        && !Boolean.TRUE.equals(m.get("internalMove")));
    String result =
        decided.stream().anyMatch(m -> "SUSPICIOUS".equals(m.get("decision")))
            ? "SUSPICIOUS"
            : decided.isEmpty()
                ? (transferred ? "TRANSFERRED" : "SCOPE_CLEARED")
                : transferred && "ALERT".equals(caseRow(id).get("kind")) ? "MIXED" : "NORMAL";
    var snapshot = new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), 180);
    event(id, user, "MONEY_SNAPSHOT", "종결 시점 자금 관측 지표", snapshot);
    updateCase(
        id,
        "status='CLOSED',outcome=?,closed_at=?,closed_by=?",
        result,
        Timestamp.from(time.now()),
        user);
  }
}
