package com.moneylaundry.api.analysis;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.jdbc.core.JdbcTemplate;

final class AnalysisWorkerTestDatabase {
  static PythonAnalysisExecutor configure(PythonAnalysisExecutor executor, JdbcTemplate jdbc) {
    try {
      jdbc.execute(
          "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='aml_analysis_test') THEN CREATE ROLE aml_analysis_test LOGIN PASSWORD 'fixture-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF; END $$");
      jdbc.execute(
          Files.readString(Path.of("worker/analysis_permissions.sql"))
              .replace(":\"worker_role\"", "aml_analysis_test"));
      executor.configureDatabase("aml_analysis_test", "fixture-only");
      return executor;
    } catch (java.io.IOException error) {
      throw new java.io.UncheckedIOException(error);
    }
  }
}
