package com.moneylaundry.api.analysis;

import com.moneylaundry.api.analysis.freeze.AlertInputSnapshot;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable input generations of analysis runs and the fencing of their stages. */
@Service
public class AnalysisRunService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final Clock clock;

  public AnalysisRunService(JdbcTemplate jdbc, TransactionTemplate tx, Clock clock) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.clock = clock;
  }

  /** Serializes ledger loading, FREEZE_INPUT and the fenced stage writes. */
  public static void ingestLock(JdbcTemplate jdbc) {
    jdbc.query("select pg_advisory_xact_lock(17004000)", rs -> {});
  }

  public UUID current(long job) {
    return jdbc.queryForObject(
        "select current_run_id from analysis.jobs where job_id=?", UUID.class, job);
  }

  private Map<String, Object> lock(UUID run) {
    ingestLock(jdbc);
    var rows = jdbc.queryForList("select * from analysis.runs where run_id=? for update", run);
    if (rows.isEmpty()) throw new IllegalArgumentException("RUN_NOT_FOUND");
    return rows.getFirst();
  }

  public boolean completedTarget(long id) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from analysis.input_transactions i join analysis.runs r using(run_id) where i.tx_id=? and i.input_role='TARGET' and r.status='COMPLETED')",
            Boolean.class,
            id));
  }

  public void registerRequest(UUID run, UUID request, int round, String kind) {
    if (round < 1 || !List.of("BINARY", "TYPE").contains(kind))
      throw new IllegalArgumentException("INVALID_REQUEST");
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          requireUsable(r);
          var prior =
              jdbc.queryForList(
                  "select run_id,model_kind from analysis.model_requests where request_id=?",
                  request);
          if (prior.stream()
              .anyMatch(p -> !run.equals(p.get("run_id")) || !kind.equals(p.get("model_kind"))))
            throw new IllegalStateException("REQUEST_ID_REUSED");
          jdbc.update(
              "insert into analysis.model_requests values(?,?,?,?,'REGISTERED') on conflict do nothing",
              request,
              round,
              run,
              kind);
        });
  }

  /**
   * Persist before external publication: a crash is conservatively treated as possibly published.
   */
  public void publishRequest(UUID run, UUID request, int round) {
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          requireUsable(r);
          if (jdbc.update(
                  "update analysis.model_requests set status='PUBLISHED' where run_id=? and request_id=? and execution_round=? and status in ('REGISTERED','PUBLISHED')",
                  run,
                  request,
                  round)
              != 1) throw new IllegalStateException("REQUEST_NOT_REGISTERED");
        });
  }

  private void requireUsable(Map<String, Object> r) {
    if (!List.of("READY", "ACTIVE").contains(r.get("status"))
        || !r.get("run_id").equals(current((Long) r.get("job_id"))))
      throw new IllegalStateException("RUN_FENCED");
  }

  public UUID freeze(long job, Instant cutoff) {
    return tx.execute(
        s -> {
          ingestLock(jdbc);
          UUID existing = current(job);
          if (existing != null) return existing;
          UUID run = UUID.randomUUID();
          jdbc.update(
              "insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, job);
          var snapshot = new AlertInputSnapshot(jdbc);
          long seq = snapshot.prepare(run, cutoff);
          int targetCount = freezeTargets(run, job, cutoff);
          snapshot.complete(run, cutoff, seq);
          jdbc.update(
              "update analysis.jobs set current_run_id=?,row_count=? where job_id=?",
              run,
              targetCount,
              job);
          return run;
        });
  }

  /**
   * A transaction can newly qualify as TARGET only if its eligibility could differ from the
   * previous freeze (changed_input, prepared by the snapshot): a transaction of a file the job
   * received (its receipts) that is in the run's manifest (loaded by the cutoff), occurred by the
   * cutoff, and not scored or owned by another run.
   */
  private int freezeTargets(UUID run, long job, Instant cutoff) {
    AlertInputSnapshot.openFrozen(jdbc, run);
    int count =
        jdbc.update(
            """
        with frozen as (
        insert into analysis.input_transactions
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,t.from_bank_id,t.to_bank_id,
          t.from_account_id,t.to_account_id,t.from_owner_id,t.to_owner_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from changed_input k
        cross join lateral (%s k.tx_id offset 0) t
        cross join lateral (select 1 from ledger.transactions x
          join analysis.source_manifest m on m.upload_id=x.upload_id and m.run_id=?
          join analysis.receipts a on a.upload_id=x.upload_id and a.job_id=?
          where x.tx_id=k.tx_id and x.occurred_at<=? offset 0) selected
        left join lateral (select true as hit from analysis.input_transactions scored
          join analysis.runs completed using(run_id)
          where scored.tx_id=k.tx_id and scored.input_role='TARGET' and completed.status='COMPLETED'
          limit 1) scored on true
        left join lateral (select o.run_id from analysis.target_ownership o
          where o.tx_id=k.tx_id offset 0) o on true
        where scored.hit is null and o.run_id is null
        order by t.tx_id returning run_id,tx_id,business_date)
        insert into frozen_input select * from frozen
        """
                .formatted(AlertInputSnapshot.LEDGER_ROW),
            run,
            run,
            job,
            Timestamp.from(cutoff));
    // Only TARGET rows of this run exist yet, so the frozen mirror is exactly the TARGET set.
    jdbc.execute("analyze frozen_input");
    jdbc.update(
        """
        insert into analysis.target_ownership
        select tx_id,run_id from frozen_input where run_id=?
        order by tx_id on conflict(tx_id) do update set run_id=excluded.run_id
        """,
        run);
    return count;
  }

  public void snapshot(UUID run, long id, String role) {
    jdbc.update(
        "insert into analysis.input_transactions select ?,t.tx_id,?,t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id join core.accounts b on b.account_id=t.to_account_id join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id where t.tx_id=?",
        run,
        role,
        id);
  }

  public void complete(UUID run) {
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          requireUsable(r);
          jdbc.update(
              "update analysis.runs set status='COMPLETED',completed_at=? where run_id=?",
              Timestamp.from(clock.instant()),
              run);
          jdbc.update(
              """
              insert into analysis.current_scores(tx_id,run_id)
              select s.tx_id,s.run_id from analysis.scores s
              cross join lateral (select 1 from analysis.input_transactions i
                where i.run_id=s.run_id and i.tx_id=s.tx_id and i.input_role='TARGET' offset 0) i
              where s.run_id=?
              order by s.tx_id
              on conflict(tx_id) do update set run_id=excluded.run_id
              """,
              run);
        });
  }

  /** Lets later stages plan the new run's frozen rows with statistics that include its run id. */
  public void refreshInputStatistics() {
    jdbc.execute(
        """
        analyze analysis.runs, analysis.input_transactions, analysis.input_ledger,
          analysis.source_manifest, analysis.score_ledger, analysis.alert_origin_ledger
        """);
  }

  /**
   * Collect planner statistics after bulk publication, including small run/job tables that may
   * never reach autovacuum's default analyze threshold in a demo.
   */
  public void refreshQueryStatistics() {
    jdbc.execute(
        """
        analyze core.owners, core.accounts, ledger.transactions,
          analysis.jobs, analysis.runs, analysis.scores, analysis.current_scores,
          review.alerts, review.alert_versions, review.alert_transactions,
          review.alert_tx_edits, review.judgments,
          review.episodes, review.episode_alerts
        """);
  }
}
