package com.moneylaundry.api.review;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.storage.DemoObjectKey;
import com.moneylaundry.api.storage.UploadStore;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

@Service
public class DemoResetService {
  // Explicit allowlist: no CASCADE, no identity restart, no user/configuration tables.
  static final String TABLES =
      String.join(
          ",",
          "analysis.alert_plans",
          "analysis.alert_fact_checks",
          "review.alert_proposal_cases",
          "review.alert_change_proposals",
          "review.alert_lineage",
          "review.event_recipients",
          "review.episode_members",
          "review.episode_alerts",
          "review.alert_members",
          "review.alert_groups",
          "review.notification_reads",
          "review.requests",
          "review.events",
          "review.episodes",
          "analysis.alert_origins",
          "review.alert_transactions",
          "review.alert_coverage_checks",
          "review.alert_versions",
          "review.alerts",
          "analysis.source_manifest",
          "analysis.input_scores",
          "analysis.input_coverage",
          "analysis.input_reports",
          "analysis.target_ownership",
          "analysis.current_scores",
          "analysis.scores",
          "analysis.features",
          "analysis.input_transactions",
          "analysis.cancel_outbox",
          "analysis.model_tasks",
          "analysis.model_requests",
          "analysis.stage_results",
          "analysis.run_replacements",
          "analysis.runs",
          "analysis.receipts",
          "analysis.selected_versions",
          "analysis.failures",
          "analysis.jobs",
          "evaluation.transaction_labels",
          "ledger.transaction_reports",
          "ledger.transactions",
          "evaluation.report_labels",
          "private.bank_reports",
          "ingest.integration_attempt_versions",
          "ingest.integration_attempts",
          "ingest.correction_errors",
          "ingest.correction_uploads",
          "ingest.correction_requests",
          "ingest.report_versions",
          "ingest.report_sets",
          "ingest.reporting_scope_banks",
          "ingest.reporting_scopes",
          "private.account_identities",
          "core.accounts",
          "private.owner_identities",
          "core.owners",
          "ingest.uploads");
  static final String DASHBOARD_TABLES =
      "ops.dashboard_dirty,ops.dashboard_model_counts,ops.dashboard_case_items,ops.dashboard_case_counts,ops.dashboard_report_counts,ops.dashboard_delivery_days";
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final UploadStore store;
  private final ObjectMapper json = new ObjectMapper();

