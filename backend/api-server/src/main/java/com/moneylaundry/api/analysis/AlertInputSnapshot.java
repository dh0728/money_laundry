package com.moneylaundry.api.analysis;

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
  static void openFrozen(JdbcTemplate jdbc, UUID run) {
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
    openFrozen(jdbc, run);
    freezeManifest(run, cutoff);
    long seq = freezeLedger(run, cutoff, blockedSets);
    freezeAlerts(seq);
    jdbc.update(
        """
        insert into analysis.input_report_sets select distinct ?,s.set_id
        from frozen_input i join ledger.transaction_reports tr using(tx_id)
        join private.bank_reports br using(report_id) join ingest.report_sets s on s.current_version_id=br.version_id
        where i.run_id=? on conflict do nothing
        """,
        run,
        run);
    freezeScores(run, seq);
    var dates =
        jdbc.queryForList(
            """
        select d::date from generate_series(
          (select min(business_date)-3 from frozen_input where run_id=?),
          (?::timestamptz at time zone 'Asia/Seoul')::date, interval '1 day') d order by 1
        """,
            java.sql.Date.class,
            run,
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

  /**
   * Brings the shared input ledger to this cutoff and blocked sets and returns this run's mark. The
   * ledger holds every eligible transaction (this run's TARGET included); run_inputs subtracts each
   * run's own rows, so CONTEXT equals the former full per-run copy.
   */
  private long freezeLedger(UUID run, Instant cutoff, Set<Long> blockedSets) {
    long seq = jdbc.queryForObject("select nextval('analysis.input_ledger_seq')", Long.class);
    if (jdbc.queryForObject(
            "select coalesce(max(run_seq),0) from analysis.input_ledger_marks", Long.class)
        >= seq) throw new IllegalStateException("INPUT_LEDGER_ORDER");
    jdbc.update(
        "insert into analysis.input_ledger_marks values(?,?,?)", run, seq, Timestamp.from(cutoff));
    String blocked = "";
    var inputArgs = new ArrayList<Object>(List.of(Timestamp.from(cutoff)));
    if (!blockedSets.isEmpty()) {
      blocked =
          "and not exists(select 1 from ledger.transaction_reports blocked_tr join private.bank_reports blocked_br using(report_id) join ingest.report_versions blocked_v using(version_id) where blocked_tr.tx_id=t.tx_id and blocked_v.set_id in ("
              + String.join(",", Collections.nCopies(blockedSets.size(), "?"))
              + "))";
      inputArgs.addAll(blockedSets);
    }
    inputArgs.addAll(List.of(Timestamp.from(cutoff), Timestamp.from(cutoff)));
    jdbc.execute(
        "create temp table desired_input on commit drop as select "
            + LEDGER_VALUES
            + " from analysis.input_ledger with no data");
    jdbc.update(
        """
        with eligible as materialized (
          select t.tx_id from ledger.transactions t
          join ledger.transaction_reports tr using(tx_id)
          join private.bank_reports br using(report_id)
          join ingest.report_sets rs on rs.current_version_id=br.version_id
          join ingest.report_versions rv using(version_id)
          where t.integration_status='ACTIVE' and t.occurred_at<=?
            %s
          group by t.tx_id
          having bool_or(rv.received_at<=?) and not bool_or(rv.received_at>?)
        )
        insert into desired_input
        select t.tx_id,t.occurred_at,t.business_date,a.bank_id,b.bank_id,
          a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from eligible c join ledger.transactions t using(tx_id)
        join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id
        join core.owners e on e.owner_id=a.owner_id
        join core.owners f on f.owner_id=b.owner_id
        """
            .formatted(blocked),
        inputArgs.toArray());
    analyzeDesired("input", "tx_id");
    syncLedger("analysis.input_ledger", "input", "tx_id", LEDGER_VALUES, seq);
    // After the sync the open versions are exactly the eligible set, valid at this newest mark.
    jdbc.update(
        "insert into frozen_input select ?,tx_id,business_date from desired_input on conflict do nothing",
        run);
    jdbc.execute("analyze frozen_input");
    return seq;
  }

  /** Published Alert versions and their members' states, as the former per-run copies held them. */
  private void freezeAlerts(long seq) {
    jdbc.execute(
        """
        create temp table desired_origins on commit drop as
        select alert_id,published_version as version from review.alerts where published_version is not null
        """);
    analyzeDesired("origins", "alert_id");
    syncLedger("analysis.alert_origin_ledger", "origins", "alert_id", "alert_id,version", seq);
    jdbc.execute(
        """
        create temp table desired_facts on commit drop as
        select distinct t.tx_id,t.integration_status from desired_origins o
        join review.alert_transactions m on m.alert_id=o.alert_id and m.version=o.version
        join ledger.transactions t using(tx_id)
        """);
    analyzeDesired("facts", "tx_id");
    syncLedger("analysis.fact_ledger", "facts", "tx_id", "tx_id,integration_status", seq);
  }

  /**
   * Completed current scores of the frozen input, as the former input_scores copied them. They are
   * kept for eligible transactions only, so a frozen TARGET outside the eligible set must not carry
   * one yet; TARGET selection already excludes every transaction a completed run scored.
   */
  private void freezeScores(UUID run, long seq) {
    String completed =
        """
        join analysis.current_scores c using(tx_id)
        join analysis.runs r on r.run_id=c.run_id join analysis.jobs b on b.job_id=r.job_id
        """;
    if (jdbc.queryForObject(
        "select exists(select 1 from frozen_input f "
            + completed
            + " where f.run_id=? and r.status='COMPLETED' and b.status='COMPLETED'"
            + " and not exists(select 1 from desired_input e where e.tx_id=f.tx_id))",
        Boolean.class,
        run)) throw new IllegalStateException("FROZEN_TARGET_ALREADY_SCORED");
    jdbc.execute(
        "create temp table desired_scores on commit drop as select tx_id,c.run_id as score_run_id from desired_input "
            + completed
            + " where r.status='COMPLETED' and b.status='COMPLETED'");
    analyzeDesired("scores", "tx_id");
    syncLedger("analysis.score_ledger", "scores", "tx_id", "tx_id,score_run_id", seq);
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
   * planned against them once rescanned the growing ledger per row.
   */
  private void syncLedger(String ledger, String name, String key, String columns, long seq) {
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
        "insert into "
            + open
            + " select "
            + columns
            + " from "
            + ledger
            + " where valid_to_seq is null");
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
