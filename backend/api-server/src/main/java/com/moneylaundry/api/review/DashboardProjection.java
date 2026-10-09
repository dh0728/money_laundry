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
    PIPELINE(17003100L),
    INVESTIGATION(17003101L);
    final long lockKey;

    Scope(long lockKey) {
      this.lockKey = lockKey;
    }
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
  private final DashboardReadDatabase reads;

  public DashboardProjection(JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this(jdbc, manager, null);
  }

  @org.springframework.beans.factory.annotation.Autowired
  public DashboardProjection(
      JdbcTemplate jdbc, PlatformTransactionManager manager, DashboardReadDatabase reads) {
    this.reads = reads;
    this.jdbc = jdbc;
    this.tx = new TransactionTemplate(manager);
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    tx.setTimeout(120);
  }

  /** A short scheduler query; calculation runs on separate bounded workers. */
  public List<Scope> dueScopes() {
    if (reads != null) return reads.read(1000, c -> pending(c.jdbc()));
    var check = new TransactionTemplate(tx.getTransactionManager());
    check.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    check.setTimeout(1);
    check.setReadOnly(true);
    return check.execute(
        s -> {
          jdbc.execute("set local statement_timeout='750ms'");
          return pending(jdbc);
        });
  }

  private List<Scope> pending(JdbcTemplate source) {
    return source
        .queryForList(
            "select distinct d.scope from ops.dashboard_dirty d left join ops.dashboard_refresh_state s using(scope) where s.retry_at is null or s.retry_at<=clock_timestamp()",
            String.class)
        .stream()
        .map(Scope::valueOf)
        .toList();
  }

  public boolean refresh(Scope scope) {
    var version = new java.util.concurrent.atomic.AtomicLong(-1);
    long started = System.nanoTime();
    try {
      return Boolean.TRUE.equals(
          tx.execute(
              status -> {
                if (!Boolean.TRUE.equals(
                    jdbc.queryForObject(
                        "select pg_try_advisory_xact_lock(?)", Boolean.class, scope.lockKey)))
                  return false;
                jdbc.execute("set local statement_timeout='110s'");
                jdbc.execute("set local lock_timeout='2s'");
                jdbc.update(
                    "insert into ops.dashboard_refresh_state(scope) values(?) on conflict do nothing",
                    scope.name());
                var state =
                    jdbc.queryForMap(
                        "select version,(retry_at is null or retry_at<=clock_timestamp()) as due from ops.dashboard_refresh_state where scope=?",
                        scope.name());
                if (!Boolean.TRUE.equals(state.get("due"))) return false;
                var components =
                    jdbc.queryForList(
                        "select distinct component from ops.dashboard_dirty where scope=?",
                        String.class,
                        scope.name());
                if (components.isEmpty()) return false;
                version.set(((Number) state.get("version")).longValue());
                for (String component : components) {
                  if (component.equals("CASES")) {
                    cases();
                    continue;
                  }
                  var buckets =
                      jdbc.queryForList(
                          "select distinct bucket from ops.dashboard_dirty where component=?",
                          String.class,
                          component);
                  switch (component) {
                    case "MODEL" -> model(buckets);
                    case "REPORTS" -> reports(buckets);
                    case "DELIVERY" -> delivery(buckets);
                    default -> throw new IllegalStateException("Unknown dashboard component");
                  }
                }
                // Only requests visible in this repeatable-read snapshot are acknowledged.
                jdbc.update("delete from ops.dashboard_dirty where scope=?", scope.name());
                jdbc.update(
                    "update ops.dashboard_refresh_state set version=nextval('ops.dashboard_publication_version'),computed_at=clock_timestamp(),failures=0,retry_at=null,last_error_code=null,last_duration_ms=? where scope=?",
                    (System.nanoTime() - started) / 1_000_000,
                    scope.name());
                return true;
              }));
    } catch (RuntimeException failure) {
      if (version.get() >= 0) {
        try {
          recordFailure(scope, version.get(), failure);
        } catch (RuntimeException recordingFailure) {
          failure.addSuppressed(recordingFailure);
        }
      }
      throw failure;
    }
  }

  private void recordFailure(Scope scope, long version, RuntimeException failure) {
    var record = new TransactionTemplate(tx.getTransactionManager());
    record.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    record.setTimeout(2);
    record.executeWithoutResult(
        s -> {
          jdbc.execute("set local statement_timeout='1s'");
          if (!Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "select pg_try_advisory_xact_lock(?)", Boolean.class, scope.lockKey))) return;
          // A newer success/reset makes this failure obsolete. Never overwrite it.
          jdbc.update(
              "update ops.dashboard_refresh_state set failures=failures+1,retry_at=clock_timestamp()+make_interval(secs=>least(60,5*power(2,least(failures,4)))::double precision),last_error_code=? where scope=? and version=?",
              errorCode(failure),
              scope.name(),
              version);
        });
  }

  static String errorCode(Throwable failure) {
    for (Throwable e = failure; e != null; e = e.getCause())
      if (e instanceof java.sql.SQLException sql && sql.getSQLState() != null)
        return sql.getSQLState();
    return failure.getClass().getSimpleName();
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

  private static final String CASE_FIELDS =
      "kind,assignee_id,status,created_at,assigned_at,closed_at,closed_by,first_review,linked,episode_status";
  private static final String CASE_KEY =
      "jsonb_build_array(kind,assignee_id,status,extract(epoch from created_at),extract(epoch from assigned_at),extract(epoch from closed_at),closed_by,extract(epoch from first_review),linked,episode_status)";

  private void cases() {
    boolean all =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "select exists(select 1 from ops.dashboard_dirty where component='CASES' and bucket='*')",
                Boolean.class));
    String affected =
        all
            ? "true"
            : "case_id in (select bucket::bigint from ops.dashboard_dirty where component='CASES' and bucket<>'*')";
    jdbc.execute(
        """
      create temporary table dashboard_next_cases on commit drop as
      select c.case_id,c.kind,c.alert_id,c.assignee_id,u.name as assignee,c.status,c.created_at,c.assigned_at,
        c.closed_at,c.closed_by,r.first_review,(ea.alert_id is not null) as linked,ep.status as episode_status,c.risk_score as risk
      from %s c join core.users u on u.user_id=c.assignee_id
      left join review.episode_alerts ea on ea.alert_id=c.alert_id and c.kind='ALERT'
      left join review.episodes ep on ep.episode_id=ea.episode_id
      left join lateral (
        select min(e.business_at) as first_review from review.events e
        where c.kind='EPISODE' and e.episode_id=c.case_id and e.actor_id=c.assignee_id
          and e.action='REVIEW_START' and e.business_at>=c.assigned_at
      ) r on true where %s
      """
            .formatted(ReviewCaseSql.PUBLISHED, affected));
    if (all) {
      jdbc.update("delete from ops.dashboard_case_counts");
      jdbc.update("delete from ops.dashboard_case_items");
    }
    jdbc.execute(
        "create temporary table dashboard_case_deltas on commit drop as select "
            + CASE_KEY
            + " as group_key,"
            + CASE_FIELDS
            + ",sum(delta)::bigint as delta from (select "
            + CASE_FIELDS
            + ",-1::bigint as delta from ops.dashboard_case_items where "
            + affected
            + " union all select "
            + CASE_FIELDS
            + ",1::bigint as delta from dashboard_next_cases) x group by "
            + CASE_FIELDS
            + " having sum(delta)<>0");
    jdbc.update(
        "insert into ops.dashboard_case_counts(group_key,"
            + CASE_FIELDS
            + ",n) select group_key,"
            + CASE_FIELDS
            + ",0 from dashboard_case_deltas on conflict(group_key) do nothing");
    jdbc.update(
        "update ops.dashboard_case_counts c set n=c.n+d.delta from dashboard_case_deltas d where c.group_key=d.group_key");
    jdbc.update(
        "delete from ops.dashboard_case_counts c using dashboard_case_deltas d where c.group_key=d.group_key and c.n=0");
    if (!all) jdbc.update("delete from ops.dashboard_case_items where " + affected);
    jdbc.update("insert into ops.dashboard_case_items select * from dashboard_next_cases");
  }

  private void reports(List<String> buckets) {
    boolean all = buckets.contains("*");
    String filter =
        all
            ? ""
            : " where business_date in ("
                + String.join(",", Collections.nCopies(buckets.size(), "?::date"))
                + ")";
    Object[] args = all ? new Object[0] : buckets.toArray();
    jdbc.update("delete from ops.dashboard_report_counts" + filter, args);
    jdbc.update(
        """
      insert into ops.dashboard_report_counts
      select b.business_date,count(*) from ingest.uploads b
      left join ingest.report_versions v on v.upload_id=b.upload_id
      where b.status<>'EXPIRED' and v.stage_status is distinct from 'SUPERSEDED'
        and (b.status<>'COMPLETED' or v.stage_status is distinct from 'ACTIVE')
      """
            + (all
                ? ""
                : " and b.business_date in ("
                    + String.join(",", Collections.nCopies(buckets.size(), "?::date"))
                    + ")")
            + " group by 1",
        args);
  }

  private void delivery(List<String> buckets) {
    boolean all = buckets.contains("*");
    String dates = String.join(",", Collections.nCopies(buckets.size(), "?::date"));
    Object[] args = all ? new Object[0] : buckets.toArray();
    jdbc.update(
        "delete from ops.dashboard_delivery_days"
            + (all ? "" : " where detected_day in (" + dates + ")"),
        args);
    jdbc.update(
        """
      insert into ops.dashboard_delivery_days
      select distinct (business_at at time zone 'Asia/Seoul')::date,analysis_date-1
      from analysis.jobs where business_at is not null and analysis_date is not null
      """
            + (all ? "" : " and (business_at at time zone 'Asia/Seoul')::date in (" + dates + ")"),
        args);
  }
}
