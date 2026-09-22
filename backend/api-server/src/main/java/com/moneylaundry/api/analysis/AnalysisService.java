package com.moneylaundry.api.analysis;

import com.moneylaundry.api.ApiException;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AnalysisService {
  public static final long RECEIPT_LOCK = 17002001L;

  public record Job(
      long id,
      String status,
      AnalysisStage stage,
      int attempts,
      int stageAttempts,
      int failures,
      String error,
      Instant retryAt,
      UUID executionId,
      UUID owner) {}

  final JdbcTemplate jdbc;
  final TransactionTemplate tx;
  final Clock clock;
  final ZoneId zone;
  private final double threshold;
  private final LocalTime cutoff;

  public AnalysisService(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      Clock clock,
      @Value("${app.zone}") String zone,
      @Value("${app.suspicious-tx.threshold}") double threshold,
      @Value("${app.ingest.cutoff}") LocalTime cutoff) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.clock = clock;
    this.zone = ZoneId.of(zone);
    this.threshold = threshold;
    this.cutoff = cutoff;
    if (!Double.isFinite(threshold) || threshold <= 0 || threshold > 1)
      throw new IllegalArgumentException("분석 임계값은 0 초과 1 이하");
  }

  public String cron() {
    return "0 " + cutoff.getMinute() + " " + cutoff.getHour() + " * * *";
  }

  public static Object jsonValue(Object value) {
    return value instanceof Timestamp t
        ? t.toInstant()
        : value instanceof java.sql.Date d ? d.toLocalDate() : value;
  }

  public long registerNow() {
    return register(null);
  }

  public long registerScheduled() {
    return register(LocalDate.now(clock.withZone(zone)));
  }

  private long register(LocalDate scheduledDay) {
    return register(scheduledDay, null);
  }

  public long registerDemo(LocalDate businessDay) {
    if (businessDay == null || !businessDay.isBefore(LocalDate.now(clock.withZone(zone))))
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DEMO_DATE", "과거 거래 기준일을 선택하세요.");
    return register(null, businessDay);
  }

  private long register(LocalDate scheduledDay, LocalDate demoBusinessDay) {
    return tx.execute(
        status -> {
          receiptLock();
          Instant cutoff =
              scheduledDay == null
                  ? clock.instant()
                  : scheduledDay.atTime(this.cutoff).atZone(zone).toInstant();
          LocalDate day =
              demoBusinessDay == null
                  ? cutoff.atZone(zone).toLocalDate()
                  : demoBusinessDay.plusDays(1);
          if (demoBusinessDay != null) {
            if (jdbc.queryForObject(
                    "select count(*) from batch_jobs where job_type='ANALYSIS' and status<>'COMPLETED'",
                    Integer.class)
                > 0)
              throw new ApiException(
                  HttpStatus.CONFLICT, "DEMO_PREVIOUS_JOB_PENDING", "이전 분석을 완료하거나 실패 작업을 재개하세요.");
            if (jdbc.queryForObject(
                    "select count(*) from batch_jobs where job_type='ANALYSIS' and analysis_date>?",
                    Integer.class,
                    day)
                > 0)
              throw new ApiException(
                  HttpStatus.CONFLICT, "DEMO_DATE_OUT_OF_ORDER", "이미 처리한 날짜보다 이전으로 돌아갈 수 없습니다.");
            if (jdbc.queryForObject(
                    "select count(*) from batch_jobs where job_type='INGEST' and received_at is not null and (business_date>? or business_date is null)",
                    Integer.class,
                    demoBusinessDay)
                > 0)
              throw new ApiException(
                  HttpStatus.CONFLICT,
                  "DEMO_FUTURE_INPUT",
                  "선택한 날짜보다 뒤의 수신 자료가 있습니다. 날짜순 시연 DB를 사용하세요.");
            if (jdbc.queryForObject(
                    "select count(*) from batch_jobs where job_type='INGEST' and business_date=? and received_at<=?",
                    Integer.class,
                    demoBusinessDay,
                    Timestamp.from(cutoff))
                == 0)
              throw new ApiException(
                  HttpStatus.CONFLICT, "DEMO_INPUT_REQUIRED", "선택한 날짜의 파일을 먼저 전송하세요.");
          }
          var existing =
              jdbc.queryForList(
                  "select status from batch_jobs where job_type='ANALYSIS' and analysis_date=?",
                  String.class,
                  day);
          if (!existing.isEmpty())
            throw conflict(
                existing.getFirst().equals("COMPLETED")
                    ? "JOB_ALREADY_COMPLETED"
                    : existing.getFirst().equals("FAILED")
                        ? "JOB_REQUIRES_RESUME"
                        : "JOB_ALREADY_RUNNING");
          long id =
              jdbc.queryForObject(
                  """
          insert into batch_jobs(job_type,status,analysis_date,analysis_cutoff_at,current_stage,threshold_value)
          values ('ANALYSIS','QUEUED',?,?,'WAIT_INGEST',?) returning job_id
          """,
                  Long.class,
                  day,
                  Timestamp.from(cutoff),
                  threshold);
          jdbc.update(
              """
          insert into analysis_uploads(job_id,upload_id)
          select ?,b.job_id from batch_jobs b where b.job_type='INGEST' and b.received_at<=?
          and not exists(select 1 from analysis_uploads a where a.upload_id=b.job_id)
          """,
              id,
              Timestamp.from(cutoff));
          jdbc.update(
              "insert into analysis_receipts select ?,job_id from batch_jobs where job_type='INGEST' and received_at<=?",
              id,
              Timestamp.from(cutoff));
          return id;
        });
  }

  public void receiptLock() {
    jdbc.query("select pg_advisory_xact_lock(?)", ps -> ps.setLong(1, RECEIPT_LOCK), rs -> {});
  }

  public Job job(long id) {
    var rows =
        jdbc.query(
            "select * from batch_jobs where job_id=? and job_type='ANALYSIS'",
            (rs, n) ->
                new Job(
                    rs.getLong("job_id"),
                    rs.getString("status"),
                    AnalysisStage.valueOf(rs.getString("current_stage")),
                    rs.getInt("attempt_count"),
                    rs.getInt("stage_attempt_count"),
                    rs.getInt("consecutive_failures"),
                    rs.getString("error_code"),
                    rs.getTimestamp("retry_at") == null
                        ? null
                        : rs.getTimestamp("retry_at").toInstant(),
                    rs.getObject("execution_id", UUID.class),
                    rs.getObject("execution_owner", UUID.class)),
            id);
    if (rows.isEmpty()) throw ApiException.notFound("분석 작업 없음");
    return rows.getFirst();
  }

  public void resume(long id) {
    tx.executeWithoutResult(
        status -> {
          lock(id);
          Job job = job(id);
          if (!job.status().equals("FAILED"))
            throw conflict(
                job.status().equals("COMPLETED") ? "JOB_ALREADY_COMPLETED" : "INVALID_TRANSITION");
          if ("RUN_CANCELLED".equals(job.error())) {
            jdbc.update(
                "update analysis_cancel_outbox o set attempts=0,retry_at=null,error_code=null from analysis_model_requests m join analysis_runs r using(run_id) where o.request_id=m.request_id and o.execution_round=m.execution_round and r.job_id=? and o.acknowledged_at is null",
                id);
            return;
          }
          jdbc.update(
              """
              update analysis_model_tasks set status='READY',consecutive_failures=0,error_code=null,
                action_required=false,retry_at=null,updated_at=now()
              where run_id=(select current_run_id from batch_jobs where job_id=?)
                and phase in ('PUBLISH','COLLECT') and status='FAILED'
              """,
              id);
          jdbc.update(
              "update batch_jobs set status='QUEUED',consecutive_failures=0,error_code=null,error_message=null,retry_at=null,execution_id=null,execution_owner=null,finished_at=null where job_id=?",
              id);
        });
  }

  void lock(long id) {
    AnalysisRunService.integrationLock(jdbc);
    if (jdbc.queryForList("select job_id from batch_jobs where job_id=? for update", Long.class, id)
        .isEmpty()) throw ApiException.notFound("작업 없음");
  }

  boolean owns(Job expected) {
    Job actual = job(expected.id());
    return actual.status().equals("RUNNING")
        && Objects.equals(expected.executionId(), actual.executionId())
        && !Boolean.TRUE.equals(
            jdbc.queryForObject(
                "select exists(select 1 from analysis_runs r join batch_jobs b on b.current_run_id=r.run_id where b.job_id=? and r.status in ('CANCEL_REQUESTED','CANCELLED'))",
                Boolean.class,
                expected.id()));
  }

  public Map<String, Object> detail(long id) {
    var rows = jdbc.queryForList("select * from batch_jobs where job_id=?", id);
    if (rows.isEmpty()) throw ApiException.notFound("작업 없음");
    Map<String, Object> result = view(rows.getFirst());
    result.put(
        "uploads",
        jdbc.queryForList(
            "select a.upload_id as \"uploadId\",a.excluded,b.status,b.file_name as \"fileName\" from analysis_uploads a join batch_jobs b on b.job_id=a.upload_id where a.job_id=? order by a.upload_id",
            id));
    result.put(
        "failures",
        jdbc.queryForList(
            "select stage,error_code as \"errorCode\",failed_at as \"failedAt\",consecutive_count as \"consecutiveCount\",retry_at as \"retryAt\",action_required as \"actionRequired\" from analysis_failures where job_id=? order by failed_at,failure_id",
            id));
    result.put(
        "models",
        jdbc.queryForList(
            """
        select m.model_kind as "modelKind",m.phase,m.status,m.request_id as "requestId",
          m.execution_round as "executionRound",m.remote_snapshot->>'status' as "remoteStatus",
          m.remote_revision as "remoteRevision",m.error_code as "errorCode",
          m.action_required as "actionRequired",m.retry_at as "retryAt",m.next_poll_at as "nextPollAt",
          m.remote_deadline_at as "remoteDeadlineAt",m.binding->>'model_version' as "modelVersion",
          m.binding->>'feature_version' as "featureVersion"
        from analysis_model_tasks m join batch_jobs b on b.current_run_id=m.run_id
        where b.job_id=? order by m.model_kind
        """,
            id));
    for (String key : List.of("uploads", "failures", "models"))
      for (Object row : (List<?>) result.get(key))
        ((Map<String, Object>) row).replaceAll((name, value) -> jsonValue(value));
    result.put(
        "cancellations",
        jdbc.queryForList(
            "select o.cancel_id as \"cancelId\",o.attempts,o.error_code as \"errorCode\",o.acknowledged_at as \"acknowledgedAt\",(o.attempts>=3 and o.acknowledged_at is null) as \"actionRequired\" from analysis_cancel_outbox o join analysis_model_requests m using(request_id,execution_round) join analysis_runs r using(run_id) where r.job_id=?",
            id));
    return result;
  }

  public Map<String, Object> list(
      int page, int size, String type, String status, Instant from, Instant to) {
    validatePage(page, size);
    if (type != null && !List.of("ANALYSIS", "INGEST").contains(type)) throw invalid();
    if (status != null) {
      try {
        com.moneylaundry.api.batchjob.JobStatus.valueOf(status);
      } catch (IllegalArgumentException e) {
        throw invalid();
      }
    }
    StringBuilder where = new StringBuilder(" where 1=1");
    List<Object> args = new ArrayList<>();
    if (type != null) {
      where.append(" and job_type=?");
      args.add(type);
    }
    if (status != null) {
      where.append(" and status=?");
      args.add(status);
    }
    if (from != null) {
      where.append(" and started_at>=?");
      args.add(Timestamp.from(from));
    }
    if (to != null) {
      where.append(" and started_at<=?");
      args.add(Timestamp.from(to));
    }
    long count =
        jdbc.queryForObject("select count(*) from batch_jobs" + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var rows =
        jdbc.queryForList(
            "select * from batch_jobs" + where + " order by job_id desc limit ? offset ?",
            args.toArray());
    return page(rows.stream().map(this::view).toList(), page, size, count);
  }

  private Map<String, Object> view(Map<String, Object> row) {
    Map<String, Object> result = new LinkedHashMap<>();
    String[][] names = {
      {"job_id", "jobId"},
      {"current_run_id", "runId"},
      {"job_type", "type"},
      {"status", "status"},
      {"analysis_date", "analysisDate"},
      {"bank_id", "bankId"},
      {"current_stage", "currentStage"},
      {"attempt_count", "attemptCount"},
      {"stage_attempt_count", "stageAttemptCount"},
      {"consecutive_failures", "consecutiveFailures"},
      {"retry_at", "retryAt"},
      {"error_code", "errorCode"},
      {"error_message", "errorMessage"},
      {"started_at", "startedAt"},
      {"finished_at", "finishedAt"},
      {"row_count", "rowCount"},
      {"completion_reason", "completionReason"},
      {"analysis_cutoff_at", "cutoffAt"},
      {"model_version_binary", "modelVersionBinary"},
      {"model_version_type", "modelVersionType"},
      {"feature_version_binary", "featureVersionBinary"},
      {"feature_version_type", "featureVersionType"},
      {"threshold_value", "thresholdValue"}
    };
    for (var pair : names) result.put(pair[1], jsonValue(row.get(pair[0])));
    result.put("actionRequired", "FAILED".equals(row.get("status")));
    Map<String, Object> counters = new LinkedHashMap<>();
    counters.put(
        "suspiciousTxCount",
        "COMPLETED".equals(row.get("status")) ? row.get("suspicious_tx_count") : 0);
    counters.put("alertCount", "COMPLETED".equals(row.get("status")) ? row.get("alert_count") : 0);
    counters.put("missingCount", row.get("missing_count"));
    counters.put("duplicateCount", row.get("duplicate_count"));
    result.put("counters", counters);
    return result;
  }

  public static Map<String, Object> page(List<?> content, int page, int size, long count) {
    return Map.of(
        "content",
        content,
        "page",
        page,
        "size",
        size,
        "totalElements",
        count,
        "totalPages",
        (count + size - 1) / size);
  }

  public static void validatePage(int page, int size) {
    if (page < 0 || size < 1 || size > 200) throw invalid();
  }

  public static ApiException invalid() {
    return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "요청 필터와 형식을 확인하세요.");
  }

  private static ApiException conflict(String code) {
    return new ApiException(HttpStatus.CONFLICT, code, "해당 날짜 작업의 상태를 확인하세요. 실패 작업은 명시적으로 재개하세요.");
  }
}
