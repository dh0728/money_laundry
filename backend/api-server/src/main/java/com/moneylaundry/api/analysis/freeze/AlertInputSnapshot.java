package com.moneylaundry.api.analysis.freeze;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Called inside FREEZE_INPUT's integration lock and transaction. */
@Component
public class AlertInputSnapshot {
  static final String LEDGER_VALUES =
      "tx_id,occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version";

  /**
   * One transaction's frozen values, read by primary keys; append the tx_id. Statements reach the
   * growing tables only through lateral subqueries like this one, run once per candidate row. A
   * plain join lets the planner scan those tables whole once the candidates pass a few percent of
   * them, and the day's work then follows the history instead of the day.
   */
  public static final String LEDGER_ROW =
      """
      select t.tx_id,t.occurred_at,t.business_date,a.bank_id as from_bank_id,b.bank_id as to_bank_id,
        a.service_account_id as from_account_id,b.service_account_id as to_account_id,
        e.service_owner_id as from_owner_id,f.service_owner_id as to_owner_id,
        t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
        t.payment_format,t.amount_usd,t.fx_rate_version
      from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
      join core.accounts b on b.account_id=t.to_account_id
      join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id
      where t.integration_status='ACTIVE' and t.tx_id=""";

  /**
   * Tables 거래 통합 fills. Right after their first load they have no statistics until autovacuum
   * reaches them, and without statistics the planner once walked every report of a version for each
   * transaction instead of looking the transaction up. A freeze analyzes those never analyzed.
   */
  private static final List<String> INTEGRATED =
      List.of(
          "ledger.transactions",
          "ledger.transaction_reports",
          "private.bank_reports",
          "core.accounts",
          "core.owners",
          "ingest.report_sets",
          "ingest.report_versions",
          "analysis.selected_versions");

  private final JdbcTemplate jdbc;

