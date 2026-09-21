package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.ingest.TransactionIntegrationService;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class WorkerPipelineTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired JdbcConnectionDetails database;
  @Autowired AnalysisService service;
  @Autowired AnalysisRunService runs;
  @Autowired TransactionIntegrationService integration;
  @MockitoBean AnalysisScheduler scheduler;
  @TempDir Path storage;
  long job;
  UUID run;

  PythonAnalysisExecutor executor(String script) {
    return new PythonAnalysisExecutor(
        System.getenv("AML_TEST_PYTHON"),
        script,
        Duration.ofSeconds(20),
        jdbc,
        database,
        "demo",
        storage.toString());
  }

  @BeforeEach
  void setup() {
    Assumptions.assumeTrue(System.getenv("AML_TEST_PYTHON") != null);
    jdbc.execute("truncate banks,batch_jobs,private.entities cascade");
    job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage) values('ANALYSIS','QUEUED','FEATURES') returning job_id",
            Long.class);
    run = UUID.randomUUID();
    jdbc.update("insert into analysis_runs(run_id,job_id,status) values(?,?,'READY')", run, job);
    jdbc.update("update batch_jobs set current_run_id=? where job_id=?", run, job);
    jdbc.update("insert into banks(bank_id) values(12)");
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(?,'test','test','test','test') returning entity_id",
            Long.class,
            UUID.randomUUID());
    long account =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(12,?,'test',?,'test','test') returning account_id",
            Long.class,
            UUID.randomUUID(),
            entity);
    long tx =
        jdbc.queryForObject(
            "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(now(),?,?,1,'USD',1,'USD','ACH',1,'test','2022-09-01') returning tx_id",
            Long.class,
            account,
            account);
    jdbc.update(
        """
        insert into analysis.input_transactions(run_id,tx_id,input_role,occurred_at,business_date,
          from_bank_id,to_bank_id,from_account_id,to_account_id,from_entity_id,to_entity_id,
          amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
        values(?,?,'TARGET',now(),'2022-09-01',12,12,?,?,?,?,1,'USD',1,'USD','ACH',1,'test')
        """,
        run,
        tx,
        UUID.randomUUID(),
        UUID.randomUUID(),
        UUID.randomUUID(),
        UUID.randomUUID());
  }

  AnalysisStageExecutor.Context claim() {
    UUID token = UUID.randomUUID();
    jdbc.update("update batch_jobs set status='RUNNING',execution_id=? where job_id=?", token, job);
    return new AnalysisStageExecutor.Context(
        job, AnalysisStage.FEATURES, token, List.of(), Map.of(), run);
  }

  @Test
  void spring_runs_real_python_and_advances_only_features() throws Exception {
    try (var runner =
        new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs, integration)) {
      runner.scan();
      assertThat(service.job(job).stage()).isEqualTo(AnalysisStage.INFERENCE);
      assertThat(service.job(job).status()).isEqualTo("QUEUED");
      assertThat(
              jdbc.queryForObject(
                  "select completed from analysis_run_stage_results where run_id=? and stage='FEATURES'",
                  Boolean.class,
                  run))
          .isTrue();
      try (var paths = Files.walk(storage)) {
        assertThat(paths.filter(p -> p.toString().endsWith("targets.parquet")).count())
            .isEqualTo(1);
      }
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("FAILED");
      assertThat(service.job(job).error()).isEqualTo("PIPELINE_NOT_CONFIGURED");
    }
  }

  @Test
  void exit_zero_without_checkpoint_cannot_complete() throws Exception {
    Path fake = storage.resolve("zero.py");
    Files.writeString(fake, "raise SystemExit(0)\n");
    var context = claim();
    assertThatThrownBy(() -> executor(fake.toString()).prepare(context))
        .isInstanceOfSatisfying(
            AnalysisFailure.class,
            e -> assertThat(e.code()).isEqualTo("WORKER_PROTOCOL_NOT_CONNECTED"));
  }

  @Test
  void cancellation_between_python_completion_and_spring_commit_is_rejected() {
    var context = claim();
    var executor = executor("worker/analysis_entry.py");
    var result = executor.prepare(context);
    runs.cancel(run, "REPORT_CORRECTED");
    assertThatThrownBy(() -> executor.commit(context, result))
        .isInstanceOfSatisfying(
            AnalysisFailure.class,
            e -> assertThat(e.code()).isEqualTo("WORKER_CHECKPOINT_MISSING"));
    assertThat(service.job(job).status()).isEqualTo("FAILED");
  }
}
