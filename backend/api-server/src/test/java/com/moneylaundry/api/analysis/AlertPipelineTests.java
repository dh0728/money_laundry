package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.alert.AlertQueryService;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;

/** Real PostgreSQL + real Python entry; model scores here are explicit test inputs. */
@org.springframework.boot.test.context.SpringBootTest
@org.springframework.context.annotation.Import(
    com.moneylaundry.api.TestcontainersConfiguration.class)
class AlertPipelineTests {
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @Autowired org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails database;
  @Autowired AnalysisService service;
  @Autowired AnalysisRunService runs;
  @Autowired com.moneylaundry.api.ingest.TransactionIntegrationService integration;
  @org.springframework.test.context.bean.override.mockito.MockitoBean AnalysisScheduler scheduler;
  @org.junit.jupiter.api.io.TempDir java.nio.file.Path storage;
  long job;
  UUID run;

  PythonAnalysisExecutor executor(String script) {
    return new PythonAnalysisExecutor(
        System.getenv("AML_TEST_PYTHON"),
        script,
        java.time.Duration.ofSeconds(20),
        jdbc,
        database,
        "demo",
        storage.toString());
  }

  @Autowired AlertInputSnapshot snapshot;
  @Autowired AlertQueryService alerts;
  long target;
  long account;

  @BeforeEach
  void alertSetup() {
    jdbc.execute("truncate alerts cascade");
    var fixture = new WorkerPipelineTests();
    fixture.jdbc = jdbc;
    fixture.setup();
    job = fixture.job;
    run = fixture.run;

    target =
        jdbc.queryForObject(
            "select tx_id from analysis.input_transactions where run_id=?", Long.class, run);
    account =
        jdbc.queryForObject(
            "select from_account_id from transactions where tx_id=?", Long.class, target);
    jdbc.update(
        "update transactions set occurred_at='2022-09-02 23:30+09',business_date='2022-09-02' where tx_id=?",
        target);
    jdbc.update("delete from analysis.input_transactions where run_id=?", run);
    runs.snapshot(run, target, "TARGET");
    jdbc.update(
        "update batch_jobs set current_stage='ALERTS',threshold_value=.7,analysis_cutoff_at='2022-09-03 09:00+09' where job_id=?",
        job);
    report(target, "2022-09-02", "2022-09-03 00:00+09");
    snapshot.freeze(run, Instant.parse("2022-09-03T00:00:00Z"));
    jdbc.update(
        "insert into inference_results(job_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,run_id) values(?,?,.9,1,0,0,0,0,0,0,0,0,?)",
        job,
        target,
        run);
    jdbc.update("update transactions set scored_job_id=? where tx_id=?", job, target);
  }

