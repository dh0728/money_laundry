package com.moneylaundry.api.ingest;

import com.moneylaundry.api.analysis.PythonAnalysisExecutor;
import com.moneylaundry.api.storage.UploadStore;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** Spring owns receipt/dispatch; Python owns validation and private report publication. */
@Service
public class LedgerLoader {
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LedgerLoader.class);
  private final JdbcTemplate jdbc;
  private final UploadStore store;
  private final JdbcConnectionDetails database;
  private final String python, script;
  private final Duration timeout;
  private final Map<String, String> environment;
  private final UUID owner = UUID.randomUUID();

  public LedgerLoader(
      JdbcTemplate jdbc,
      UploadStore store,
      JdbcConnectionDetails database,
      @Value("${app.worker.python}") String python,
      @Value("${app.worker.script}") String script,
      @Value("${app.worker.timeout}") Duration timeout,
      @Value("${app.ingest.encryption-key:}") String encryption,
      @Value("${app.ingest.search-key:}") String search,
      @Value("${app.ingest.key-version:}") String version,
      @Value("${app.zone}") String zone) {
    this.jdbc = jdbc;
    this.store = store;
    this.database = database;
    this.python = python;
    this.script = Path.of(script).resolveSibling("ingest_entry.py").toString();
    this.timeout = timeout;
    this.environment =
        Map.of(
            "INGEST_ENCRYPTION_KEY",
            encryption,
            "INGEST_SEARCH_KEY",
            search,
            "INGEST_KEY_VERSION",
            version,
            "INGEST_ZONE",
            zone);
  }

  @Async
  public void load(long id) {
    UUID token = UUID.randomUUID();
    if (jdbc.update(
            "update ingest.uploads set status='RUNNING',started_at=now(),attempt_count=attempt_count+1,execution_id=?,execution_owner=? where upload_id=? and status='RECEIVED'",
            token,
            owner,
            id)
        != 1) return;
    Process process = null;
    try {
      String key =
          jdbc.queryForObject(
              "select s3_key from ingest.uploads where upload_id=?", String.class, id);
      var builder =
          new ProcessBuilder(
              python,
              "-B",
              script,
              "--upload-id",
              Long.toString(id),
              "--execution-id",
              token.toString());
      builder.environment().putAll(environment);
      builder
          .environment()
          .put("WORKER_DB_URL", PythonAnalysisExecutor.workerDatabaseUrl(database.getJdbcUrl()));
      builder.environment().put("WORKER_DB_USER", database.getUsername());
      builder.environment().put("WORKER_DB_PASSWORD", database.getPassword());
      builder.redirectOutput(ProcessBuilder.Redirect.DISCARD);
      builder.redirectError(ProcessBuilder.Redirect.DISCARD);
      process = builder.start();
      Process running = process;
      var writeFailure = new AtomicReference<Exception>();
      try (InputStream source = store.open(key)) {
        Thread writer =
            Thread.ofVirtual()
                .start(
                    () -> {
                      try (var input = running.getOutputStream()) {
                        source.transferTo(input);
                      } catch (Exception e) {
                        writeFailure.set(e);
                        running.destroyForcibly();
                      }
                    });
        if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
          process.destroyForcibly();
          throw new IllegalStateException("INGEST_TIMEOUT");
        }
        writer.join(Duration.ofSeconds(5));
        if (writer.isAlive() || writeFailure.get() != null || process.exitValue() != 0)
          throw new IllegalStateException("INGEST_WORKER_FAILED");
      }
      if (!Boolean.TRUE.equals(
          jdbc.queryForObject(
              "select status in ('COMPLETED','VALIDATION_FAILED') and execution_id is null from ingest.uploads where upload_id=?",
              Boolean.class,
              id))) throw new IllegalStateException("INGEST_CHECKPOINT_MISSING");
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      log.error(
          "Report load failed uploadId={} exceptionType={}", id, e.getClass().getSimpleName());
      jdbc.update(
          "update ingest.uploads set status='FAILED',error_code='LOAD_FAILED',error_message='보고 저장 실패. 관리자 확인이 필요합니다.',finished_at=now(),execution_id=null,execution_owner=null where upload_id=? and execution_id=?",
          id,
          token);
    } finally {
      if (process != null && process.isAlive()) process.destroyForcibly();
    }
  }
}
