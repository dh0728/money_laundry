package com.moneylaundry.api.analysis;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PythonAnalysisExecutor implements AnalysisStageExecutor {
  private final String python;
  private final String script;
  private final Duration timeout;

  public PythonAnalysisExecutor(
      @Value("${app.worker.python}") String python,
      @Value("${app.worker.script}") String script,
      @Value("${app.worker.timeout}") Duration timeout) {
    this.python = python;
    this.script = script;
    this.timeout = timeout;
  }

  @Override
  public Result prepare(Context context) {
    Process process = null;
    try {
      process =
          new ProcessBuilder(
                  python,
                  "-B",
                  script,
                  "--job-id",
                  Long.toString(context.jobId()),
                  "--stage",
                  context.stage().name(),
                  "--execution-id",
                  context.executionId().toString())
              .redirectOutput(ProcessBuilder.Redirect.DISCARD)
              .redirectError(ProcessBuilder.Redirect.DISCARD)
              .start();
      if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS))
        throw new AnalysisFailure("WORKER_TIMEOUT", AnalysisFailure.Kind.COMPUTATION);
      if (process.exitValue() == 78)
        throw new AnalysisFailure("PIPELINE_NOT_CONFIGURED", AnalysisFailure.Kind.PERMANENT);
      // A process exit alone is not proof of persisted/fenced stage completion. Real pipeline
      // integration is a later task.
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
