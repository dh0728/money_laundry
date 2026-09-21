package com.moneylaundry.api.analysis;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PythonAnalysisExecutor implements AnalysisStageExecutor {
  private final String python;
  private final String script;
  private final Duration timeout;
  private final JdbcTemplate jdbc;
  private final JdbcConnectionDetails database;
  private final String mode;
  private final String storage;
  private java.util.Map<String, String> remoteEnvironment = java.util.Map.of();

  @Autowired
  void configureRemote(
      @Value("${app.inference.url:}") String url,
      @Value("${app.inference.token:}") String token,
      @Value("${app.s3.bucket:}") String bucket,
      @Value("${app.s3.prefix:}") String prefix,
      @Value("${app.s3.region:ap-northeast-2}") String region) {
    remoteEnvironment =
        java.util.Map.of(
            "INFERENCE_API_URL",
            url,
            "INFERENCE_API_TOKEN",
            token,
            "S3_BUCKET",
            bucket,
            "S3_PREFIX",
            prefix,
            "AWS_REGION",
            region);
  }

  @Autowired
  public PythonAnalysisExecutor(
      @Value("${app.worker.python}") String python,
      @Value("${app.worker.script}") String script,
      @Value("${app.worker.timeout}") Duration timeout,
      JdbcTemplate jdbc,
      JdbcConnectionDetails database,
      @Value("${app.worker.mode:unconfigured}") String mode,
      @Value("${app.storage-dir}") String storage) {
    this.python = python;
    this.script = script;
    this.timeout = timeout;
    this.jdbc = jdbc;
    this.database = database;
    this.mode = mode;
    this.storage = storage;
  }

  public PythonAnalysisExecutor(String python, String script, Duration timeout) {
    this(python, script, timeout, null, null, "unconfigured", ".");
  }

  static String workerDatabaseUrl(String jdbcUrl) {
    if (!jdbcUrl.startsWith("jdbc:postgresql://"))
      throw new AnalysisFailure("WORKER_DB_CONFIGURATION", AnalysisFailure.Kind.PERMANENT);
    String[] parts = jdbcUrl.substring(5).split("\\?", 2);
    if (parts.length == 1) return parts[0];
    // JDBC-only logging option is not a libpq connection option. Preserve TLS options.
    String query =
        Arrays.stream(parts[1].split("&"))
            .filter(value -> !value.startsWith("loggerLevel="))
            .collect(Collectors.joining("&"));
    return parts[0] + (query.isEmpty() ? "" : "?" + query);
  }

  private String checkpoint(Context context) {
    if (jdbc == null || context.runId() == null || context.stage() != AnalysisStage.FEATURES)
      return null;
    var rows =
        jdbc.queryForList(
            """
        select s.artifact from analysis_run_stage_results s
        join analysis_runs r on r.run_id=s.run_id
        join batch_jobs b on b.job_id=r.job_id and b.current_run_id=r.run_id
        where b.job_id=? and b.status='RUNNING' and b.current_stage=?
          and b.execution_id=? and s.execution_id=? and s.run_id=?
          and s.stage=? and s.completed and r.status in ('READY','ACTIVE')
          and (select count(*) from analysis_model_tasks m where m.run_id=r.run_id
               and m.phase='PUBLISH' and m.status='READY' and m.input_artifact is not null)=2
        """,
            String.class,
            context.jobId(),
            context.stage().name(),
            context.executionId(),
            context.executionId(),
            context.runId(),
            context.stage().name());
    return rows.isEmpty() ? null : rows.getFirst();
  }

  @Override
  public void commit(Context context, Result result) {
    if (!result.artifact().equals(checkpoint(context)))
      throw new AnalysisFailure("WORKER_CHECKPOINT_MISSING", AnalysisFailure.Kind.PERMANENT);
  }

  @Override
  public Result prepare(Context context) {
    Process process = null;
    try {
      var command =
          new ArrayList<>(
              List.of(
                  python,
                  "-B",
                  script,
                  "--job-id",
                  Long.toString(context.jobId()),
                  "--stage",
                  context.stage().name(),
                  "--execution-id",
                  context.executionId().toString()));
      if (context.runId() != null) {
        command.add("--run-id");
        command.add(context.runId().toString());
      }
      var builder = new ProcessBuilder(command);
      builder.environment().put("WORKER_MODE", mode);
      builder.environment().putAll(remoteEnvironment);
      if (database != null) {
        builder.environment().put("WORKER_DB_URL", workerDatabaseUrl(database.getJdbcUrl()));
        builder.environment().put("WORKER_DB_USER", database.getUsername());
        builder.environment().put("WORKER_DB_PASSWORD", database.getPassword());
        builder
            .environment()
            .put(
                "WORKER_STORAGE_DIR",
                Path.of(storage).toAbsolutePath().resolve("worker").toString());
      }
      process =
          builder
              .redirectOutput(ProcessBuilder.Redirect.DISCARD)
              .redirectError(ProcessBuilder.Redirect.DISCARD)
              .start();
      if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS))
        throw new AnalysisFailure("WORKER_TIMEOUT", AnalysisFailure.Kind.COMPUTATION);
      String saved = checkpoint(context);
      if (saved != null) return new Result(saved);
      if (process.exitValue() == 76
          && context.stage() == AnalysisStage.INFERENCE
          && jdbc != null
          && context.runId() != null
          && jdbc.queryForObject(
              "select count(*)=2 and count(*) filter(where status in ('WAITING','RETRY_WAIT','ACTIVE'))>0 from analysis_model_tasks where run_id=?",
              Boolean.class,
              context.runId())) throw new AnalysisDeferred();
      if (process.exitValue() == 77)
        throw new AnalysisFailure("MODEL_TASK_FAILED", AnalysisFailure.Kind.PERMANENT);
      if (process.exitValue() == 80)
        throw new AnalysisFailure(
            "RESULT_COLLECTION_NOT_CONNECTED", AnalysisFailure.Kind.PERMANENT);
      if (process.exitValue() == 78)
        throw new AnalysisFailure("PIPELINE_NOT_CONFIGURED", AnalysisFailure.Kind.PERMANENT);
      if (process.exitValue() == 75)
        throw new AnalysisFailure("DB_UNAVAILABLE", AnalysisFailure.Kind.CONNECTION);
      if (process.exitValue() == 79)
        throw new AnalysisFailure("RUN_FENCED", AnalysisFailure.Kind.PERMANENT);
      if (process.exitValue() == 65)
        throw new AnalysisFailure("WORKER_INPUT_INVALID", AnalysisFailure.Kind.PERMANENT);
      if (process.exitValue() == 74)
        throw new AnalysisFailure("WORKER_STORAGE_UNAVAILABLE", AnalysisFailure.Kind.COMPUTATION);
      // Exit zero alone cannot advance a stage without a persisted checkpoint.
      throw new AnalysisFailure("WORKER_PROTOCOL_NOT_CONNECTED", AnalysisFailure.Kind.PERMANENT);
    } catch (IOException e) {
      throw new AnalysisFailure("WORKER_UNAVAILABLE", AnalysisFailure.Kind.PERMANENT);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new AnalysisFailure("WORKER_INTERRUPTED", AnalysisFailure.Kind.COMPUTATION);
    } finally {
      if (process != null && process.isAlive()) {
        var descendants = process.descendants().toList();
        descendants.forEach(ProcessHandle::destroyForcibly);
        process.destroyForcibly();
        boolean interrupted = Thread.interrupted();
        try {
          process.waitFor(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
          interrupted = true;
        } finally {
          if (interrupted) Thread.currentThread().interrupt();
        }
      }
    }
  }
}
