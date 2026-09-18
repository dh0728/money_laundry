package com.moneylaundry.api.analysis;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Component;

@Component
public class AnalysisRunner implements AutoCloseable {
  private final AnalysisService service;
  private final AnalysisStageExecutor executor;
  private final UUID owner = UUID.randomUUID();
  private final Map<Long, Pending> pending = new HashMap<>();
  private Connection leadership;
  private final AnalysisRunService runs;
  private final com.moneylaundry.api.ingest.TransactionIntegrationService integration;

  private record Failure(
      UUID id,
      String code,
      AnalysisFailure.Kind kind,
      Instant at,
      int count,
      Instant retryAt,
      boolean terminal) {}

  private static final class Pending {
    final AnalysisService.Job job;
    AnalysisStageExecutor.Context context;
    AnalysisStageExecutor.Result result;
    Instant nextFlushAt;
    final List<Failure> failures = new ArrayList<>();

    Pending(AnalysisService.Job job) {
      this.job = job;
    }
  }

  public AnalysisRunner(AnalysisService service, AnalysisStageExecutor executor) {
    this(service, executor, null, null);
  }

  @org.springframework.beans.factory.annotation.Autowired
  public AnalysisRunner(AnalysisService service, AnalysisStageExecutor executor,
      AnalysisRunService runs, com.moneylaundry.api.ingest.TransactionIntegrationService integration) {
    this.service = service;
    this.executor = executor;
    this.runs = runs;
    this.integration = integration;
  }

  public synchronized void recover() {
    withExecutionLock(this::recoverOwned);
  }

  private void recoverOwned() {
    try {
      service.jdbc.update(
          """
          update batch_jobs set status='QUEUED',execution_id=null,execution_owner=null
          where job_type='ANALYSIS' and status='RUNNING' and execution_owner is distinct from ?
          """,
          owner);
    } catch (DataAccessException ignored) {
      /* Next scan retries recovery; no missing-date registration. */
    }
  }

  public synchronized void scan() {
    withExecutionLock(this::scanOwned);
  }

  private void withExecutionLock(Runnable action) {
    try {
      if (leadership != null && !leadership.isValid(1)) close();
      if (leadership == null) {
        Connection candidate = service.jdbc.getDataSource().getConnection();
        try (var statement = candidate.createStatement();
            var result = statement.executeQuery("select pg_try_advisory_lock(17002002)")) {
          result.next();
          if (result.getBoolean(1)) leadership = candidate;
        } finally {
          if (leadership != candidate) candidate.close();
        }
      }
      if (leadership != null) action.run();
    } catch (SQLException | DataAccessException ignored) {
      /* No ownership acquired: do not start a second execution. */
    }
  }

  @Override
  @jakarta.annotation.PreDestroy
  public synchronized void close() {
    if (leadership == null) return;
    try (var statement = leadership.createStatement()) {
      statement.execute("select pg_advisory_unlock(17002002)");
    } catch (SQLException ignored) {
      /* A lost session has already released its lock. */
    } finally {
      try {
        leadership.close();
      } catch (SQLException ignored) {
      }
      leadership = null;
    }
  }

  private void scanOwned() {
    recoverOwned();
    Set<Long> flushed = new HashSet<>(pending.keySet());
    for (Pending item : List.copyOf(pending.values())) flush(item);
    try {
      var ids =
          service.jdbc.queryForList(
              """
              select job_id from batch_jobs where job_type='ANALYSIS' and
              (status='QUEUED' or (status='RETRY_WAIT' and retry_at<=?)) order by job_id
              """,
              Long.class,
              Timestamp.from(service.clock.instant()));
      for (long id : ids) if (!pending.containsKey(id) && !flushed.contains(id)) run(id);
    } catch (DataAccessException ignored) {
      /* State is retained; scan is not an execution attempt. */
    }
  }

