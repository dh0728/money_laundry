package com.moneylaundry.api.review;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Current investigation membership, including closed cases but excluding removed history. */
final class CurrentCaseMembership {
  private final JdbcTemplate jdbc;

  CurrentCaseMembership(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  void attach(List<Map<String, Object>> transactions) {
    if (transactions.isEmpty()) return;
    Map<Long, Map<String, Object>> byId = new HashMap<>();
    for (var row : transactions) {
      row.put("alertIds", new TreeSet<Long>());
      row.put("episodeIds", new TreeSet<Long>());
      byId.put(((Number) row.get("txId")).longValue(), row);
    }
    String marks = String.join(",", Collections.nCopies(byId.size(), "?"));
    String sql =
        """
        with latest as (
          select distinct on (v.alert_id) v.alert_id,v.evidence
          from alert_versions v join analysis_runs r using(run_id)
          join batch_jobs b on b.job_id=r.job_id
          where r.status='COMPLETED' and b.status='COMPLETED'
          order by v.alert_id,v.version desc
        ), members as (
          select c.kind,c.alert_id,c.case_id,(m->>'txId')::bigint tx_id
          from visible_review_cases c join review_groups g using(case_id)
          cross join lateral jsonb_array_elements(g.members) m
          where m->>'state' not in ('EXCLUDED','TRANSFERRED')
          union all
          select c.kind,c.alert_id,c.case_id,(m->>'txId')::bigint tx_id
          from visible_review_cases c join latest v using(alert_id)
          cross join lateral jsonb_array_elements(v.evidence->'transactions') m
          where c.kind='ALERT' and (
            not exists(select 1 from review_groups g where g.case_id=c.case_id)
            or (c.status='OPEN' and not exists(
              select 1 from review_groups g cross join lateral jsonb_array_elements(g.members) seen
              where g.case_id=c.case_id and seen->>'txId'=m->>'txId')))
        )
        select distinct kind,alert_id,case_id,tx_id from members where tx_id in (
        """
            + marks
            + ")";
    for (var membership : jdbc.queryForList(sql, byId.keySet().toArray())) {
      var row = byId.get(((Number) membership.get("tx_id")).longValue());
      boolean alert = "ALERT".equals(membership.get("kind"));
      @SuppressWarnings("unchecked")
      var ids = (Set<Long>) row.get(alert ? "alertIds" : "episodeIds");
      ids.add(((Number) membership.get(alert ? "alert_id" : "case_id")).longValue());
    }
  }
}
