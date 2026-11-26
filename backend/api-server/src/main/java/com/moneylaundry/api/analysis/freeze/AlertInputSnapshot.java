package com.moneylaundry.api.analysis.freeze;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Called inside FREEZE_INPUT's ingest lock and transaction. */
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
      where t.tx_id=""";

  /**
   * Tables ledger loading fills. Right after their first load they have no statistics until
   * autovacuum reaches them, and without statistics the planner can walk a whole table for each
   * transaction instead of looking the transaction up. A freeze analyzes those never analyzed.
   */
  private static final List<String> LOADED =
      List.of("ledger.transactions", "core.accounts", "core.owners", "ingest.uploads");

  private final JdbcTemplate jdbc;

  public AlertInputSnapshot(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
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

  public void freeze(UUID run, Instant cutoff) {
    complete(run, cutoff, prepare(run, cutoff));
  }

  /**
   * Records the run's source files and input_seq and lists the transactions whose eligibility can
   * differ from the previous freeze (changed_input). TARGET selection reads the same list, so it
   * runs between this and {@link #complete}.
   */
  public long prepare(UUID run, Instant cutoff) {
    openFrozen(jdbc, run);
    for (String table : LOADED)
      if (jdbc.queryForObject(
          "select reltuples<0 from pg_class where oid=?::regclass", Boolean.class, table))
        jdbc.execute("analyze " + table);
    freezeManifest(run, cutoff);
    return changedInput(run, cutoff);
  }

  public void complete(UUID run, Instant cutoff, long seq) {
    freezeLedger(run, cutoff, seq);
    freezeAlerts(seq);
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
          select ?,?,count(u.upload_id)>0,coalesce(sum(u.row_count),0)::integer
          from analysis.source_manifest m join ingest.uploads u using(upload_id)
          where m.run_id=? and u.business_date=?
          """,
          run,
          day,
          run,
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

  /** The loaded ledger files received by the cutoff: what this run's input stands on. */
  private void freezeManifest(UUID run, Instant cutoff) {
    jdbc.update(
        """
        insert into analysis.source_manifest(run_id,upload_id)
        select ?,upload_id from ingest.uploads where status='COMPLETED' and received_at<=?
        """,
        run,
        Timestamp.from(cutoff));
  }

  /**
   * Brings the shared input ledger to this cutoff and returns this run's input_seq. The ledger
   * holds every eligible transaction (this run's TARGET included); run_inputs subtracts each run's
   * own rows, so CONTEXT is every other eligible transaction.
   *
   * <p>A transaction is eligible when the file that loaded it was received by the cutoff (it is in
   * the run's manifest) and it occurred by the cutoff. Loaded transactions never change, so only
   * the transactions of files in one manifest but not the other, and those timed between the two
   * cutoffs, can differ from the previous freeze. The first freeze has no previous run and
   * re-evaluates everything.
   */
  private long changedInput(UUID run, Instant cutoff) {
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
    jdbc.update(
        "update analysis.runs set input_seq=?,input_cutoff_at=? where run_id=?", seq, at, run);
    jdbc.execute("create temp table changed_uploads(upload_id bigint primary key) on commit drop");
    jdbc.update(
        """
        insert into changed_uploads
        select upload_id from (select upload_id from analysis.source_manifest where run_id=?) was
        full join (select upload_id from analysis.source_manifest where run_id=?) stands using(upload_id)
        where was.upload_id is null or stands.upload_id is null
        """,
        previous,
        run);
    jdbc.execute("analyze changed_uploads");
    jdbc.execute("create temp table changed_input(tx_id bigint primary key) on commit drop");
    jdbc.update(
        """
        insert into changed_input
        select t.tx_id from changed_uploads u
          cross join lateral (select t.tx_id from ledger.transactions t
            where t.upload_id=u.upload_id offset 0) t
        union
        select t.tx_id from ledger.transactions t cross join (select coalesce(
            (select input_cutoff_at from analysis.runs where run_id=?),'-infinity') as at) was
        where t.occurred_at>least(was.at,?) and t.occurred_at<=greatest(was.at,?)
        """,
        previous,
        at,
        at);
    jdbc.execute("analyze changed_input");
    return seq;
  }

  private void freezeLedger(UUID run, Instant cutoff, long seq) {
    jdbc.execute(
        "create temp table desired_input on commit drop as select "
            + LEDGER_VALUES
            + " from analysis.input_ledger with no data");
    jdbc.update(
        """
        with eligible as materialized (
          select k.tx_id from changed_input k
          cross join lateral (select 1 from ledger.transactions t
            join analysis.source_manifest m on m.upload_id=t.upload_id and m.run_id=?
            where t.tx_id=k.tx_id and t.occurred_at<=? offset 0) source
        )
        insert into desired_input
        select v.* from eligible c cross join lateral (%s c.tx_id offset 0) v
        """
            .formatted(LEDGER_ROW),
        run,
        Timestamp.from(cutoff));
    analyzeDesired("input", "tx_id");
    syncLedger("analysis.input_ledger", "input", "tx_id", LEDGER_VALUES, seq, "changed_input");
  }

  /** Published Alert versions. */
  private void freezeAlerts(long seq) {
    jdbc.execute(
        """
        create temp table desired_origins on commit drop as
        select alert_id,published_version as version from review.alerts where published_version is not null
        """);
    analyzeDesired("origins", "alert_id");
    syncLedger(
        "analysis.alert_origin_ledger", "origins", "alert_id", "alert_id,version", seq, null);
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
}