  private void run(long id) {
    Pending item;
    try {
      item =
          service.tx.execute(
              status -> {
                service.lock(id);
                var job = service.job(id);
                if (!job.status().equals("QUEUED")
                    && !(job.status().equals("RETRY_WAIT")
                        && job.retryAt() != null
                        && !job.retryAt().isAfter(service.clock.instant()))) return null;
                service.jdbc.update(
                    "update batch_jobs set started_at=coalesce(started_at,?) where job_id=?",
                    Timestamp.from(service.clock.instant()),
                    id);
                if (job.stage() == AnalysisStage.WAIT_INGEST && waitForIngest(id)) return null;
                if(runs!=null && job.stage()==AnalysisStage.INFERENCE && runs.current(id)!=null && !runs.canInfer(runs.current(id)))return null;
                UUID token = UUID.randomUUID();
                service.jdbc.update(
                    """
                    update batch_jobs set status='RUNNING',attempt_count=attempt_count+1,
                    stage_attempt_count=stage_attempt_count+1,execution_id=?,execution_owner=?,retry_at=null,
                    started_at=coalesce(started_at,?) where job_id=?
                    """,
                    token,
                    owner,
                    Timestamp.from(service.clock.instant()),
                    id);
                return new Pending(service.job(id));
              });
      if (item == null) return;
    } catch (DataAccessException ignored) {
      return;
    }
    pending.put(id, item);
    try {
      var uploads =
          service.jdbc.queryForList(
              "select upload_id from analysis_uploads where job_id=? and not excluded order by"
                  + " upload_id",
              Long.class,
              id);
      Map<String, String> artifacts = new LinkedHashMap<>();
      service.jdbc.query(
          "select stage,artifact from analysis_stage_results where job_id=? and completed and not exists(select 1 from batch_jobs where job_id=analysis_stage_results.job_id and current_run_id is not null)",
          rs -> {
            artifacts.put(rs.getString(1), rs.getString(2));
          },
          id);
      UUID currentRun=runs==null?null:runs.current(id);
      if(currentRun!=null)service.jdbc.query("select stage,artifact from analysis_run_stage_results where run_id=? and completed",rs->{artifacts.put(rs.getString(1),rs.getString(2));},currentRun);
      item.context =
          new AnalysisStageExecutor.Context(
              id, item.job.stage(), item.job.executionId(), uploads, artifacts, runs==null?null:runs.current(id));
      var saved =
          service.jdbc.queryForList(
              "select artifact from analysis_stage_results where job_id=? and stage=? and not"
                  + " completed",
              String.class,
              id,
              item.job.stage().name());
      if(currentRun!=null)saved=service.jdbc.queryForList("select artifact from analysis_run_stage_results where run_id=? and stage=? and not completed",String.class,currentRun,item.job.stage().name());
      item.result =
          saved.isEmpty()
              ? item.job.stage()==AnalysisStage.INTEGRATE||item.job.stage()==AnalysisStage.FREEZE_INPUT
                  ? new AnalysisStageExecutor.Result("internal") : executor.prepare(item.context)
              : new AnalysisStageExecutor.Result(saved.getFirst());
    } catch (AnalysisFailure failure) {
      addFailure(item, failure.code(), failure.kind());
    } catch (DataAccessException failure) {
      addFailure(item, "DB_UNAVAILABLE", AnalysisFailure.Kind.CONNECTION);
    } catch (RuntimeException failure) {
      addFailure(item, "STAGE_EXECUTION_FAILED", AnalysisFailure.Kind.COMPUTATION);
    }
    flush(item);
  }

  private boolean waitForIngest(long id) {
    if(runs==null && service.jdbc.queryForObject("select count(*) from analysis_uploads a join report_versions v on v.upload_id=a.upload_id where a.job_id=?",Integer.class,id)>0) {
      service.jdbc.update("update batch_jobs set status='FAILED',error_code='INTEGRATION_NOT_CONNECTED',finished_at=? where job_id=?",Timestamp.from(service.clock.instant()),id);
      return true;
    }
    var states =
        service.jdbc.queryForList(
            "select b.status from "+(runs==null?"analysis_uploads":"analysis_receipts")+" a join batch_jobs b on b.job_id=a.upload_id"
                + " where a.job_id=?",
            String.class,
            id);
    if (states.contains("FAILED")) {
      service.jdbc.update(
          "update batch_jobs set status='FAILED',error_code='INGEST_FAILED',error_message='대상 파일 적재"
              + " 오류를 조치한 뒤 재개하세요.',finished_at=? where job_id=?",
          Timestamp.from(service.clock.instant()),
          id);
      return true;
    }
    if (states.stream().anyMatch(s -> !s.equals("COMPLETED") && !s.equals("VALIDATION_FAILED"))) {
      service.jdbc.update(
          "update batch_jobs set status='RETRY_WAIT',retry_at=? where job_id=?",
          Timestamp.from(service.clock.instant().plusSeconds(5)),
          id);
      return true;
    }
    service.jdbc.update(
        "update analysis_uploads a set excluded=true from batch_jobs b where a.upload_id=b.job_id"
            + " and a.job_id=? and b.status='VALIDATION_FAILED'",
        id);
    if(runs!=null) {
      service.jdbc.update("update batch_jobs set status='QUEUED',current_stage='INTEGRATE',retry_at=null where job_id=?",id);
      return true;
    }
    long rows =
        service.jdbc.queryForObject(
            "select count(distinct t.tx_id) from transactions t join transaction_reports tr"
                + " using(tx_id) join private.bank_reports br using(report_id) join report_versions"
                + " rv using(version_id) join analysis_uploads a on a.upload_id=rv.upload_id where"
                + " a.job_id=? and not a.excluded and (t.scored_job_id is null or"
                + " t.scored_job_id=?)",
            Long.class,
            id,
            id);
    if (rows == 0) {
      service.jdbc.update(
          "update batch_jobs set"
              + " status='COMPLETED',current_stage='COMPLETE',completion_reason='EMPTY_INPUT',row_count=0,suspicious_tx_count=0,alert_count=0,finished_at=?,retry_at=null"
              + " where job_id=?",
          Timestamp.from(service.clock.instant()),
          id);
    } else {
      service.jdbc.update(
          "update batch_jobs set status='QUEUED',current_stage='FEATURES',row_count=?,retry_at=null"
              + " where job_id=?",
          rows,
          id);
    }
    return true;
  }

