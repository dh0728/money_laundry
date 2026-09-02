package com.moneylaundry.api.upload;

import java.io.IOException;
import java.nio.file.Files;
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
    Path log = null;
    try {
      // 출력을 파일로 빼서, 워커가 멈춰도 아래 waitFor 타임아웃이 항상 동작하게 한다
      log = Files.createTempFile("worker-", ".log");
      ProcessBuilder builder =
          new ProcessBuilder(
              pythonExe, scriptPath, "--input", input.toString(), "--output", output.toString());
      builder.redirectErrorStream(true);
      builder.redirectOutput(log.toFile());
      Process process = builder.start();
      if (!process.waitFor(10, TimeUnit.MINUTES)) {
        process.destroyForcibly();
        throw new WorkerException("워커 시간 초과(10분)");
      }
      if (process.exitValue() != 0) {
        throw new WorkerException(
            "워커 실패(종료 코드 " + process.exitValue() + "): " + Files.readString(log));
      }
    } catch (IOException e) {
      throw new WorkerException("워커 실행 불가: " + e.getMessage(), e);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new WorkerException("워커 대기 중단", e);
    } finally {
      if (log != null) {
        try {
          Files.deleteIfExists(log);
        } catch (IOException ignored) {
          // 임시 로그 삭제 실패는 무시
        }
      }
    }
  }
}