  void report(long txId, String day, String received) {
    long upload =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,bank_id,business_date,received_at) values('INGEST','COMPLETED',12,?::date,?::timestamptz) returning job_id",
            Long.class,
            day,
            received);
    long set =
        jdbc.queryForObject(
            "insert into report_sets(bank_id,business_date) values(12,?::date) returning set_id",
            Long.class,
            day);
    long version =
        jdbc.queryForObject(
            "insert into report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count) values(?,?,1,?::timestamptz,'ACTIVE',1) returning version_id",
            Long.class,
            set,
            upload,
            received);
    jdbc.update(
        "update report_sets set current_version_id=?,generation=1 where set_id=?", version, set);
    long report =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status) values(?,1,?,'cipher','test','ACTIVE') returning report_id",
            Long.class,
            version,
            UUID.randomUUID().toString());
    jdbc.update("insert into transaction_reports values(?,?,'INTERNAL')", txId, report);
    jdbc.update(
        "insert into reporting_scopes(business_date) values(?::date) on conflict do nothing", day);
    jdbc.update("insert into reporting_scope_banks values(?::date,1,12)", day);
  }

  long firstAlert() {
    try (var runner =
        new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs, integration)) {
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("COMPLETED");
    }
    return jdbc.queryForObject(
        "select alert_id from alert_versions where run_id=?", Long.class, run);
  }

  @Test
  void check_without_new_evidence_updates_only_check_time_and_hides_pending_checks() {
    long alert = firstAlert();
    jdbc.update(
        "update alert_coverage_checks set checked_at='2022-09-03 10:00+09' where alert_id=?",
        alert);
    var original = alerts.detail(alert, 1);
    long next =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage,analysis_cutoff_at) values('ANALYSIS','RUNNING','ALERTS','2022-09-04 09:00+09') returning job_id",
            Long.class);
    UUID checking = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,status) values(?,?,'ACTIVE')", checking, next);
    jdbc.update(
        "insert into alert_coverage_checks(alert_id,run_id,coverage,forward_complete,checked_at) values(?,?,?::jsonb,false,'2022-09-04 10:00+09')",
        alert,
        checking,
        "[{\"txId\":1,\"forwardComplete\":false,\"days\":[{\"businessDate\":\"2022-09-03\",\"complete\":true},{\"businessDate\":\"2022-09-05\",\"complete\":false}]}]");
    assertThat(alerts.detail(alert, null)).isEqualTo(original);
    jdbc.update("update analysis_runs set status='COMPLETED' where run_id=?", checking);
    // A completed run inside an unfinished job is still not public.
    assertThat(alerts.detail(alert, null)).isEqualTo(original);
    jdbc.update("update batch_jobs set status='COMPLETED' where job_id=?", next);
    var latest = alerts.detail(alert, null);
    assertThat(latest.get("dataAsOf")).isEqualTo(original.get("dataAsOf"));
    assertThat(latest.get("lastCheckedAt")).isEqualTo("2022-09-04T01:00:00Z");
    assertThat(latest.get("version")).isEqualTo(original.get("version"));
    assertThat((List<?>) latest.get("coverage")).hasSize(1);
    assertThat(latest.get("coverage").toString()).doesNotContain("forwardComplete", "2022-09-05");
    assertThat(latest).doesNotContainKey("forwardComplete");
    assertThat(alerts.detail(alert, 1)).isEqualTo(original);
    jdbc.update("update alert_coverage_checks set checked_at=null where alert_id=?", alert);
    assertThat(alerts.detail(alert, 1).get("lastCheckedAt")).isNull();
  }

  @Test
  void actual_freeze_empty_targets_enriches_next_day_and_keeps_old_version() {
    long alert = firstAlert();
    var old = alerts.detail(alert, 1);
    long context =
        jdbc.queryForObject(
            "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2022-09-03 00:15+09',?,?,2,'USD',2,'USD','ACH',2,'test','2022-09-03') returning tx_id",
            Long.class,
            account,
            account);
    report(context, "2022-09-03", "2022-09-04 00:00+09");
    long follow =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage,threshold_value,analysis_cutoff_at) values('ANALYSIS','QUEUED','FREEZE_INPUT',.7,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    try (var runner =
        new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs, integration)) {
      runner.scan();
      assertThat(service.job(follow).stage()).isEqualTo(AnalysisStage.ALERTS);
      assertThat(service.job(follow).status()).isEqualTo("QUEUED");
      UUID followRun = runs.current(follow);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",
                  Integer.class,
                  followRun))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions where run_id=? and tx_id=?",
                  Integer.class,
                  followRun,
                  context))
          .isEqualTo(1);
      runner.scan();
      assertThat(service.job(follow).status()).isEqualTo("COMPLETED");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_model_tasks where run_id=?",
                  Integer.class,
                  followRun))
          .isZero();
    }
    assertThat(alerts.versions(alert)).hasSize(2);
    assertThat(alerts.detail(alert, 1)).isEqualTo(old);
    assertThat((List<?>) alerts.detail(alert, null).get("transactions")).hasSize(2);
    assertThat(alerts.detail(alert, null)).doesNotContainKey("forwardComplete");
    assertThat(alerts.detail(alert, null).get("dataAsOf")).isEqualTo("2022-09-04T00:00:00Z");
    assertThat(alerts.detail(alert, null).get("lastCheckedAt")).isNotNull();
    assertThat(alerts.list(0, 20, null, null, follow).get("totalElements")).isEqualTo(1L);
  }

  @Test
  void followup_freeze_uses_only_visible_leaf_case_and_hides_staged_versions() {
    long parent = firstAlert();
    var old = alerts.detail(parent, null);
    jdbc.update("update alerts set status='CLOSED',resolution='NORMAL' where alert_id=?", parent);
    long child =
        jdbc.queryForObject(
            "insert into alerts(assignee_id,parent_alert_id) select assignee_id,alert_id from alerts where alert_id=? returning alert_id",
            Long.class,
            parent);
    long second =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage,threshold_value,analysis_cutoff_at) values('ANALYSIS','COMPLETED','COMPLETE',.7,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    UUID completed = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,status) values(?,?,'COMPLETED')",
        completed,
        second);
    jdbc.update("update batch_jobs set current_run_id=? where job_id=?", completed, second);
    jdbc.update(
        "insert into alert_versions select ?,1,?,fingerprint,evidence,now() from alert_versions where alert_id=? and version=1",
        child,
        completed,
        parent);
    jdbc.update(
        "insert into alert_coverage_checks(alert_id,run_id,coverage,forward_complete) values(?,?,'[]',false)",
        child,
        completed);
    long next =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage,threshold_value,analysis_cutoff_at) values('ANALYSIS','QUEUED','FREEZE_INPUT',.7,'2022-09-05 09:00+09') returning job_id",
            Long.class);
    UUID pending = runs.freeze(next, Instant.parse("2022-09-05T00:00:00Z"));
    assertThat(
            jdbc.queryForList(
                "select alert_id from analysis.alert_origins where run_id=?", Long.class, pending))
        .containsExactly(child);
    jdbc.update(
        "insert into alert_versions select ?,2,?,fingerprint,evidence,now() from alert_versions where alert_id=? and version=1",
        parent,
        pending,
        parent);
    assertThat(alerts.detail(parent, null).get("version")).isEqualTo(1);
    assertThat(alerts.versions(parent)).hasSize(1);
    assertThatThrownBy(() -> alerts.detail(parent, 2)).isInstanceOf(ApiException.class);
    runs.cancel(pending, "REPORT_CORRECTED");
    assertThat(alerts.detail(parent, null).get("transactions")).isEqualTo(old.get("transactions"));
    assertThat(alerts.versions(parent)).hasSize(1);
  }

  @Test
  void completed_only_visibility_and_cancelled_evidence_remains_hidden() {
    UUID token = UUID.randomUUID();
    jdbc.update("update batch_jobs set status='RUNNING',execution_id=? where job_id=?", token, job);
    var context =
        new AnalysisStageExecutor.Context(
            job, AnalysisStage.ALERTS, token, List.of(), Map.of(), run);
    var worker = executor("worker/analysis_entry.py");
    worker.prepare(context);
    long alert =
        jdbc.queryForObject("select alert_id from alert_versions where run_id=?", Long.class, run);
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(0L);
    assertThatThrownBy(() -> alerts.detail(alert, null)).isInstanceOf(ApiException.class);
    runs.cancel(run, "REPORT_CORRECTED");
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(0L);
  }
}