  private void addFailure(Pending item, String code, AnalysisFailure.Kind kind) {
    Failure previous = item.failures.isEmpty() ? null : item.failures.getLast();
    String priorCode = previous == null ? item.job.error() : previous.code();
    int priorCount = previous == null ? item.job.failures() : previous.count();
    int count = code.equals(priorCode) ? priorCount + 1 : 1;
    boolean terminal = kind == AnalysisFailure.Kind.PERMANENT || count >= 3;
    Instant now = service.clock.instant();
    long delay =
        kind == AnalysisFailure.Kind.CONNECTION ? (count == 1 ? 30 : 120) : (count == 1 ? 60 : 300);
    item.failures.add(
        new Failure(
            UUID.randomUUID(),
            code,
            kind,
            now,
            count,
            terminal ? null : now.plusSeconds(delay),
            terminal));
  }

  private void flush(Pending item) {
    Failure last = item.failures.isEmpty() ? null : item.failures.getLast();
    if (item.nextFlushAt != null && item.nextFlushAt.isAfter(service.clock.instant())) return;
    try {
      service.tx.executeWithoutResult(
          status -> {
            service.lock(item.job.id());
            if (!service.owns(item.job)) return;
            for (Failure failure : item.failures)
              service.jdbc.update(
                  """
                  insert into analysis_failures(failure_id,job_id,stage,execution_id,error_code,failed_at,consecutive_count,retry_at,action_required)
                  values(?,?,?,?,?,?,?,?,?) on conflict(failure_id) do nothing
                  """,
                  failure.id(),
                  item.job.id(),
                  item.job.stage().name(),
                  item.job.executionId(),
                  failure.code(),
                  Timestamp.from(failure.at()),
                  failure.count(),
                  failure.retryAt() == null ? null : Timestamp.from(failure.retryAt()),
                  failure.terminal());
            if (last != null
                && (item.result == null
                    || last.terminal()
                    || last.kind() != AnalysisFailure.Kind.CONNECTION)) {
              if(item.result!=null && item.context.runId()!=null)service.jdbc.update("insert into analysis_run_stage_results values(?,?,?,?,false) on conflict(run_id,stage) do nothing",item.context.runId(),item.job.stage().name(),item.job.executionId(),item.result.artifact());
              if (item.result != null && item.context.runId()==null)
                service.jdbc.update(
                    "insert into"
                        + " analysis_stage_results(job_id,stage,execution_id,artifact,completed)"
                        + " values(?,?,?,?,false) on conflict(job_id,stage) do nothing",
                    item.job.id(),
                    item.job.stage().name(),
                    item.job.executionId(),
                    item.result.artifact());
              service.jdbc.update(
                  "update batch_jobs set status=?,error_code=?,error_message='분석 단계 처리에"
                      + " 실패했습니다.',consecutive_failures=?,retry_at=?,finished_at=? where job_id=?",
                  last.terminal() ? "FAILED" : "RETRY_WAIT",
                  last.code(),
                  last.count(),
                  last.retryAt() == null ? null : Timestamp.from(last.retryAt()),
                  last.terminal() ? Timestamp.from(last.at()) : null,
                  item.job.id());
              return;
            }
            // Only this in-process fixture commit shares this transaction. Python DB writes need
            // their own fencing transaction.
            if(item.job.stage()==AnalysisStage.INTEGRATE) {
              Instant cutoff=service.jdbc.queryForObject("select analysis_cutoff_at from batch_jobs where job_id=?",Timestamp.class,item.job.id()).toInstant();
              var dates=service.jdbc.queryForList("select distinct b.business_date from analysis_receipts a join batch_jobs b on b.job_id=a.upload_id where a.job_id=? and b.business_date is not null order by b.business_date",java.sql.Date.class,item.job.id());
              for(var date:dates) {
                var fixed=new HashSet<>(service.jdbc.queryForList("select a.upload_id from analysis_receipts a join batch_jobs b on b.job_id=a.upload_id where a.job_id=? and b.business_date=?",Long.class,item.job.id(),date));
                integration.integrate(date.toLocalDate(),cutoff,fixed);
                service.jdbc.update("insert into analysis_selected_versions select ?,set_id,current_version_id,generation from report_sets where business_date=? and current_version_id is not null on conflict(job_id,set_id) do update set version_id=excluded.version_id,generation=excluded.generation",item.job.id(),date);
              }
            } else if(item.job.stage()==AnalysisStage.FREEZE_INPUT) {
              Instant cutoff=service.jdbc.queryForObject("select analysis_cutoff_at from batch_jobs where job_id=?",Timestamp.class,item.job.id()).toInstant();
              UUID run=runs.freeze(item.job.id(),cutoff);
              int count=service.jdbc.queryForObject("select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",Integer.class,run);
              if(count==0) {
                runs.complete(run);
                service.jdbc.update("update batch_jobs set status='COMPLETED',current_stage='COMPLETE',completion_reason='EMPTY_INPUT',row_count=0,suspicious_tx_count=0,alert_count=0,finished_at=?,execution_id=null where job_id=?",Timestamp.from(service.clock.instant()),item.job.id());
                return;
              }
            } else executor.commit(item.context, item.result);
            if(item.context.runId()==null) service.jdbc.update(
                "insert into analysis_stage_results(job_id,stage,execution_id,artifact,completed)"
                    + " values(?,?,?,?,true) on conflict(job_id,stage) do update set"
                    + " completed=true,execution_id=excluded.execution_id",
                item.job.id(),
                item.job.stage().name(),
                item.job.executionId(),
                item.result.artifact());
            if(item.context.runId()!=null)service.jdbc.update("insert into analysis_run_stage_results(run_id,stage,execution_id,artifact,completed) values(?,?,?,?,true) on conflict(run_id,stage) do update set completed=true,execution_id=excluded.execution_id",item.context.runId(),item.job.stage().name(),item.job.executionId(),item.result.artifact());
            boolean complete = item.job.stage() == AnalysisStage.ALERTS;
            if(complete && item.context.runId()!=null)runs.complete(item.context.runId());
            service.jdbc.update(
                "update batch_jobs set"
                    + " status=?,current_stage=?,stage_attempt_count=0,consecutive_failures=0,error_code=null,error_message=null,retry_at=null,execution_id=null,execution_owner=null,finished_at=?"
                    + " where job_id=?",
                complete ? "COMPLETED" : "QUEUED",
                item.job.stage().next().name(),
                complete ? Timestamp.from(service.clock.instant()) : null,
                item.job.id());
          });
      pending.remove(item.job.id());
    } catch (DataAccessException failure) {
      if (last == null || !last.terminal()) {
        addFailure(item, "DB_UNAVAILABLE", AnalysisFailure.Kind.CONNECTION);
        item.nextFlushAt = item.failures.getLast().retryAt();
      }
    } catch (AnalysisFailure failure) {
      addFailure(item, failure.code(), failure.kind());
    } catch (RuntimeException failure) {
      if("INPUT_REVISION_CHANGED".equals(failure.getMessage())) {
        service.tx.executeWithoutResult(status->{service.lock(item.job.id());if(service.owns(item.job))service.jdbc.update("update batch_jobs set status='QUEUED',current_stage='INTEGRATE',execution_id=null,execution_owner=null where job_id=?",item.job.id());});
        pending.remove(item.job.id());
      } else addFailure(item,"CUTOFF_SUPERSEDED".equals(failure.getMessage())?"CUTOFF_SUPERSEDED":"STAGE_EXECUTION_FAILED","CUTOFF_SUPERSEDED".equals(failure.getMessage())?AnalysisFailure.Kind.PERMANENT:AnalysisFailure.Kind.COMPUTATION);
    }
  }
}
