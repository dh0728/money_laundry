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

    String sql =
        """
        with selected(tx_id) as (select unnest(?::bigint[])), latest as (
          select distinct on(v.alert_id) v.alert_id,v.version
          from review.alert_versions v join analysis.runs r using(run_id)
          join analysis.jobs b on b.job_id=r.job_id and b.current_run_id=r.run_id
          where r.status='COMPLETED' and b.status='COMPLETED'
          order by v.alert_id,v.version desc
        ), members as (
          select 'ALERT' as kind,a.alert_id,a.alert_id as case_id,m.tx_id
          from selected s join review.alert_members m using(tx_id)
          join review.alerts a using(alert_id) join latest l using(alert_id)
          where m.state not in ('EXCLUDED','TRANSFERRED')
          union all
          select 'ALERT',a.alert_id,a.alert_id,t.tx_id
          from selected s join review.alert_transactions t using(tx_id)
          join latest l using(alert_id,version) join review.alerts a using(alert_id)
          where (a.status='OPEN' or not exists(select 1 from review.alert_groups g where g.alert_id=a.alert_id))
            and not exists(select 1 from review.alert_members m where m.alert_id=a.alert_id and m.tx_id=t.tx_id)
          union all
          select 'EPISODE',e.alert_id,e.episode_id,m.tx_id
          from selected s join review.episode_members m using(tx_id)
          join review.episode_alerts e using(group_id,alert_id)
          where m.state not in ('EXCLUDED','TRANSFERRED')
        ) select distinct kind,alert_id,case_id,tx_id from members
        """;
    for (var membership : jdbc.queryForList(sql, (Object) byId.keySet().toArray(Long[]::new))) {
      var row = byId.get(((Number) membership.get("tx_id")).longValue());
      boolean alert = "ALERT".equals(membership.get("kind"));
      @SuppressWarnings("unchecked")
      var ids = (Set<Long>) row.get(alert ? "alertIds" : "episodeIds");
      ids.add(((Number) membership.get(alert ? "alert_id" : "case_id")).longValue());
    }
  }
}
