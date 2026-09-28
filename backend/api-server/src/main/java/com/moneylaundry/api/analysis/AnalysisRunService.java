package com.moneylaundry.api.analysis;

import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Durable input generations and cancellation fencing; transport is an explicit seam. */
@Service
public class AnalysisRunService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final Clock clock;
  private final ObjectMapper mapper;

  public AnalysisRunService(
      JdbcTemplate jdbc, TransactionTemplate tx, Clock clock, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.clock = clock;
    this.mapper = mapper;
  }

  public static void integrationLock(JdbcTemplate jdbc) {
    jdbc.query("select pg_advisory_xact_lock(17004000)", rs -> {});
  }

  public UUID current(long job) {
    return jdbc.queryForObject(
        "select current_run_id from batch_jobs where job_id=?", UUID.class, job);
  }

  private Map<String, Object> lock(UUID run) {
    integrationLock(jdbc);
    var rows = jdbc.queryForList("select * from analysis_runs where run_id=? for update", run);
    if (rows.isEmpty()) throw new IllegalArgumentException("RUN_NOT_FOUND");
    return rows.getFirst();
  }

  public boolean completedTarget(long id) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from analysis.input_transactions i join analysis_runs r using(run_id) where i.tx_id=? and i.input_role='TARGET' and r.status='COMPLETED') or exists(select 1 from transactions t join batch_jobs b on b.job_id=t.scored_job_id where t.tx_id=? and b.status='COMPLETED')",
            Boolean.class,
            id,
            id));
  }

  public void cancelAffected(Set<Long> changed) {
    for (long id : changed) {
      var runs =
          jdbc.queryForList(
              "select distinct r.run_id from analysis.input_transactions i join analysis_runs r using(run_id) where i.tx_id=? and r.status in ('READY','ACTIVE') order by r.run_id",
              UUID.class,
              id);
      for (UUID run : runs) cancel(run, "REPORT_CORRECTED");
    }
  }

  public void cancel(UUID run, String reason) {
    if (!"REPORT_CORRECTED".equals(reason))
      throw new IllegalArgumentException("INVALID_CANCEL_REASON");
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          if ("COMPLETED".equals(r.get("status")))
            throw new IllegalStateException("RUN_ALREADY_COMPLETED");
          if (!List.of("CANCEL_REQUESTED", "CANCELLED").contains(r.get("status"))) {
            jdbc.update(
                "update analysis_runs set status='CANCEL_REQUESTED',cancel_requested_at=?,cancel_reason=? where run_id=?",
                Timestamp.from(clock.instant()),
                reason,
                run);
            jdbc.update(
                "update batch_jobs set status='FAILED',error_code='RUN_CANCELLED',error_message='정정으로 실행이 취소되었습니다.',execution_id=null,execution_owner=null,retry_at=null where current_run_id=?",
                run);
          }
          jdbc.update(
              """
              update analysis_model_tasks set status='CANCELLED',execution_id=null,
                execution_owner=null,retry_at=null,next_poll_at=null,error_code='RUN_CANCELLED',
                action_required=false,updated_at=?,finished_at=coalesce(finished_at,?)
              where run_id=? and status<>'CANCELLED'
              """,
              Timestamp.from(clock.instant()),
              Timestamp.from(clock.instant()),
              run);
          for (var request :
              jdbc.queryForList("select * from analysis_model_requests where run_id=?", run))
            enqueueCancel(r, request, reason);
          jdbc.update(
              "update analysis_runs set status='CANCELLED' where run_id=? and not exists(select 1 from analysis_model_requests where run_id=? and status not in ('STOPPED','ALREADY_FINISHED','BLOCKED'))",
              run,
              run);
        });
  }

  private void enqueueCancel(Map<String, Object> run, Map<String, Object> request, String reason) {
    UUID requestId = (UUID) request.get("request_id");
    int round = (Integer) request.get("execution_round");
    if ("REGISTERED".equals(request.get("status"))) {
      jdbc.update(
          "update analysis_model_requests set status='BLOCKED' where request_id=? and execution_round=?",
          requestId,
          round);
      return;
    }
    if (!"PUBLISHED".equals(request.get("status"))) return;
    UUID cancel = UUID.randomUUID();
    Instant now = clock.instant();
    var payload =
        Map.of(
            "contract_version",
            2,
            "job_id",
            run.get("job_id"),
            "model_kind",
            request.get("model_kind"),
            "request_id",
            requestId,
            "execution_round",
            round,
            "run_id",
            run.get("run_id"),
            "cancel_id",
            cancel,
            "reason_code",
            reason,
            "requested_at",
            now);
    jdbc.update(
        "insert into analysis_cancel_outbox(cancel_id,request_id,execution_round,payload,requested_at) values(?,?,?,?::jsonb,?) on conflict(request_id,execution_round) do nothing",
        cancel,
        requestId,
        round,
        mapper.writeValueAsString(payload),
        Timestamp.from(now));
  }

  public void registerRequest(UUID run, UUID request, int round, String kind) {
    if (round < 1 || !List.of("BINARY", "TYPE").contains(kind))
      throw new IllegalArgumentException("INVALID_REQUEST");
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          requireUsable(r);
          if (!canInfer(run)) throw new IllegalStateException("PREVIOUS_RUN_NOT_STOPPED");
          var prior =
              jdbc.queryForList(
                  "select run_id,model_kind from analysis_model_requests where request_id=?",
                  request);
          if (prior.stream()
              .anyMatch(p -> !run.equals(p.get("run_id")) || !kind.equals(p.get("model_kind"))))
            throw new IllegalStateException("REQUEST_ID_REUSED");
          jdbc.update(
              "insert into analysis_model_requests values(?,?,?,?,'REGISTERED') on conflict do nothing",
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
          if (!canInfer(run)) throw new IllegalStateException("PREVIOUS_RUN_NOT_STOPPED");
          if (jdbc.update(
                  "update analysis_model_requests set status='PUBLISHED' where run_id=? and request_id=? and execution_round=? and status in ('REGISTERED','PUBLISHED')",
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

  public boolean canInfer(UUID run) {
    return jdbc.queryForObject(
        "with recursive predecessors(run_id) as (select replaces_run_id from analysis_run_replacements where run_id=? union select x.replaces_run_id from analysis_run_replacements x join predecessors p on x.run_id=p.run_id) select not exists(select 1 from analysis_model_requests m join predecessors p using(run_id) where m.status not in ('STOPPED','ALREADY_FINISHED','BLOCKED'))",
        Boolean.class,
        run);
  }

  public interface CancelTransport {
    void publish(UUID cancelId, String payload);

    String acknowledgement(UUID cancelId, String payload);
  }

  /** Each immutable record retries independently; no configured transport implies no success. */
  public void deliverCancellations(CancelTransport transport) {
    for (var out :
        jdbc.queryForList(
            "select * from analysis_cancel_outbox where acknowledged_at is null and (retry_at is null or retry_at<=?) order by requested_at",
            Timestamp.from(clock.instant()))) {
      UUID cancel = (UUID) out.get("cancel_id");
      String payload = out.get("payload").toString();
      int attempts = (Integer) out.get("attempts");
      try {
        String ack = transport.acknowledgement(cancel, payload);
        if (ack != null) {
          acknowledge(cancel, ack);
          continue;
        }
        if (attempts >= 3) continue;
        transport.publish(cancel, payload);
        jdbc.update(
            "update analysis_cancel_outbox set delivered_at=coalesce(delivered_at,?),attempts=attempts+1,error_code=null,retry_at=? where cancel_id=?",
            Timestamp.from(clock.instant()),
            Timestamp.from(clock.instant().plusSeconds(attempts == 0 ? 30 : 120)),
            cancel);
      } catch (RuntimeException e) {
        jdbc.update(
            "update analysis_cancel_outbox set attempts=least(3,attempts+1),error_code='CANCEL_DELIVERY_FAILED',retry_at=? where cancel_id=?",
            Timestamp.from(clock.instant().plusSeconds(attempts == 0 ? 30 : 120)),
            cancel);
      }
    }
  }

  public void resumeCancellation(UUID cancel) {
    jdbc.update(
        "update analysis_cancel_outbox set attempts=0,retry_at=null,error_code=null where cancel_id=? and acknowledged_at is null",
        cancel);
  }

  public void acknowledge(UUID cancel, String response) {
    if (!List.of("STOPPED", "ALREADY_FINISHED").contains(response))
      throw new IllegalArgumentException("INVALID_CANCEL_ACK");
    tx.executeWithoutResult(
        s -> {
          integrationLock(jdbc);
          var rows =
              jdbc.queryForList(
                  "select o.*,m.run_id from analysis_cancel_outbox o join analysis_model_requests m using(request_id,execution_round) where cancel_id=? for update",
                  cancel);
          if (rows.isEmpty()) throw new IllegalArgumentException("CANCEL_NOT_FOUND");
          var out = rows.getFirst();
          jdbc.update(
              "update analysis_model_requests set status=? where request_id=? and execution_round=?",
              response,
              out.get("request_id"),
              out.get("execution_round"));
          jdbc.update(
              "update analysis_cancel_outbox set acknowledged_at=coalesce(acknowledged_at,?),error_code=null where cancel_id=?",
              Timestamp.from(clock.instant()),
              cancel);
          jdbc.update(
              "update analysis_runs set status='CANCELLED' where run_id=? and status='CANCEL_REQUESTED' and not exists(select 1 from analysis_model_requests where run_id=? and status not in ('STOPPED','ALREADY_FINISHED','BLOCKED'))",
              out.get("run_id"),
              out.get("run_id"));
        });
  }

  public UUID freeze(long job, Instant cutoff) {
    return tx.execute(
        s -> {
          integrationLock(jdbc);
          UUID existing = current(job);
          if (existing != null) return existing;
          if (jdbc.queryForObject(
                  "select count(*) from analysis_selected_versions a join report_sets s using(set_id) where a.job_id=? and (a.generation<>s.generation or a.version_id<>s.current_version_id)",
                  Integer.class,
                  job)
              > 0) throw new IllegalStateException("INPUT_REVISION_CHANGED");
          Set<Long> selectedSets =
              new HashSet<>(
                  jdbc.queryForList(
                      "select set_id from analysis_selected_versions where job_id=?",
                      Long.class,
                      job));
          Set<Long> blockedSets =
              new HashSet<>(
                  jdbc.queryForList(
                      "select distinct v.set_id from report_versions v join analysis_receipts a on a.upload_id=v.upload_id where a.job_id=? and v.self_valid and v.stage_status in ('WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE') and not exists(select 1 from report_versions newer join analysis_receipts newerReceipt on newerReceipt.upload_id=newer.upload_id where newerReceipt.job_id=a.job_id and newer.set_id=v.set_id and newer.self_valid and newer.version_no>v.version_no)",
                      Long.class,
                      job));
          List<UUID> previous = new ArrayList<>();
          for (UUID prior :
              jdbc.queryForList(
                  "select r.run_id from analysis_runs r where r.status in ('CANCEL_REQUESTED','CANCELLED') and not exists(select 1 from analysis_run_replacements x where x.replaces_run_id=r.run_id) order by r.run_id",
                  UUID.class)) {
            Set<Long> origins =
                new HashSet<>(
                    jdbc.queryForList(
                        "select distinct v.set_id from analysis_input_reports ir join private.bank_reports br using(report_id) join report_versions v using(version_id) where ir.run_id=?",
                        Long.class,
                        prior));
            boolean ready = !origins.isEmpty() && selectedSets.containsAll(origins);
            for (long set : origins) {
              var latest =
                  jdbc.queryForList(
                      "select v.stage_status from report_versions v join analysis_receipts a on a.upload_id=v.upload_id where a.job_id=? and v.set_id=? and v.self_valid order by v.version_no desc limit 1",
                      String.class,
                      job,
                      set);
              if (!latest.isEmpty()
                  && !List.of("ACTIVE", "PARTIALLY_HELD").contains(latest.getFirst()))
                ready = false;
            }
            if (ready) previous.add(prior);
            else blockedSets.addAll(origins);
          }
          UUID run = UUID.randomUUID();
          jdbc.update(
              "insert into analysis_runs(run_id,job_id,status) values(?,?,'READY')", run, job);
          for (UUID old : previous)
            jdbc.update("insert into analysis_run_replacements values(?,?)", run, old);
          var ids =
              jdbc.queryForList(
                  "select t.tx_id from transactions t left join analysis_target_ownership o using(tx_id) left join analysis_runs r on r.run_id=o.run_id where t.integration_status='ACTIVE' and not exists(select 1 from batch_jobs scored where scored.job_id=t.scored_job_id and scored.status='COMPLETED') and (o.run_id is null or exists(select 1 from analysis_run_replacements x where x.run_id=? and x.replaces_run_id=o.run_id)) and exists(select 1 from transaction_reports tr join private.bank_reports br using(report_id) join report_versions v using(version_id) join analysis_selected_versions sv on sv.version_id=v.version_id where tr.tx_id=t.tx_id and sv.job_id=? and v.received_at<=?) order by t.tx_id",
                  Long.class,
                  run,
                  job,
                  Timestamp.from(cutoff));
          ids =
              ids.stream()
                  .filter(
                      id ->
                          Collections.disjoint(
                              blockedSets,
                              jdbc.queryForList(
                                  "select distinct v.set_id from transaction_reports tr join private.bank_reports br using(report_id) join report_versions v using(version_id) where tr.tx_id=?",
                                  Long.class,
                                  id)))
                  .toList();
          for (long id : ids) {
            snapshot(run, id, "TARGET");
            jdbc.update(
                "insert into analysis_target_ownership values(?,?) on conflict(tx_id) do update set run_id=excluded.run_id",
                id,
                run);
          }
          new AlertInputSnapshot(jdbc).freeze(run, cutoff);
          jdbc.update(
              "update batch_jobs set current_run_id=?,row_count=? where job_id=?",
              run,
              ids.size(),
              job);
          return run;
        });
  }

  public void snapshot(UUID run, long id, String role) {
    jdbc.update(
        "insert into analysis.input_transactions select ?,t.tx_id,?,t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,e.service_entity_id,f.service_entity_id,t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version from transactions t join private.accounts a on a.account_id=t.from_account_id join private.accounts b on b.account_id=t.to_account_id join private.entities e on e.entity_id=a.entity_id join private.entities f on f.entity_id=b.entity_id where t.tx_id=?",
        run,
        role,
        id);
    jdbc.update(
        "insert into analysis_input_reports select ?,tr.tx_id,tr.report_id from transaction_reports tr join private.bank_reports br using(report_id) join report_sets s on s.current_version_id=br.version_id where tr.tx_id=? on conflict do nothing",
        run,
        id);
  }

  public boolean accepts(long job, UUID run, UUID execution) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from batch_jobs b join analysis_runs r on r.run_id=b.current_run_id where b.job_id=? and r.run_id=? and b.execution_id=? and b.status='RUNNING' and r.status in ('READY','ACTIVE'))",
            Boolean.class,
            job,
            run,
            execution));
  }

  public void complete(UUID run) {
    tx.executeWithoutResult(
        s -> {
          var r = lock(run);
          requireUsable(r);
          jdbc.update(
              "update analysis_runs set status='COMPLETED',completed_at=? where run_id=?",
              Timestamp.from(clock.instant()),
              run);
        });
  }
}
