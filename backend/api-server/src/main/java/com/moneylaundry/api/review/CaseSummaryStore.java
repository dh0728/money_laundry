package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Rebuildable current-scope projection, written in the scope's transaction. */
final class CaseSummaryStore {
  private final JdbcTemplate jdbc;

  CaseSummaryStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  void refresh(long id) {
    var c = jdbc.queryForMap("select * from review.cases where case_id=?", id);
    boolean episode = "EPISODE".equals(c.get("kind"));
    var scope =
        jdbc.queryForList(
            "select * from review.effective_members where case_id=? order by alert_id,evidence_version,tx_id,group_id",
            id);
    if (!episode
        && !jdbc.queryForObject(
            "select exists(select 1 from review.alert_groups where alert_id=?)",
            Boolean.class,
            id)) {
      scope =
          jdbc.queryForList(
              "select tx_id,alert_id,version as evidence_version,case when role='CONTEXT' then 'CONTEXT' else 'SUBJECT' end as review_role,'PENDING' as state,null as decision from review.alert_transactions where alert_id=? and version=? order by tx_id",
              id,
              c.get("published_version"));
    }
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