  public DemoResetService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, UploadStore store) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.store = store;
  }

  private void admin(long actor) {
    time.demoOnly();
    if (!Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from core.users where user_id=? and role='ADMIN')",
            Boolean.class,
            actor))) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "관리자 전용 기능입니다.");
  }

  private Map<String, Long> counts() {
    var counts = new LinkedHashMap<String, Long>();
    for (String table : TABLES.split(","))
      counts.put(table, jdbc.queryForObject("select count(*) from " + table, Long.class));
    return counts;
  }

  private String fingerprint(Map<String, Long> counts) {
    try {
      String value =
          json.writeValueAsString(counts)
              + ":"
              + time.view().get("revision")
              + ":"
              + jdbc.queryForObject(
                  "select coalesce(max(job_id),0) from ops.work_items", Long.class);
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  public Map<String, Object> preview(long actor) {
    admin(actor);
    var counts = counts();
    return Map.of("counts", counts, "snapshot", fingerprint(counts), "clock", time.view());
  }

  public record ResetInput(UUID requestId, String snapshot, String confirmation) {}

  public Map<String, Object> reset(long actor, ResetInput input) {
    admin(actor);
    if (input == null
        || input.requestId() == null
        || input.snapshot() == null
        || !"시연 데이터 초기화".equals(input.confirmation()))
      throw new ApiException(
          HttpStatus.BAD_REQUEST, "RESET_CONFIRMATION_REQUIRED", "삭제 확인이 필요합니다.");
    try {
      tx.executeWithoutResult(
          s -> {
            jdbc.execute("set local lock_timeout='2s'");
            jdbc.queryForList("select pg_advisory_xact_lock(17002001)");
            jdbc.execute(
                "lock table "
                    + TABLES
                    + ","
                    + DASHBOARD_TABLES
                    + ",ops.business_clock in access exclusive mode nowait");
            var previous =
                jdbc.queryForList(
                    "select actor_id from ops.resets where reset_id=?", input.requestId());
            if (!previous.isEmpty()) {
              if (((Number) previous.getFirst().get("actor_id")).longValue() != actor)
                throw conflict("RESET_REQUEST_CONFLICT", "다른 초기화 요청입니다.");
              return; // Lost response: reuse receipt, never clear newly received data.
            }
            if (Boolean.TRUE.equals(
                jdbc.queryForObject(
                    "select exists(select 1 from ops.resets where status<>'COMPLETED')",
                    Boolean.class)))
              throw conflict("RESET_CLEANUP_PENDING", "이전 초기화의 파일 정리를 먼저 완료하세요.");
            var counts = counts();
            if (!fingerprint(counts).equals(input.snapshot()))
              throw conflict("RESET_PREVIEW_STALE", "데이터가 변경됐습니다. 삭제 대상을 다시 확인하세요.");
            if (Boolean.TRUE.equals(
                jdbc.queryForObject(
                    """
            select exists(select 1 from ops.work_items
             where status in ('RUNNING','QUEUED','SCHEDULED','RETRY_WAIT','RECEIVED'))
             or exists(select 1 from analysis.model_tasks where status in ('ACTIVE','WAITING','RETRY_WAIT'))
             or exists(select 1 from analysis.model_requests m
               where m.status in ('REGISTERED','PUBLISHED') and not exists(
                 select 1 from analysis.model_tasks t where t.request_id=m.request_id
                   and t.execution_round=m.execution_round and t.status='SUCCEEDED'))
            """,
                    Boolean.class)))
              throw conflict("RESET_BUSY", "실행·대기 중인 작업 또는 종료가 확인되지 않은 추론 요청이 있습니다.");
            if (Boolean.TRUE.equals(
                jdbc.queryForObject(
                    "select exists(select 1 from ingest.uploads where url_expires_at>now())",
                    Boolean.class)))
              throw conflict("RESET_UPLOAD_URL_ACTIVE", "발급된 업로드 URL 만료 후 초기화하세요.");
            String scope = store.resetScope();
            var objects = new LinkedHashMap<String, Boolean>();
            jdbc.queryForList(
                    "select s3_key from ingest.uploads where s3_key is not null", String.class)
                .forEach(key -> objects.put(key, false));
            for (var row :
                jdbc.queryForList(
                    """
            select distinct r.job_id,m.model_kind,m.request_id from analysis.model_requests m
             join analysis.runs r using(run_id)
            """)) {
              String base =
                  row.get("job_id")
                      + "/"
                      + row.get("model_kind")
                      + "/"
                      + row.get("request_id")
                      + "/";
              objects.put("requests/" + base, true);
              objects.put("results/" + base, true);
            }
            // A historical destination must not silently be replaced by current configuration.
            for (String publication :
                jdbc.queryForList(
                    "select (binding->'publication')::text from analysis.model_tasks where binding ? 'publication'",
                    String.class)) {
              var binding = json.readTree(publication);
              String bound =
                  "s3:" + binding.get("bucket").asString() + "/" + binding.get("prefix").asString();
              if (!scope.equals(bound))
                throw conflict("RESET_STORAGE_CHANGED", "이전 추론 저장소 설정을 확인하세요.");
            }
            objects.forEach(DemoObjectKey::check);
            jdbc.update(
                "insert into ops.resets(reset_id,actor_id,status,storage_scope,deleted_counts) values(?,?,'FILES_PENDING',?,?::jsonb)",
                input.requestId(),
                actor,
                scope,
                json.writeValueAsString(counts));
            objects.forEach(
                (key, prefix) ->
                    jdbc.update(
                        "insert into ops.reset_files(reset_id,object_key,is_prefix) values(?,?,?)",
                        input.requestId(),
                        key,
                        prefix));
            jdbc.execute(
                "truncate table "
                    + TABLES
                    + ","
                    + DASHBOARD_TABLES
                    + " continue identity restrict");
            // The source and read models are both empty. Remove truncate invalidations atomically.
            jdbc.update("delete from ops.dashboard_dirty");
            jdbc.update(
                "update ops.business_clock set business_at=null,revision=revision+1,updated_at=now() where id");
            if (objects.isEmpty())
              jdbc.update(
                  "update ops.resets set status='COMPLETED',completed_at=now() where reset_id=?",
                  input.requestId());
          });
    } catch (DataAccessException e) {
      Throwable cause = e;
      while (cause != null) {
        if (cause instanceof java.sql.SQLException sql && "55P03".equals(sql.getSQLState()))
          throw conflict("RESET_BUSY", "다른 작업이 데이터를 사용 중입니다. 완료 후 다시 시도하세요.");
        cause = cause.getCause();
      }
      throw e;
    }
    return status(actor, input.requestId());
  }

  public Map<String, Object> latest(long actor) {
    admin(actor);
    var ids =
        jdbc.queryForList(
            "select reset_id from ops.resets order by created_at desc limit 1", UUID.class);
    return ids.isEmpty() ? Map.of("status", "NONE") : status(actor, ids.getFirst());
  }

  public Map<String, Object> status(long actor, UUID id) {
    admin(actor);
    var rows =
        jdbc.queryForList(
            "select status,created_at,completed_at from ops.resets where reset_id=?", id);
    if (rows.isEmpty()) throw ApiException.notFound("초기화 요청 없음");
    var result = new LinkedHashMap<String, Object>();
    result.put("resetId", id);
    result.put("status", rows.getFirst().get("status"));
    result.put("databaseReset", true);
    result.put(
        "totalTargets",
        jdbc.queryForObject(
            "select count(*) from ops.reset_files where reset_id=?", Long.class, id));
    result.put(
        "remainingTargets",
        jdbc.queryForObject(
            "select count(*) from ops.reset_files where reset_id=? and not done", Long.class, id));
    return result;
  }

  public Map<String, Object> cleanup(long actor, UUID id) {
    admin(actor);
    // One small, idempotent cleanup step; a failure retains durable remaining targets.
    tx.executeWithoutResult(
        s -> {
          var rows =
              jdbc.queryForList(
                  "select status,storage_scope from ops.resets where reset_id=? for update skip locked",
                  id);
          if (rows.isEmpty()) return;
          var reset = rows.getFirst();
          if ("COMPLETED".equals(reset.get("status"))) return;
          try {
            if (!store.resetScope().equals(reset.get("storage_scope")))
              throw new IllegalStateException("Changed storage");
            var files =
                jdbc.queryForList(
                    "select object_key,is_prefix from ops.reset_files where reset_id=? and not done order by object_key limit 1",
                    id);
            if (!files.isEmpty()) {
              var file = files.getFirst();
              if (store.removeDemoFiles(
                  (String) file.get("object_key"), (Boolean) file.get("is_prefix")))
                jdbc.update(
                    "update ops.reset_files set done=true where reset_id=? and object_key=?",
                    id,
                    file.get("object_key"));
            }
            boolean pending =
                Boolean.TRUE.equals(
                    jdbc.queryForObject(
                        "select exists(select 1 from ops.reset_files where reset_id=? and not done)",
                        Boolean.class,
                        id));
            jdbc.update(
                "update ops.resets set status=?,completed_at=case when ? then null else now() end where reset_id=?",
                pending ? "FILES_PENDING" : "COMPLETED",
                pending,
                id);
          } catch (RuntimeException e) {
            jdbc.update("update ops.resets set status='FILES_FAILED' where reset_id=?", id);
          }
        });
    return status(actor, id);
  }

  private static ApiException conflict(String code, String message) {
    return new ApiException(HttpStatus.CONFLICT, code, message);
  }
}
