package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Rebuildable current-scope projection, written in the scope's transaction. */
public final class CaseSummaryStore {
  private final JdbcTemplate jdbc;

  public CaseSummaryStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void refresh(long id) {
    var c = jdbc.queryForMap("select * from review.cases where case_id=?", id);
    boolean episode = "EPISODE".equals(c.get("kind"));
    // 공개 도중에도 요약을 만들 수 있게 Alert는 공개 버전을 직접 읽는다.
    var scope =
        episode
            ? jdbc.queryForList(
                "select * from review.current_members where case_id=? order by alert_id,evidence_version,tx_id",
                id)
            : jdbc.queryForList(
                """
                select t.tx_id,t.alert_id,t.version as evidence_version,
                  case when t.role='CONTEXT' then 'CONTEXT' else 'SUBJECT' end as review_role,
                  case when e.target_alert_id is not null then 'TRANSFERRED' when e.edit_id is not null then 'EXCLUDED'
                    when j.verdict is not null and t.role<>'CONTEXT' then 'DECIDED' else 'PENDING' end as state,
                  case when e.edit_id is null and t.role<>'CONTEXT' then j.verdict end as decision
                from review.alert_transactions t
                left join review.alert_tx_edits e on e.alert_id=t.alert_id and e.tx_id=t.tx_id
                left join lateral (select verdict from review.judgments j where j.alert_id=t.alert_id
                  or j.episode_id=(select episode_id from review.episode_alerts where alert_id=t.alert_id) limit 1) j on true
                where t.alert_id=? and t.version=?
                union all
                select x.tx_id,x.alert_id,t.version,
                  case when t.role='CONTEXT' then 'CONTEXT' else 'SUBJECT' end,
                  case when j.verdict is not null and t.role<>'CONTEXT' then 'DECIDED' else 'PENDING' end,
                  case when t.role<>'CONTEXT' then j.verdict end
                from review.alert_tx_edits x join review.alerts o on o.alert_id=x.alert_id
                join review.alert_transactions t on t.alert_id=o.alert_id and t.version=o.published_version and t.tx_id=x.tx_id
                left join lateral (select verdict from review.judgments j where j.alert_id=x.target_alert_id
                  or j.episode_id=(select episode_id from review.episode_alerts where alert_id=x.target_alert_id) limit 1) j on true
                where x.target_alert_id=?
                  and not exists(select 1 from review.alert_tx_edits k where k.alert_id=x.target_alert_id and k.tx_id=x.tx_id)
                  and not exists(select 1 from review.alert_transactions own where own.alert_id=? and own.version=? and own.tx_id=x.tx_id)
                order by 2,3,1
                """,
                id,
                c.get("published_version"),
                id,
                id,
                c.get("published_version"));
    var members = new ArrayList<Map<String, Object>>();
    var sources = new TreeSet<Long>();
    var sourceTypes = new TreeSet<String>();
    long previousAlert = -1, previousVersion = -1;
    Map<Long, Map<String, Object>> transactions = Map.of();
    String sourceType = "패턴 미특정";
    for (var row : scope) {
      long alert = number(row.get("alert_id")), version = number(row.get("evidence_version"));
      if (alert != previousAlert || version != previousVersion) {
        var stored =
            jdbc.queryForMap(
                "select v.evidence,b.threshold_value from review.alert_versions v join analysis.runs r using(run_id) join analysis.jobs b using(job_id) where v.alert_id=? and v.version=?",
                alert,
                version);
        var evidence = object(stored.get("evidence"));
        CaseSummary.annotateSuspicion(
            evidence, ((Number) stored.get("threshold_value")).doubleValue());
        transactions = new HashMap<>();
        var originalMembers = new ArrayList<Map<String, Object>>();
        for (var t : rows(evidence.get("transactions"))) {
          transactions.put(number(t.get("txId")), t);
          originalMembers.add(
              Map.of(
                  "txId",
                  t.get("txId"),
                  "transaction",
                  t,
                  "reviewRole",
                  "CONTEXT".equals(t.get("role")) ? "CONTEXT" : "SUBJECT",
                  "state",
                  "PENDING"));
        }
        sourceType = CaseSummary.summarize(originalMembers).get("primaryType").toString();
        previousAlert = alert;
        previousVersion = version;
      }
      var t = transactions.get(number(row.get("tx_id")));
      if (t == null) throw new IllegalStateException("SUMMARY_EVIDENCE_MEMBER_MISSING");
      var member = new LinkedHashMap<String, Object>();
      member.put("txId", row.get("tx_id"));
      member.put("transaction", t);
      member.put("reviewRole", row.get("review_role"));
      member.put("state", row.get("state"));
      member.put("decision", row.get("decision"));
      members.add(member);
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(row.get("state"))) {
        sources.add(alert);
        sourceTypes.add(sourceType);
      }
    }
    if (episode) {
      sources.clear();
      sources.addAll(
          jdbc.queryForList(
              "select alert_id from review.episode_alerts where episode_id=? order by alert_id",
              Long.class,
              id));
    }
    var summary = new LinkedHashMap<>(CaseSummary.summarize(members));
    summary.put(
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
    summary.put("sourceAlertIds", sources);
    summary.put("primaryTypes", sourceTypes);
    summary.put(
        "hasScoredSeed",
        members.stream()
            .anyMatch(
                m ->
                    !Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state"))
                        && "SEED".equals(object(m.get("transaction")).get("role"))
                        && object(m.get("transaction")).get("scores") != null));
    String digest;
    try {
      digest =
          HexFormat.of()
              .formatHex(
                  MessageDigest.getInstance("SHA-256")
                      .digest(encode(members).getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
    jdbc.update(
        "update review."
            + (episode ? "episodes" : "alerts")
            + " set summary=?::jsonb,summary_revision=revision,summary_scope_digest=? where "
            + (episode ? "episode_id" : "alert_id")
            + "=?",
        encode(summary),
        digest,
        id);
  }
}
