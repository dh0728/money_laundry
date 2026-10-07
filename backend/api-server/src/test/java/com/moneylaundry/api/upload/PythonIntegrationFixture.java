package com.moneylaundry.api.upload;

import com.moneylaundry.api.analysis.PythonAnalysisExecutor;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.jdbc.core.JdbcTemplate;

/** Runs the actual integration worker against the test database, without an analysis scheduler. */
final class PythonIntegrationFixture {
  private final JdbcTemplate jdbc;
  private final JdbcConnectionDetails database;
  private final String encryption, search;

  PythonIntegrationFixture(
      JdbcTemplate jdbc, JdbcConnectionDetails database, String encryption, String search) {
    this.jdbc = jdbc;
    this.database = database;
    this.encryption = encryption;
    this.search = search;
  }

  record Outcome(int transactions, int heldFiles, int dependentReports) {}

  Outcome integrate(LocalDate date, Instant cutoff, Set<Long> uploads) {
    UUID token = UUID.randomUUID();
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage,execution_id,execution_owner) values(date '2200-01-01'+nextval('core.work_id')::int,?,now(),.7,'RUNNING','INTEGRATE',?,?) returning job_id",
            Long.class,
            Timestamp.from(cutoff),
            token,
            token);
    try {
      for (long upload : uploads)
        jdbc.update("insert into analysis.receipts values(?,?)", job, upload);
      String script =
          """
          import os,sys,uuid,psycopg
          sys.path.insert(0,'worker')
          from private_data import PrivateDataProtector
          from report_integration import integrate_job, ReportRevisionChanged
          try:
            protector=PrivateDataProtector(os.environ['INGEST_ENCRYPTION_KEY'],os.environ['INGEST_SEARCH_KEY'],'test')
            with psycopg.connect(os.environ['WORKER_DATABASE_URL'],autocommit=True) as db:
              try:
                integrate_job(db,int(sys.argv[1]),uuid.UUID(sys.argv[2]),protector,'fx_rates_usd_v1')
              except ReportRevisionChanged:
                # Exercise the same deferred invocation after concurrent publication.
                integrate_job(db,int(sys.argv[1]),uuid.UUID(sys.argv[2]),protector,'fx_rates_usd_v1')
          except Exception as error:
            print(str(error))
            sys.exit(1)
          """;
      var builder =
          new ProcessBuilder(
              System.getenv("AML_TEST_PYTHON"), "-c", script, Long.toString(job), token.toString());
      var env = builder.environment();
      env.put(
          "WORKER_DATABASE_URL", PythonAnalysisExecutor.workerDatabaseUrl(database.getJdbcUrl()));
      env.put("PGUSER", database.getUsername());
      env.put("PGPASSWORD", database.getPassword());
      env.put("INGEST_ENCRYPTION_KEY", encryption);
      env.put("INGEST_SEARCH_KEY", search);
      builder.redirectErrorStream(true);
      var process = builder.start();
      if (!process.waitFor(60, TimeUnit.SECONDS)) {
        process.destroyForcibly();
        throw new IllegalStateException("INTEGRATION_TIMEOUT");
      }
      String result =
          new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
      if (process.exitValue() != 0) throw new IllegalStateException(result);
      return new Outcome(
          jdbc.queryForObject(
              "select count(*) from ledger.transactions where business_date=? and integration_status='ACTIVE'",
              Integer.class,
              date),
          jdbc.queryForObject(
              "select count(*) from ingest.report_versions v join ingest.report_sets s using(set_id) where s.business_date=? and v.stage_status='HELD'",
              Integer.class,
              date),
          jdbc.queryForObject(
              "select count(*) from private.bank_reports b join ingest.report_versions v using(version_id) join ingest.report_sets s using(set_id) where s.business_date=? and b.report_status='DEPENDENCY_HELD'",
              Integer.class,
              date));
    } catch (java.io.IOException error) {
      throw new IllegalStateException("WORKER_START_FAILED", error);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("WORKER_INTERRUPTED", error);
    } finally {
      jdbc.update("delete from analysis.stage_results where job_id=?", job);
      jdbc.update("delete from analysis.selected_versions where job_id=?", job);
      jdbc.update("delete from analysis.receipts where job_id=?", job);
      jdbc.update("delete from analysis.jobs where job_id=?", job);
    }
  }
}
