package com.moneylaundry.api.review;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Rebuildable read models; a failed scope never blocks publication of another scope. */
@Service
public class DashboardProjection {
  public enum Scope {
    MODEL,
    CASES,
    REPORTS,
    DELIVERY
  }

  // Whole-period aggregates need a set of published scores, not one lookup per ledger row.
  // Select the latest eligible result before applying the displayed detection date range.
  static final String SCORE_BASE =
      """
      from ledger.transactions t
      left join (
        select i.*,j.job_id,j.threshold_value,j.business_at as detected_at
        from analysis.current_scores c join analysis.scores i using(run_id,tx_id)
        join analysis.runs ar on ar.run_id=i.run_id
        join analysis.jobs j on j.job_id=ar.job_id and j.current_run_id=ar.run_id
        where j.status='COMPLETED' and ar.status='COMPLETED'
      ) s on s.tx_id=t.tx_id
      left join lateral (
        select s.type_class::bigint as type_class
        where s.job_id is not null
      ) w on true
      where t.integration_status='ACTIVE'
      """;

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;

  public DashboardProjection(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    this.tx = new TransactionTemplate(manager);
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    tx.setTimeout(120);
  }

  public boolean refresh(Scope scope) {
    // Avoid opening a repeatable-read snapshot when there is no work.
    if (!Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from ops.dashboard_dirty where scope=?)",
            Boolean.class,
            scope.name()))) return false;
    return Boolean.TRUE.equals(
        tx.execute(
            status -> {
              if (!Boolean.TRUE.equals(
                  jdbc.queryForObject(
                      "select pg_try_advisory_xact_lock(?)",
                      Boolean.class,
                      17003100L + scope.ordinal()))) return false;
              jdbc.execute("set local statement_timeout='110s'");
              jdbc.execute("set local lock_timeout='2s'");
              var buckets =
                  jdbc.queryForList(
                      "select distinct bucket from ops.dashboard_dirty where scope=?",
                      String.class,
                      scope.name());
              if (buckets.isEmpty()) return false;
              switch (scope) {
                case MODEL -> model(buckets);
                case CASES -> cases();
                case REPORTS -> reports();
                case DELIVERY -> delivery();
              }
              // Only rows visible in this snapshot are removed. Later source commits remain queued.
              jdbc.update("delete from ops.dashboard_dirty where scope=?", scope.name());
              return true;
            }));
  }

  private void model(List<String> buckets) {
    boolean all = buckets.contains("*");
    String dates = String.join(",", Collections.nCopies(buckets.size(), "?::date"));
    Object[] args = all ? new Object[0] : buckets.toArray();
    jdbc.update(
        "delete from ops.dashboard_model_counts"
            + (all ? "" : " where business_date in (" + dates + ")"),
        args);
    jdbc.update(
        "insert into ops.dashboard_model_counts select t.business_date,(s.detected_at at time zone 'Asia/Seoul')::date,s.p_laundering>=s.threshold_value,w.type_class,count(*) "
            + SCORE_BASE
            + (all ? "" : " and t.business_date in (" + dates + ")")
            + " group by 1,2,3,4",
        args);
  }

  private void cases() {
    jdbc.update("delete from ops.dashboard_case_items");
    jdbc.update(
        """
      insert into ops.dashboard_case_items
      select c.case_id,c.kind,c.alert_id,c.assignee_id,u.name,c.status,c.created_at,c.assigned_at,
        c.closed_at,c.closed_by,r.first_review,(ea.alert_id is not null),ep.status,c.risk_score
      from %s c join core.users u on u.user_id=c.assignee_id
      left join review.episode_alerts ea on ea.alert_id=c.alert_id and c.kind='ALERT'
      left join review.episodes ep on ep.episode_id=ea.episode_id
      left join lateral (
        select min(e.business_at) as first_review from review.events e
        where c.kind='EPISODE' and e.episode_id=c.case_id and e.actor_id=c.assignee_id
          and e.action='REVIEW_START' and e.business_at>=c.assigned_at
      ) r on true
      """
            .formatted(ReviewCaseSql.PUBLISHED));
    jdbc.update("delete from ops.dashboard_case_counts");
    jdbc.update(
        """
      insert into ops.dashboard_case_counts
      select kind,assignee_id,status,created_at,assigned_at,closed_at,closed_by,first_review,linked,episode_status,count(*)
      from ops.dashboard_case_items group by 1,2,3,4,5,6,7,8,9,10
      """);
  }

  private void reports() {
    jdbc.update("delete from ops.dashboard_report_counts");
    jdbc.update(
        """
      insert into ops.dashboard_report_counts
      select b.business_date,count(*) from ingest.uploads b
      left join ingest.report_versions v on v.upload_id=b.upload_id
      where b.status<>'EXPIRED' and v.stage_status is distinct from 'SUPERSEDED'
        and (b.status<>'COMPLETED' or v.stage_status is distinct from 'ACTIVE') group by 1
      """);
  }

  private void delivery() {
    jdbc.update("delete from ops.dashboard_delivery_days");
    jdbc.update(
        """
      insert into ops.dashboard_delivery_days
      select distinct (business_at at time zone 'Asia/Seoul')::date,analysis_date-1
      from analysis.jobs where business_at is not null and analysis_date is not null
      """);
  }
}
