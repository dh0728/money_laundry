package com.moneylaundry.api.upload;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PythonScoreWorker implements ScoreWorker {

  private final String pythonExe;
  private final String scriptPath;

  public PythonScoreWorker(
      @Value("${app.worker.python}") String pythonExe,
      @Value("${app.worker.script}") String scriptPath) {
    this.pythonExe = pythonExe;
    this.scriptPath = scriptPath;
  }

  @Override
  public void score(Path input, Path output) {
    ProcessBuilder builder =
        new ProcessBuilder(
            pythonExe, scriptPath, "--input", input.toString(), "--output", output.toString());
    builder.redirectErrorStream(true);
    try {
      Process process = builder.start();
      String log = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
      if (!process.waitFor(10, TimeUnit.MINUTES)) {
        process.destroyForcibly();
        throw new WorkerException("워커 시간 초과(10분)");
      }
      if (process.exitValue() != 0) {
        throw new WorkerException("워커 실패(종료 코드 " + process.exitValue() + "): " + log);
      }
    } catch (IOException e) {
      throw new WorkerException("워커 실행 불가: " + e.getMessage(), e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new WorkerException("워커 대기 중단", e);
    }
  }
}
