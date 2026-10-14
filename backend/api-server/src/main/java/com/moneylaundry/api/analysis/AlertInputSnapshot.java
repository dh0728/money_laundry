package com.moneylaundry.api.analysis;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
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
    // Freeze the full eligible ledger: root windows and transitive seed links
    // are evaluated by one flow policy, not a second calendar policy in SQL.
    jdbc.update(
        """
        insert into analysis.alert_origins
        select ?,a.alert_id,a.published_version from review.alerts a
        where a.published_version is not null
        """,
        run);
    jdbc.update(
        """
        insert into analysis.alert_fact_checks
        select distinct ?,t.tx_id,t.integration_status from analysis.alert_origins o
        join review.alert_transactions m using(alert_id,version)
        join ledger.transactions t using(tx_id) where o.run_id=?
        """,
        run,
        run);
    freezeLedger(run, cutoff, blockedSets);
    jdbc.update(
        """
        insert into analysis.input_report_sets select distinct ?,s.set_id
        from frozen_input i join ledger.transaction_reports tr using(tx_id)
        join private.bank_reports br using(report_id) join ingest.report_sets s on s.current_version_id=br.version_id
        where i.run_id=? on conflict do nothing
        """,
        run,
        run);
    jdbc.update(
        """
        insert into analysis.input_scores
        select ?,i.tx_id,s.run_id,to_jsonb(s)-'run_id'-'tx_id'
        from frozen_input i join analysis.current_scores c using(tx_id)
        join analysis.scores s on s.tx_id=c.tx_id and s.run_id=c.run_id
        join analysis.runs r on r.run_id=s.run_id
        join analysis.jobs b on b.job_id=r.job_id
        where i.run_id=? and r.status='COMPLETED' and b.status='COMPLETED'
        """,
        run,
        run);
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
   * Brings the shared input ledger to this cutoff and blocked sets, writing only the versions that
   * changed. The ledger holds every eligible transaction (this run's TARGET included); run_inputs
   * subtracts each run's own rows, so CONTEXT equals the former full per-run copy.
   */
  private void freezeLedger(UUID run, Instant cutoff, Set<Long> blockedSets) {
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
        "create temp table eligible_input on commit drop as select * from analysis.input_ledger with no data");
    jdbc.execute("alter table eligible_input drop column valid_from_seq, drop column valid_to_seq");
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
        insert into eligible_input
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
    jdbc.execute("alter table eligible_input add primary key(tx_id)");
    jdbc.execute("analyze eligible_input");
    // Compare in analyzed temp tables: the ledger's own statistics may predate this transaction,
    // and an anti-join planned against them once rescanned the growing ledger per row.
    jdbc.execute(
        "create temp table open_input on commit drop as select * from eligible_input with no data");
    jdbc.update(
        "insert into open_input select "
            + LEDGER_VALUES
            + " from analysis.input_ledger where valid_to_seq is null");
    jdbc.execute("alter table open_input add primary key(tx_id)");
    jdbc.execute("analyze open_input");
    // A version stays open only while the transaction is eligible with the same frozen values.
    String same =
        "(e.occurred_at,e.business_date,e.from_bank_id,e.to_bank_id,e.from_account_id,e.to_account_id,"
            + "e.from_owner_id,e.to_owner_id,e.amount_received,e.receiving_currency,e.amount_paid,"
            + "e.payment_currency,e.payment_format,e.amount_usd,e.fx_rate_version) is not distinct from "
            + "(o.occurred_at,o.business_date,o.from_bank_id,o.to_bank_id,o.from_account_id,o.to_account_id,"
            + "o.from_owner_id,o.to_owner_id,o.amount_received,o.receiving_currency,o.amount_paid,"
            + "o.payment_currency,o.payment_format,o.amount_usd,o.fx_rate_version)";
    jdbc.execute(
        "create temp table closing on commit drop as select o.tx_id from open_input o"
            + " left join eligible_input e on e.tx_id=o.tx_id and "
            + same
            + " where e.tx_id is null");
    jdbc.execute("analyze closing");
    jdbc.update(
        """
        update analysis.input_ledger l set valid_to_seq=? from closing c
        where l.tx_id=c.tx_id and l.valid_to_seq is null
        """,
        seq);
    jdbc.update(
        "insert into analysis.input_ledger(valid_from_seq,"
            + LEDGER_VALUES
            + ") select ?,e.* from eligible_input e left join open_input o on o.tx_id=e.tx_id and "
            + same
            + " where o.tx_id is null",
        seq);
    // After the update the open versions are exactly the eligible set, valid at this newest mark.
    jdbc.update(
        "insert into frozen_input select ?,tx_id,business_date from eligible_input on conflict do nothing",
        run);
    jdbc.execute("analyze frozen_input");
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
