package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PythonAnalysisExecutorTests {
  @TempDir Path temp;

  private AnalysisStageExecutor.Context context() {
    return new AnalysisStageExecutor.Context(
        1, AnalysisStage.FEATURES, UUID.randomUUID(), List.of(), Map.of());
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
