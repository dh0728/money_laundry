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
        with selected(tx_id) as (select unnest(?::bigint[])), candidates as materialized (
          select distinct t.alert_id from selected s join review.alert_transactions t using(tx_id)
        ), latest as (
          select a.alert_id,v.version from review.alerts a join review.latest_versions v using(alert_id)
          join candidates c using(alert_id)
          where a.published_version is not null and a.merged_into_alert_id is null
        ), held as (
          select t.alert_id as holder,t.tx_id
          from selected s join review.alert_transactions t using(tx_id)
          join latest l using(alert_id,version)
          where not exists(select 1 from review.alert_tx_edits e where e.alert_id=t.alert_id and e.tx_id=t.tx_id)
          union
          select x.target_alert_id,x.tx_id
          from selected s join review.alert_tx_edits x using(tx_id)
          join latest l on l.alert_id=x.alert_id
          join review.alert_transactions t on t.alert_id=l.alert_id and t.version=l.version and t.tx_id=x.tx_id
          where x.target_alert_id is not null
            and not exists(select 1 from review.alert_tx_edits o where o.alert_id=x.target_alert_id and o.tx_id=x.tx_id)
        ) select case when ea.episode_id is null then 'ALERT' else 'EPISODE' end as kind,
            h.holder as alert_id,coalesce(ea.episode_id,h.holder) as case_id,h.tx_id
          from held h left join review.episode_alerts ea on ea.alert_id=h.holder
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
