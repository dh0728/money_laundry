package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PythonAnalysisExecutorTests {
  @TempDir Path temp;

  @Test
  void worker_url_preserves_tls_and_removes_only_jdbc_logging() {
    assertThat(
            PythonAnalysisExecutor.workerDatabaseUrl(
                "jdbc:postgresql://localhost:5432/test?loggerLevel=OFF&sslmode=verify-full"))
        .isEqualTo("postgresql://localhost:5432/test?sslmode=verify-full");
    assertThat(
            PythonAnalysisExecutor.workerDatabaseUrl(
                "jdbc:postgresql://localhost:5432/test?loggerLevel=OFF"))
        .isEqualTo("postgresql://localhost:5432/test");
  }

  private AnalysisStageExecutor.Context context() {
    return new AnalysisStageExecutor.Context(
        1, AnalysisStage.FEATURES, UUID.randomUUID(), List.of(), Map.of());
  }

  @Test
  void external_inference_configuration_reaches_child_process() throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    Path script = temp.resolve("environment.py");
    Files.writeString(
        script,
        "import os,pathlib\n"
            + "assert os.environ['INFERENCE_API_URL']=='https://gpu.example:31575'\n"
            + "assert os.environ['INFERENCE_API_TOKEN']=='x'*32\n"
            + "assert os.environ['INFERENCE_CA_FILE']=='/app/certs/inference-ca.crt'\n"
            + "pathlib.Path(__file__).with_name('result.txt').write_text('configuration received')\n");
    var executor = new PythonAnalysisExecutor(python, script.toString(), Duration.ofSeconds(10));
    executor.configureRemote(
        "https://gpu.example:31575",
        "x".repeat(32),
        "/app/certs/inference-ca.crt",
        "test-bucket",
        "dev/test/",
        "ap-northeast-2");
    // This synthetic worker has no DB checkpoint; only validate the actual process boundary.
    assertThatThrownBy(() -> executor.prepare(context())).isInstanceOf(AnalysisFailure.class);
    assertThat(Files.readString(temp.resolve("result.txt"))).isEqualTo("configuration received");
  }

  @Test
  void unconnected_entry_reports_permanent_error() {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    var executor =
        new PythonAnalysisExecutor(python, "worker/analysis_entry.py", Duration.ofSeconds(10));
    assertThatThrownBy(() -> executor.prepare(context()))
        .isInstanceOfSatisfying(
            AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("PIPELINE_NOT_CONFIGURED"));
  }

  @Test
  @org.junit.jupiter.api.extension.ExtendWith(
      org.springframework.boot.test.system.OutputCaptureExtension.class)
  void unexpected_exit_logs_metadata_without_exposing_worker_output(
      org.springframework.boot.test.system.CapturedOutput output) throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    Path script = temp.resolve("killed.py");
    Files.writeString(
        script, "import sys\nprint('FAKE_PRIVATE_WORKER_OUTPUT',file=sys.stderr)\nsys.exit(137)\n");
    var executor = new PythonAnalysisExecutor(python, script.toString(), Duration.ofSeconds(10));
    assertThatThrownBy(() -> executor.prepare(context()))
        .isInstanceOfSatisfying(
            AnalysisFailure.class,
            e -> assertThat(e.code()).isEqualTo("WORKER_PROTOCOL_NOT_CONNECTED"));
    assertThat(output.getAll()).contains("jobId=1", "stage=FEATURES", "exitCode=137", "elapsedMs=");
    assertThat(output.getAll()).doesNotContain("FAKE_PRIVATE_WORKER_OUTPUT");
  }

  @Test
  void timeout_terminates_process_without_exposing_worker_output() throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    Path script = temp.resolve("slow.py"), pid = temp.resolve("pid.txt");
    Files.writeString(
        script,
        "import os,time,pathlib\npathlib.Path(__file__).with_name('pid.txt').write_text(str(os.getpid()))\nprint('FAKE_PRIVATE_WORKER_OUTPUT',flush=True)\ntime.sleep(60)\n");
    var executor = new PythonAnalysisExecutor(python, script.toString(), Duration.ofSeconds(1));
    assertThatThrownBy(() -> executor.prepare(context()))
        .isInstanceOfSatisfying(
            AnalysisFailure.class,
            e -> {
              assertThat(e.code()).isEqualTo("WORKER_TIMEOUT");
              assertThat(e.getMessage().contains("FAKE_PRIVATE")).isFalse();
            });
    long process = Long.parseLong(Files.readString(pid));
    assertThat(ProcessHandle.of(process).map(ProcessHandle::isAlive).orElse(false)).isFalse();
  }
}