  public AlertInputSnapshot(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void freeze(UUID run, Instant cutoff) {
    freeze(run, cutoff, Set.of());
  }

  /**
   * Opens the transaction-local mirror of this run's frozen rows. The planner has never seen a new
   * run id and estimates one row for it, which once turned the CONTEXT anti-join into a rescan per
   * ledger row; statements that join the run read this analyzed mirror instead. Rows the run
   * already has (inserted outside FREEZE_INPUT's own statements) are copied in once.
   */
  public static void openFrozen(JdbcTemplate jdbc, UUID run) {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("FREEZE_INPUT_REQUIRES_TRANSACTION");
    jdbc.execute(
        "create temp table if not exists frozen_input(run_id uuid,tx_id bigint,business_date date not null,primary key(run_id,tx_id)) on commit drop");
    if (jdbc.update(
            "insert into frozen_input select run_id,tx_id,business_date from analysis.input_transactions where run_id=? and not exists(select 1 from frozen_input where run_id=?)",
            run,
            run)
        > 0) jdbc.execute("analyze frozen_input");
  }

  public void freeze(UUID run, Instant cutoff, Set<Long> blockedSets) {
    complete(run, cutoff, blockedSets, prepare(run, cutoff, blockedSets));
  }

  /**
   * Records the manifest and this run's input_seq and lists the transactions whose eligibility can
   * differ from the previous freeze (changed_input). TARGET selection reads the same list, so it
   * runs between this and {@link #complete}.
   */
  public long prepare(UUID run, Instant cutoff, Set<Long> blockedSets) {
    openFrozen(jdbc, run);
    for (String table : INTEGRATED)
      if (jdbc.queryForObject(
          "select reltuples<0 from pg_class where oid=?::regclass", Boolean.class, table))
        jdbc.execute("analyze " + table);
    freezeManifest(run, cutoff);
    return changedInput(run, cutoff, blockedSets);
  }

  public void complete(UUID run, Instant cutoff, Set<Long> blockedSets, long seq) {
    freezeLedger(cutoff, blockedSets, seq);
    freezeAlerts(seq);
    // The run's input is its own frozen rows plus the eligible set, which is the open ledger now.
    // The second branch stops at the first eligible transaction of each report set.
    jdbc.update(
        """
        insert into analysis.input_report_sets
        select distinct ?::uuid,s.set_id from frozen_input i
        cross join lateral (select rs.set_id from ledger.transaction_reports tr
          join private.bank_reports br using(report_id) join ingest.report_versions rv using(version_id)
          join ingest.report_sets rs on rs.set_id=rv.set_id and rs.current_version_id=rv.version_id
          where tr.tx_id=i.tx_id offset 0) s
        where i.run_id=?
        union
        select ?::uuid,s.set_id from ingest.report_sets s cross join lateral (
          select 1 from private.bank_reports br join ledger.transaction_reports tr using(report_id)
          join analysis.input_ledger l on l.tx_id=tr.tx_id and l.valid_to_seq is null
          where br.version_id=s.current_version_id limit 1) eligible
        on conflict do nothing
        """,
        run,
        run,
        run);
    freezeScores(run, seq);
    var dates =
        jdbc.queryForList(
            """
        select d::date from generate_series(
          (select least((select min(business_date) from frozen_input where run_id=?),?::date)-3),
          (?::timestamptz at time zone 'Asia/Seoul')::date, interval '1 day') d order by 1
        """,
            java.sql.Date.class,
            run,
            earliestEligibleDate(),
            Timestamp.from(cutoff));
    for (java.sql.Date date : dates) {
      LocalDate day = date.toLocalDate();
      jdbc.update(
          """
          insert into analysis.input_coverage
          select ?,?,count(*)::integer,
            count(*) filter(where v.stage_status='ACTIVE' and v.self_valid and v.received_at<=?)::integer,
            count(*)>0 and bool_and(coalesce(v.stage_status='ACTIVE' and v.self_valid and v.received_at<=?,false)),
            coalesce(jsonb_agg(jsonb_build_object('bankId',sb.bank_id,'versionId',v.version_id,
              'status',case when v.received_at<=? then v.stage_status else 'NOT_RECEIVED' end)), '[]'::jsonb)
          from ingest.reporting_scope_banks sb left join ingest.report_sets rs on rs.bank_id=sb.bank_id and rs.business_date=sb.business_date
          left join ingest.report_versions v on v.version_id=rs.current_version_id where sb.business_date=?
          """,
          run,
          day,
          Timestamp.from(cutoff),
          Timestamp.from(cutoff),
          Timestamp.from(cutoff),
          day);
    }
  }

  /** Earliest business date with an eligible transaction, walking the dates from the oldest. */
  private java.sql.Date earliestEligibleDate() {
    var day =
        jdbc.queryForObject(
            "select min(business_date) from ledger.transactions", java.sql.Date.class);
    while (day != null
        && !jdbc.queryForObject(
            """
            select exists(select 1 from ledger.transactions t
              join analysis.input_ledger l on l.tx_id=t.tx_id and l.valid_to_seq is null
              where t.business_date=?)
            """,
            Boolean.class,
            day))
      day =
          jdbc.queryForObject(
              "select min(business_date) from ledger.transactions where business_date>?",
              java.sql.Date.class,
              day);
    return day;
  }

  /**
   * Brings the shared input ledger to this cutoff and blocked sets and returns this run's
   * input_seq. The ledger holds every eligible transaction (this run's TARGET included); run_inputs
   * subtracts each run's own rows, so CONTEXT is every other eligible transaction.
   *
   * <p>Only transactions whose eligibility can differ from the previous freeze are re-evaluated
   * (changed_input). Eligibility reads a transaction's status and time, the current version of its
   * report sets and when that version was received; every writer of those bumps the set's
   * generation or the version's revision, which the source manifest records. So the candidates are
   * the transactions reported through any version of a set whose manifest entry differs between the
   * two runs, of a set the manifest does not list (dated after the cutoff, or current version
   * received after it), of a set blocked in either run, and those timed between the two cutoffs.
   * The first freeze has no previous run and re-evaluates everything.
   *
   * <p>TARGET selection also depends on the versions the job selected, so a set this job selected
   * and the previous run's job did not is a candidate as well.
   */
  private long changedInput(UUID run, Instant cutoff, Set<Long> blockedSets) {
    long seq = jdbc.queryForObject("select nextval('analysis.input_seq')", Long.class);
    if (jdbc.queryForObject("select coalesce(max(input_seq),0) from analysis.runs", Long.class)
        >= seq) throw new IllegalStateException("INPUT_LEDGER_ORDER");
    UUID previous =
        jdbc
            .queryForList(
                "select run_id from analysis.runs where input_seq is not null order by input_seq desc limit 1",
                UUID.class)
            .stream()
            .findFirst()
            .orElse(null);
    Timestamp at = Timestamp.from(cutoff);
    String blockedIds =
        blockedSets.stream().map(String::valueOf).collect(Collectors.joining(",", "{", "}"));
    jdbc.update(
        "update analysis.runs set input_seq=?,input_cutoff_at=?,input_blocked_sets=?::bigint[] where run_id=?",
        seq,
        at,
        blockedIds,
        run);
    jdbc.execute("create temp table changed_sets(set_id bigint primary key) on commit drop");
    jdbc.update(
        """
        insert into changed_sets
        with was as (select (e->>'setId')::bigint as set_id,e from analysis.source_manifest m
            cross join lateral jsonb_array_elements(m.state->'reports') e where m.run_id=?),
          stands as (select (e->>'setId')::bigint as set_id,e from analysis.source_manifest m
            cross join lateral jsonb_array_elements(m.state->'reports') e where m.run_id=?)
        select set_id from was full join stands using(set_id) where was.e is distinct from stands.e
        union select set_id from ingest.report_sets
          where business_date>(?::timestamptz at time zone 'Asia/Seoul')::date
        union select rs.set_id from ingest.report_sets rs
          join ingest.report_versions rv on rv.version_id=rs.current_version_id where rv.received_at>?
        union select unnest(?::bigint[])
        union select unnest(input_blocked_sets) from analysis.runs where run_id=?
        union select sv.set_id from analysis.runs r join analysis.selected_versions sv using(job_id)
          where r.run_id=? and not exists(select 1 from analysis.runs p
            join analysis.selected_versions was using(job_id)
            where p.run_id=? and was.set_id=sv.set_id and was.version_id=sv.version_id)
        """,
        previous,
        run,
        at,
        at,
        blockedIds,
        previous,
        run,
        previous);
    jdbc.execute("analyze changed_sets");
    jdbc.execute("create temp table changed_input(tx_id bigint primary key) on commit drop");
    jdbc.update(
        """
        insert into changed_input
        select tr.tx_id from changed_sets s join ingest.report_versions v using(set_id)
          cross join lateral (select br.report_id from private.bank_reports br
            where br.version_id=v.version_id offset 0) br
          cross join lateral (select tr.tx_id from ledger.transaction_reports tr
            where tr.report_id=br.report_id offset 0) tr
        union
        select t.tx_id from ledger.transactions t cross join (select coalesce(
            (select input_cutoff_at from analysis.runs where run_id=?),'-infinity') as at) was
        where t.integration_status='ACTIVE'
          and t.occurred_at>least(was.at,?) and t.occurred_at<=greatest(was.at,?)
        """,
        previous,
        at,
        at);
    jdbc.execute("analyze changed_input");
    return seq;
  }

  private void freezeLedger(Instant cutoff, Set<Long> blockedSets, long seq) {
    Timestamp at = Timestamp.from(cutoff);
    String blocked = "";
    var inputArgs = new ArrayList<Object>(List.of(at));
    if (!blockedSets.isEmpty()) {
      blocked =
          "and (select count(*) from (select 1 from ledger.transaction_reports blocked_tr join private.bank_reports blocked_br using(report_id) join ingest.report_versions blocked_v using(version_id) where blocked_tr.tx_id=k.tx_id and blocked_v.set_id in ("
              + String.join(",", Collections.nCopies(blockedSets.size(), "?"))
              + ") limit 1) hit)=0";
      inputArgs.addAll(blockedSets);
    }
    inputArgs.addAll(List.of(at, at));
    jdbc.execute(
        "create temp table desired_input on commit drop as select "
            + LEDGER_VALUES
            + " from analysis.input_ledger with no data");
    jdbc.update(
        """
        with eligible as materialized (
          select k.tx_id from changed_input k
          cross join lateral (select rv.received_at from ledger.transactions t
            join ledger.transaction_reports tr using(tx_id)
            join private.bank_reports br using(report_id)
            join ingest.report_versions rv using(version_id)
            join ingest.report_sets rs on rs.set_id=rv.set_id and rs.current_version_id=rv.version_id
            where t.tx_id=k.tx_id and t.integration_status='ACTIVE' and t.occurred_at<=? offset 0) rv
          where true %s
          group by k.tx_id
          having bool_or(rv.received_at<=?) and not bool_or(rv.received_at>?)
        )
        insert into desired_input
        select v.* from eligible c cross join lateral (%s c.tx_id offset 0) v
        """
            .formatted(blocked, LEDGER_ROW),
        inputArgs.toArray());
    analyzeDesired("input", "tx_id");
    syncLedger("analysis.input_ledger", "input", "tx_id", LEDGER_VALUES, seq, "changed_input");
  }

  /** Published Alert versions and the integration status of their member transactions. */
  private void freezeAlerts(long seq) {
    jdbc.execute(
        """
        create temp table desired_origins on commit drop as
        select alert_id,published_version as version from review.alerts where published_version is not null
        """);
    analyzeDesired("origins", "alert_id");
    syncLedger(
        "analysis.alert_origin_ledger", "origins", "alert_id", "alert_id,version", seq, null);
    jdbc.execute(
        """
        create temp table desired_facts on commit drop as
        select distinct t.tx_id,t.integration_status from desired_origins o
        join review.alert_transactions m on m.alert_id=o.alert_id and m.version=o.version
        join ledger.transactions t using(tx_id)
        """);
    analyzeDesired("facts", "tx_id");
    syncLedger("analysis.fact_ledger", "facts", "tx_id", "tx_id,integration_status", seq, null);
  }

  /**
   * Completed current scores of the eligible transactions. They are kept for eligible transactions
   * only, so a frozen TARGET outside the eligible set must not carry one yet; TARGET selection
   * already excludes every transaction a completed run scored.
   *
   * <p>A transaction's entry can differ from the previous freeze when its eligibility was
   * re-evaluated, or when the run holding its current score started or stopped counting as
   * completed. Such a run is a completed run with no open entry yet, or one with an open entry
   * whose job is no longer completed; a run's entries are opened together, so one probe tells.
   */
  private void freezeScores(UUID run, long seq) {
    String completed =
        """
        join analysis.current_scores c using(tx_id)
        join analysis.runs r on r.run_id=c.run_id join analysis.jobs b on b.job_id=r.job_id
        where r.status='COMPLETED' and b.status='COMPLETED'
        """;
    // Frozen rows outside the eligible set come first: normally none, and found by comparing
    // analyzed temp tables. Joined with the scores in one pass, this check took 50 minutes on
    // some days of a 5.5M-row history.
    if (jdbc.queryForObject(
        "select exists(with unchecked as materialized (select f.tx_id from frozen_input f"
            + " where f.run_id=? and not exists(select 1 from desired_input e where e.tx_id=f.tx_id)),"
            + " outside as materialized (select f.tx_id from unchecked f where not exists("
            + "select 1 from analysis.input_ledger l where l.tx_id=f.tx_id and l.valid_to_seq is null))"
            + " select 1 from outside f "
            + completed
            + ")",
        Boolean.class,
        run)) throw new IllegalStateException("FROZEN_TARGET_ALREADY_SCORED");
    String turned =
        jdbc
            .queryForList(
                """
            select r.run_id::text from analysis.runs r join analysis.jobs b using(job_id)
            left join lateral (select true as open from (select s.tx_id from analysis.scores s
                where s.run_id=r.run_id order by s.tx_id offset 0) s
              cross join lateral (select 1 from analysis.score_ledger l
                where l.tx_id=s.tx_id and l.score_run_id=r.run_id and l.valid_to_seq is null offset 0) l
              limit 1) entry on true
            where r.status='COMPLETED' and (entry.open is null or b.status<>'COMPLETED')
            """,
                String.class)
            .stream()
            .collect(Collectors.joining(",", "{", "}"));
    jdbc.execute("create temp table changed_scores(tx_id bigint primary key) on commit drop");
    jdbc.update(
        """
        insert into changed_scores
        select tx_id from changed_input
        union select tx_id from analysis.scores where run_id=any(?::uuid[])
        """,
        turned);
    jdbc.execute("analyze changed_scores");
    jdbc.execute(
        "create temp table desired_scores on commit drop as select k.tx_id,c.run_id as score_run_id"
            + " from changed_scores k cross join lateral (select c.run_id from analysis.input_ledger l "
            + completed.replace("where", "where l.tx_id=k.tx_id and l.valid_to_seq is null and")
            + " offset 0) c");
    analyzeDesired("scores", "tx_id");
    syncLedger(
        "analysis.score_ledger", "scores", "tx_id", "tx_id,score_run_id", seq, "changed_scores");
  }

  private static String prefixed(String alias, String columns) {
    return Arrays.stream(columns.split(","))
        .map(column -> alias + "." + column)
        .collect(Collectors.joining(","));
  }

  private void analyzeDesired(String name, String key) {
    jdbc.execute("alter table desired_" + name + " add primary key(" + key + ")");
    jdbc.execute("analyze desired_" + name);
  }

  /**
   * Writes only what changed between a ledger's open versions and the desired temp table (key
   * first, then the frozen values): versions no longer desired, or desired with other values, close
   * at seq, and desired rows without an equal open version open at seq. The comparison runs between
   * analyzed temp tables: a ledger's own statistics may predate this transaction, and an anti-join
   * planned against them once rescanned the growing ledger per row. With a scope table, only the
   * keys it lists are compared and every other open version stays as it is.
   */
  private void syncLedger(
      String ledger, String name, String key, String columns, long seq, String scope) {
    String values = columns.substring(key.length() + 1);
    String same =
        "(" + prefixed("d", values) + ") is not distinct from (" + prefixed("o", values) + ")";
    String open = "open_" + name, closing = "closing_" + name, desired = "desired_" + name;
    jdbc.execute(
        "create temp table "
            + open
            + " on commit drop as select * from "
            + desired
            + " with no data");
    jdbc.update(
        scope == null
            ? "insert into %s select %s from %s where valid_to_seq is null"
                .formatted(open, columns, ledger)
            : "insert into %s select l.* from %s k cross join lateral (select %s from %s where %s=k.%s and valid_to_seq is null offset 0) l"
                .formatted(open, scope, columns, ledger, key, key));
    jdbc.execute("alter table " + open + " add primary key(" + key + ")");
    jdbc.execute("analyze " + open);
    jdbc.execute(
        "create temp table %s on commit drop as select o.%s from %s o left join %s d on d.%s=o.%s and %s where d.%s is null"
            .formatted(closing, key, open, desired, key, key, same, key));
    jdbc.execute("analyze " + closing);
    jdbc.update(
        "update %s l set valid_to_seq=? from %s c where l.%s=c.%s and l.valid_to_seq is null"
            .formatted(ledger, closing, key, key),
        seq);
    jdbc.update(
        "insert into %s(valid_from_seq,%s) select ?,d.* from %s d left join %s o on o.%s=d.%s and %s where o.%s is null"
            .formatted(ledger, columns, desired, open, key, key, same, key),
        seq);
  }

  private void freezeManifest(UUID run, Instant cutoff) {
    jdbc.update(
        """
        insert into analysis.source_manifest(run_id,business_date,state)
        select ?,d.business_date,jsonb_build_object(
          'scopeRevision',s.scope_revision,
          'banks',coalesce((select jsonb_agg(sb.bank_id order by sb.bank_id)
            from ingest.reporting_scope_banks sb where sb.business_date=d.business_date),'[]'::jsonb),
          'reports',coalesce((select jsonb_agg(jsonb_build_object(
            'setId',rs.set_id,'bankId',rs.bank_id,'versionId',rv.version_id,
            'revision',rv.revision,'generation',rs.generation,'status',rv.stage_status)
            order by rs.set_id) from ingest.report_sets rs
            join ingest.report_versions rv on rv.version_id=rs.current_version_id
            where rs.business_date=d.business_date and rv.received_at<=?),'[]'::jsonb))
        from (select business_date from ingest.reporting_scopes union select business_date from ingest.report_sets) d
        left join ingest.reporting_scopes s using(business_date)
        where d.business_date <= (?::timestamptz at time zone 'Asia/Seoul')::date
        """,
        run,
        Timestamp.from(cutoff),
        Timestamp.from(cutoff));
  }
}
