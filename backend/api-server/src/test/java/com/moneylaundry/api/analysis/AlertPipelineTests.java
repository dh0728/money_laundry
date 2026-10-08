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
  @org.springframework.test.context.bean.override.mockito.MockitoBean AnalysisScheduler scheduler;
  @org.junit.jupiter.api.io.TempDir java.nio.file.Path storage;
  long job;
  UUID run;

  PythonAnalysisExecutor executor(String script) {
    return AnalysisWorkerTestDatabase.configure(
        new PythonAnalysisExecutor(
            System.getenv("AML_TEST_PYTHON"),
            script,
            java.time.Duration.ofSeconds(20),
            jdbc,
            database,
            "demo",
            storage.toString()),
        jdbc);
  }

  @Autowired AlertInputSnapshot snapshot;
  @Autowired AlertQueryService alerts;
  long target;
  long account;
  long receiver;
  long initialContext;

  @BeforeEach
  void alertSetup() {
    jdbc.execute("truncate review.alerts cascade");
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
            "select from_account_id from ledger.transactions where tx_id=?", Long.class, target);
    receiver =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) select bank_id,?,owner_id from core.accounts where account_id=? returning account_id",
            Long.class,
            UUID.randomUUID(),
            account);
    jdbc.update(
        "update ledger.transactions set to_account_id=?,occurred_at='2022-09-02 23:30+09',business_date='2022-09-02' where tx_id=?",
        receiver,
        target);
    jdbc.update("delete from analysis.target_ownership where run_id=?", run);
    jdbc.update("delete from analysis.input_transactions where run_id=?", run);
    runs.snapshot(run, target, "TARGET");
    jdbc.update(
        "update analysis.jobs set current_stage='ALERTS',threshold_value=.7,analysis_cutoff_at='2022-09-03 09:00+09' where job_id=?",
        job);
    report(target, "2022-09-02", "2022-09-03 00:00+09");
    initialContext =
        jdbc.queryForObject(
            "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2022-09-02 23:40+09',?,?,1,'USD',1,'USD','ACH',1,'test','2022-09-02') returning tx_id",
            Long.class,
            receiver,
            account);
    long contextReport =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status) select br.version_id,2,?,'cipher','test','ACTIVE' from private.bank_reports br join ledger.transaction_reports tr using(report_id) where tr.tx_id=? returning report_id",
            Long.class,
            UUID.randomUUID().toString(),
            target);
    jdbc.update(
        "insert into ledger.transaction_reports values(?,?,'INTERNAL')",
        initialContext,
        contextReport);

    snapshot.freeze(run, Instant.parse("2022-09-03T00:00:00Z"));
    jdbc.update(
        "insert into analysis.scores(type_class,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,run_id) values(?,?,.9,1,0,0,0,0,0,0,0,0,?)",
        0,
        target,
        run);
  }

  void report(long txId, String day, String received) {
    long upload =
        jdbc.queryForObject(
            "insert into ingest.uploads(file_name,file_hash,size_bytes,status,bank_id,business_date,received_at) values('fixture.csv',repeat('a',64),1,'COMPLETED',12,?::date,?::timestamptz) returning upload_id",
            Long.class,
            day,
            received);
    long set =
        jdbc.queryForObject(
            "insert into ingest.report_sets(bank_id,business_date) values(12,?::date) returning set_id",
            Long.class,
            day);
    long version =
        jdbc.queryForObject(
            "insert into ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count) values(?,?,1,?::timestamptz,'ACTIVE',1) returning version_id",
            Long.class,
            set,
            upload,
            received);
    jdbc.update(
        "update ingest.report_sets set current_version_id=?,generation=1 where set_id=?",
        version,
        set);
    long report =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status) values(?,1,?,'cipher','test','ACTIVE') returning report_id",
            Long.class,
            version,
            UUID.randomUUID().toString());
    jdbc.update("insert into ledger.transaction_reports values(?,?,'INTERNAL')", txId, report);
    jdbc.update(
        "insert into ingest.reporting_scopes(business_date) values(?::date) on conflict do nothing",
        day);
    jdbc.update("insert into ingest.reporting_scope_banks values(?::date,1,12)", day);
  }

  long firstAlert() {
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("COMPLETED");
    }
    return jdbc.queryForObject(
        "select alert_id from review.alert_versions where run_id=?", Long.class, run);
  }

  UUID freezeCheck() {
    long next =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,status,current_stage,threshold_value,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),'QUEUED','FREEZE_INPUT',.7,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    UUID checking = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", checking, next);
    snapshot.freeze(checking, Instant.parse("2022-09-04T00:00:00Z"));
    return checking;
  }

  long contextOn(String day) {
    long id =
        jdbc.queryForObject(
            "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(?::timestamptz,?,?,2,'USD',2,'USD','ACH',2,'test',?::date) returning tx_id",
            Long.class,
            day + " 10:00+09",
            account,
            receiver,
            day);
    report(id, day, "2022-09-03 01:00+09");
    return id;
  }

  @Test
  void frozen_envelope_supports_rolling_paths_but_never_copies_future_transactions() {
    firstAlert();
    long distant = contextOn("2022-08-29");
    long nearby = contextOn("2022-09-01");
    long future = contextOn("2022-09-05");
    UUID checking = freezeCheck();
    var ids =
        jdbc.queryForList(
            "select tx_id from analysis.input_transactions where run_id=?", Long.class, checking);
    assertThat(ids).contains(distant, nearby).doesNotContain(future);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_coverage where run_id=? and business_date>'2022-09-04'",
                Integer.class,
                checking))
        .isZero();
  }

  @Test
  void full_snapshot_rechecks_visible_origins_without_copying_future_sources() {
    long alert = firstAlert();
    jdbc.update(
        "insert into ingest.reporting_scopes(business_date) values('2020-01-01'),('2030-01-01')");
    UUID checking = freezeCheck();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_origins where run_id=?",
                Integer.class,
                checking))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.source_manifest where run_id=? and business_date='2030-01-01'",
                Integer.class,
                checking))
        .isZero();
  }

  @Test
  void source_revision_rechecks_even_complete_windows_and_failed_checks_do_not_consume_change() {
    long alert = firstAlert();
    String frozen =
        jdbc.queryForObject(
            "select state::text from analysis.source_manifest where run_id=? and business_date='2022-09-02'",
            String.class,
            run);
    jdbc.update(
        "update ingest.report_versions set revision=revision+1 where set_id in(select set_id from ingest.report_sets where business_date='2022-09-02')");
    UUID failed = freezeCheck();
    assertThat(
            jdbc.queryForList(
                "select alert_id from analysis.alert_origins where run_id=?", Long.class, failed))
        .containsExactly(alert);
    assertThat(
            jdbc.queryForObject(
                "select state::text from analysis.source_manifest where run_id=? and business_date='2022-09-02'",
                String.class,
                run))
        .isEqualTo(frozen);
    jdbc.update(
        "insert into review.alert_coverage_checks(alert_id,run_id,coverage,checked_at) values(?,?,'[]',clock_timestamp())",
        alert,
        failed);
    jdbc.update("update analysis.runs set status='CANCELLED' where run_id=?", failed);
    UUID retried = freezeCheck();
    assertThat(
            jdbc.queryForList(
                "select alert_id from analysis.alert_origins where run_id=?", Long.class, retried))
        .containsExactly(alert);
    jdbc.update(
        "insert into review.alert_coverage_checks(alert_id,run_id,coverage,checked_at) values(?,?,'[]',clock_timestamp())",
        alert,
        retried);
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", retried);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED' where job_id=(select job_id from analysis.runs where run_id=?)",
        retried);
    UUID unchanged = freezeCheck();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_origins where run_id=?",
                Integer.class,
                unchanged))
        .isEqualTo(1);
  }

  @Test
  void scope_membership_change_rechecks_without_any_new_target_or_report() {
    long alert = firstAlert();
    jdbc.update("delete from ingest.reporting_scope_banks where business_date='2022-09-02'");
    UUID checking = freezeCheck();
    assertThat(
            jdbc.queryForList(
                "select alert_id from analysis.alert_origins where run_id=?", Long.class, checking))
        .containsExactly(alert);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",
                Integer.class,
                checking))
        .isZero();
  }

  @Test
  void check_without_new_evidence_updates_only_check_time_and_hides_pending_checks() {
    long alert = firstAlert();
    jdbc.update(
        "update review.alert_coverage_checks set checked_at='2022-09-03 10:00+09' where alert_id=?",
        alert);
    var original = alerts.detail(alert, 1);
    long next =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,threshold_value,status,current_stage,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),.7,'RUNNING','ALERTS','2022-09-04 09:00+09') returning job_id",
            Long.class);
    UUID checking = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'ACTIVE')", checking, next);
    jdbc.update(
        "insert into review.alert_coverage_checks(alert_id,run_id,coverage,checked_at) values(?,?,?::jsonb,'2022-09-04 10:00+09')",
        alert,
        checking,
        "[{\"txId\":1,\"forwardComplete\":false,\"days\":[{\"businessDate\":\"2022-09-03\",\"complete\":true},{\"businessDate\":\"2022-09-05\",\"complete\":false}]}]");
    assertThat(alerts.detail(alert, null)).isEqualTo(original);
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", checking);
    // A completed run inside an unfinished job is still not public.
    assertThat(alerts.detail(alert, null)).isEqualTo(original);
    jdbc.update("update analysis.jobs set status='COMPLETED' where job_id=?", next);
    var latest = alerts.detail(alert, null);
    assertThat(latest.get("dataAsOf")).isEqualTo(original.get("dataAsOf"));
    assertThat(latest.get("lastCheckedAt")).isEqualTo("2022-09-04T01:00:00Z");
    assertThat(latest.get("version")).isEqualTo(original.get("version"));
    assertThat((List<?>) latest.get("coverage")).hasSize(1);
    assertThat(latest.get("coverage").toString()).doesNotContain("forwardComplete", "2022-09-05");
    assertThat(latest).doesNotContainKey("forwardComplete");
    assertThat(alerts.detail(alert, 1)).isEqualTo(original);
    jdbc.update("update review.alert_coverage_checks set checked_at=null where alert_id=?", alert);
    assertThat(alerts.detail(alert, 1).get("lastCheckedAt")).isNull();
  }

  @Test
  void actual_freeze_empty_targets_enriches_next_day_and_keeps_old_version() {
    long alert = firstAlert();
    var old = alerts.detail(alert, 1);
    long context =
        jdbc.queryForObject(
            "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2022-09-04 02:54+09',?,?,2,'USD',2,'USD','ACH',2,'test','2022-09-04') returning tx_id",
            Long.class,
            account,
            receiver);
    report(context, "2022-09-04", "2022-09-04 03:00+09");
    long follow =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,status,current_stage,threshold_value,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),'QUEUED','FREEZE_INPUT',.7,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
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
                  "select count(*) from analysis.model_tasks where run_id=?",
                  Integer.class,
                  followRun))
          .isZero();
    }
    assertThat(alerts.versions(alert)).hasSize(2);
    assertThat(alerts.detail(alert, 1).get("transactions")).isEqualTo(old.get("transactions"));
    assertThat((List<?>) alerts.detail(alert, null).get("transactions")).hasSize(3);
    assertThat(alerts.detail(alert, null)).doesNotContainKey("forwardComplete");
    assertThat(alerts.detail(alert, null).get("dataAsOf")).isEqualTo("2022-09-04T00:00:00Z");
    assertThat(alerts.detail(alert, null).get("lastCheckedAt")).isNotNull();
    assertThat(alerts.list(0, 20, null, null, follow).get("totalElements")).isEqualTo(1L);
  }

  @Test
  void followup_freeze_keeps_closed_ancestry_and_hides_unpublished_proposals() {
    long parent = firstAlert();
    var old = alerts.detail(parent, null);
    jdbc.update(
        "update review.alerts set status='CLOSED',outcome='NORMAL',closed_at=now() where alert_id=?",
        parent);
    long child =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) select assignee_id,now(),now() from review.alerts where alert_id=? returning alert_id",
            Long.class,
            parent);
    long second =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,status,current_stage,threshold_value,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),'COMPLETED','COMPLETE',.7,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    UUID completed = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')",
        completed,
        second);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", completed, second);
    jdbc.update(
        "insert into review.alert_versions select ?,1,?,fingerprint,evidence,now(),now() from review.alert_versions where alert_id=? and version=1",
        child,
        completed,
        parent);
    jdbc.update(
        "insert into review.alert_coverage_checks(alert_id,run_id,coverage) values(?,?,'[]')",
        child,
        completed);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", child);
    long lineageEvent =
        jdbc.queryForObject(
            "insert into review.events(alert_id,action,comment,business_at,snapshot) values(?,'FOLLOWUP_CREATED','test',now(),'{}') returning event_id",
            Long.class,
            child);
    jdbc.update(
        "insert into review.alert_lineage values(?,?,'FOLLOWUP_OF',?)",
        child,
        parent,
        lineageEvent);
    long next =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,status,current_stage,threshold_value,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),'QUEUED','FREEZE_INPUT',.7,'2022-09-05 09:00+09') returning job_id",
            Long.class);
    UUID pending = runs.freeze(next, Instant.parse("2022-09-05T00:00:00Z"));
    assertThat(
            jdbc.queryForList(
                "select alert_id from analysis.alert_origins where run_id=?", Long.class, pending))
        .containsExactlyInAnyOrder(parent, child);
    jdbc.update(
        "insert into review.alert_versions select ?,2,?,fingerprint,evidence,now(),null from review.alert_versions where alert_id=? and version=1",
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
    jdbc.update(
        "update analysis.jobs set status='RUNNING',execution_owner=gen_random_uuid(),execution_id=? where job_id=?",
        token,
        job);
    var context =
        new AnalysisStageExecutor.Context(
            job, AnalysisStage.ALERTS, token, List.of(), Map.of(), run);
    var worker = executor("worker/analysis_entry.py");
    worker.prepare(context);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_plans where run_id=?", Integer.class, run))
        .isPositive();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.alert_versions where run_id=?", Integer.class, run))
        .isZero();
    long alert = Long.MAX_VALUE;
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(0L);
    assertThatThrownBy(() -> alerts.detail(alert, null)).isInstanceOf(ApiException.class);
    runs.cancel(run, "REPORT_CORRECTED");
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(0L);
  }

  @Test
  void unassigned_historical_seed_is_revisited_without_target_or_existing_alert() {
    jdbc.update(
        "delete from analysis.input_reports where run_id=? and tx_id=?", run, initialContext);
    jdbc.update(
        "delete from analysis.input_transactions where run_id=? and tx_id=?", run, initialContext);
    jdbc.update(
        "update ledger.transactions set integration_status='HELD' where tx_id=?", initialContext);
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("COMPLETED");
    }
    assertThat(jdbc.queryForObject("select count(*) from review.alert_versions", Integer.class))
        .isZero();
    long connecting = contextOn("2022-09-03");
    long follow =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,business_at,status,current_stage,threshold_value,analysis_cutoff_at) values(date '2100-01-01'+nextval('core.work_id')::int,now(),'QUEUED','FREEZE_INPUT',.99,'2022-09-04 09:00+09') returning job_id",
            Long.class);
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
      runner.scan();
      assertThat(service.job(follow).stage()).isEqualTo(AnalysisStage.ALERTS);
      UUID next = runs.current(follow);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.alert_origins where run_id=?",
                  Integer.class,
                  next))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",
                  Integer.class,
                  next))
          .isZero();
      runner.scan();
      assertThat(service.job(follow).status()).isEqualTo("COMPLETED");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.model_tasks where run_id=?", Integer.class, next))
          .isZero();
      long alert =
          jdbc.queryForObject(
              "select alert_id from review.alert_versions where run_id=?", Long.class, next);
      assertThat(
              jdbc.queryForList(
                  "select tx_id from review.alert_transactions where alert_id=? order by tx_id",
                  Long.class,
                  alert))
          .containsExactly(target, connecting);
      assertThat(
              jdbc.queryForObject(
                  "select (evidence->'seeds'->0->>'threshold')::float8 from review.alert_versions where alert_id=?",
                  Double.class,
                  alert))
          .isEqualTo(.7);
    }
  }

  AnalysisStageExecutor.Context nextPreparedContext() {
    UUID next = freezeCheck();
    long nextJob =
        jdbc.queryForObject("select job_id from analysis.runs where run_id=?", Long.class, next);
    UUID token = UUID.randomUUID();
    jdbc.update(
        "update analysis.jobs set current_run_id=?,current_stage='ALERTS',status='RUNNING',execution_owner=gen_random_uuid(),execution_id=? where job_id=?",
        next,
        token,
        nextJob);
    return new AnalysisStageExecutor.Context(
        nextJob, AnalysisStage.ALERTS, token, List.of(), Map.of(), next);
  }

  void publish(AnalysisStageExecutor.Context context, String artifact) {
    service.tx.executeWithoutResult(
        s -> {
          AnalysisRunService.integrationLock(jdbc);
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          new com.moneylaundry.api.review.AlertPublisher(jdbc)
              .publish(context.runId(), context.executionId(), artifact);
          runs.complete(context.runId());
          jdbc.update(
              "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE' where job_id=?",
              context.jobId());
        });
  }

  @Test
  void final_failure_rolls_back_cases_assignments_events_and_preserves_prepared_plan() {
    UUID token = UUID.randomUUID();
    jdbc.update(
        "update analysis.jobs set status='RUNNING',execution_owner=gen_random_uuid(),execution_id=? where job_id=?",
        token,
        job);
    var context =
        new AnalysisStageExecutor.Context(
            job, AnalysisStage.ALERTS, token, List.of(), Map.of(), run);
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    var assignments =
        jdbc.queryForList("select user_id,last_assigned_at from core.users order by user_id");
    assertThatThrownBy(
            () ->
                service.tx.executeWithoutResult(
                    s -> {
                      new com.moneylaundry.api.review.AlertPublisher(jdbc)
                          .publish(run, token, artifact);
                      throw new IllegalStateException("injected before run completion");
                    }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(jdbc.queryForObject("select count(*) from review.alerts", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("select count(*) from review.events", Integer.class)).isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_plans where run_id=?", Integer.class, run))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForList("select user_id,last_assigned_at from core.users order by user_id"))
        .isEqualTo(assignments);
    publish(context, artifact);
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(1L);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_plans where run_id=?", Integer.class, run))
        .isZero();
  }

  @Test
  void unstarted_cases_merge_once_with_earliest_owner_and_both_recipients() {
    long survivor = firstAlert();
    long owner =
        jdbc.queryForObject(
            "select assignee_id from review.alerts where alert_id=?", Long.class, survivor);
    long other =
        jdbc.queryForObject(
            "select min(user_id) from core.users where role='STAFF' and user_id<>?",
            Long.class,
            owner);
    long source =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now()+interval '1 hour',now()) returning alert_id",
            Long.class,
            other);
    jdbc.update(
        "insert into review.alert_versions select ?,1,run_id,fingerprint,evidence,now(),now() from review.alert_versions where alert_id=? and version=1",
        source,
        survivor);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", source);
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    publish(context, artifact);
    assertThat(
            jdbc.queryForObject(
                "select merged_into_alert_id from review.alerts where alert_id=?",
                Long.class,
                source))
        .isEqualTo(survivor);
    assertThat(
            jdbc.queryForObject(
                "select assignee_id from review.alerts where alert_id=?", Long.class, survivor))
        .isEqualTo(owner);
    assertThat(
            jdbc.queryForList(
                "select user_id from review.notifications where kind='MERGED' order by user_id",
                Long.class))
        .containsExactlyInAnyOrder(owner, other);
    assertThat(alerts.list(0, 20, null, null, null).get("totalElements")).isEqualTo(1L);
    assertThat(alerts.detail(source, null).get("canonicalAlertId")).isEqualTo(survivor);
  }

  @Test
  void investigated_merge_is_hidden_until_owner_accepts_and_replay_is_idempotent()
      throws Exception {
    long alert = firstAlert();
    long owner =
        jdbc.queryForObject(
            "select assignee_id from review.alerts where alert_id=?", Long.class, alert);
    jdbc.update(
        "update review.alerts set review_started_at=now(),review_started_by=assignee_id where alert_id=?",
        alert);
    long source =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now()+interval '1 hour',now()) returning alert_id",
            Long.class,
            owner);
    jdbc.update(
        "insert into review.alert_versions select ?,1,run_id,fingerprint,evidence,now(),now() from review.alert_versions where alert_id=? and version=1",
        source,
        alert);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", source);
    contextOn("2022-09-03");
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    publish(context, artifact);
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
    assertThat(alerts.versions(alert)).hasSize(1);
    assertThatThrownBy(() -> alerts.detail(alert, 2)).isInstanceOf(ApiException.class);
    long proposal =
        jdbc.queryForObject(
            "select proposal_id from review.alert_change_proposals where target_alert_id=?",
            Long.class,
            alert);
    var time =
        new com.moneylaundry.api.review.BusinessTime(
            jdbc,
            service.tx,
            new org.springframework.mock.env.MockEnvironment()
                .withProperty("spring.profiles.active", "local"));
    var reviews = new com.moneylaundry.api.review.ReviewService(jdbc, service.tx, time, alerts);
    var proposals =
        new com.moneylaundry.api.review.AlertProposalService(jdbc, service.tx, time, reviews);
    long outsider =
        jdbc.queryForObject(
            "select min(user_id) from core.users where role='STAFF' and user_id<>?",
            Long.class,
            owner);
    assertThatThrownBy(() -> proposals.detail(proposal, outsider)).isInstanceOf(ApiException.class);
    var mvc =
        org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                new com.moneylaundry.api.review.AlertProposalController(proposals, reviews))
            .build();
    String username =
        jdbc.queryForObject("select username from core.users where user_id=?", String.class, owner);
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                    "/api/v1/review/alert-proposals/" + proposal)
                .principal(() -> username))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.status")
                .value("OPEN"))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                    "$.evidence.transactions")
                .isArray());
    long revision =
        jdbc.queryForObject(
            "select revision from review.alerts where alert_id=?", Long.class, alert);
    var vote =
        new com.moneylaundry.api.review.AlertProposalService.Vote(
            UUID.randomUUID(), 0, "ACCEPT", Map.of(alert, revision, source, 0L), "accept merge");
    mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(
                    "/api/v1/review/alert-proposals/" + proposal + "/votes")
                .principal(() -> username)
                .contentType("application/json")
                .content(new tools.jackson.databind.ObjectMapper().writeValueAsString(vote)))
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
        .andExpect(
            org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.status")
                .value("ACCEPTED"));
    assertThat(proposals.vote(proposal, owner, vote)).containsEntry("status", "ACCEPTED");
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(2);
    assertThat(alerts.versions(alert)).hasSize(2);
  }

  @Test
  void investigated_alert_adds_evidence_automatically_preserving_staff_scope_and_auditing_once() {
    long alert = firstAlert();
    long owner =
        jdbc.queryForObject(
            "select assignee_id from review.alerts where alert_id=?", Long.class, alert);
    jdbc.update(
        "update review.alerts set review_started_at=now(),review_started_by=assignee_id where alert_id=?",
        alert);
    long group =
        jdbc.queryForObject(
            "insert into review.alert_groups(alert_id,label,evidence_version) values(?,'investigating',1) returning group_id",
            Long.class,
            alert);
    jdbc.update(
        "insert into review.alert_members(group_id,alert_id,tx_id,evidence_version,review_role,state,decision) values(?,?,?,1,'SUBJECT','DECIDED','NORMAL')",
        group,
        alert,
        target);
    jdbc.update(
        "insert into review.alert_members(group_id,alert_id,tx_id,evidence_version,review_role,state) values(?,?,?,1,'CONTEXT','EXCLUDED')",
        group,
        alert,
        initialContext);
    long added = contextOn("2022-09-03");
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    publish(context, artifact);
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.alert_change_proposals", Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForMap(
                "select state,decision,evidence_version from review.alert_members where alert_id=? and tx_id=?",
                alert,
                target))
        .containsEntry("state", "DECIDED")
        .containsEntry("decision", "NORMAL")
        .containsEntry("evidence_version", 1);
    assertThat(
            jdbc.queryForObject(
                "select state from review.alert_members where alert_id=? and tx_id=?",
                String.class,
                alert,
                initialContext))
        .isEqualTo("EXCLUDED");
    assertThat(
            jdbc.queryForMap(
                "select state,decision,evidence_version from review.alert_members where alert_id=? and tx_id=?",
                alert,
                added))
        .containsEntry("state", "PENDING")
        .containsEntry("decision", null)
        .containsEntry("evidence_version", 2);
    assertThat(
            jdbc.queryForList(
                "select (entry->>'txId')::bigint from review.events e cross join lateral jsonb_array_elements(e.snapshot->'addedTransactions') entry where e.alert_id=? and e.action='ADDED_EVIDENCE'",
                Long.class,
                alert))
        .containsExactly(added);
    assertThat(
            jdbc.queryForObject(
                "select snapshot->>'previousPublishedVersion' from review.events where alert_id=? and action='ADDED_EVIDENCE'",
                String.class,
                alert))
        .isEqualTo("1");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where alert_id=? and action='ADDED_EVIDENCE' and business_at is not null",
                Integer.class,
                alert))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForList(
                "select user_id from review.notifications where kind='ADDED_EVIDENCE'", Long.class))
        .containsExactly(owner);
    var repeat = nextPreparedContext();
    assertThat(
            jdbc.queryForObject(
                "select comment from review.events where alert_id=? and action='ADDED_EVIDENCE'",
                String.class,
                alert))
        .contains("추가 거래 1건", "거래 ID: " + added, "근거 버전 1 → 2");
    publish(repeat, executor("worker/analysis_entry.py").prepare(repeat).artifact());
    assertThat(alerts.versions(alert)).hasSize(2);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where alert_id=? and action='ADDED_EVIDENCE'",
                Integer.class,
                alert))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select summary_revision=revision from review.alerts where alert_id=?",
                Boolean.class,
                alert))
        .isTrue();
  }

  com.moneylaundry.api.review.ReviewService reviews() {
    var time =
        new com.moneylaundry.api.review.BusinessTime(
            jdbc,
            service.tx,
            new org.springframework.mock.env.MockEnvironment()
                .withProperty("spring.profiles.active", "local"));
    return new com.moneylaundry.api.review.ReviewService(jdbc, service.tx, time, alerts);
  }

  @Test
  void closed_flow_creates_one_followup_and_repeated_evidence_reuses_it() {
    long parent = firstAlert();
    jdbc.update(
        "update review.alerts set status='CLOSED',outcome='NORMAL',closed_at=now() where alert_id=?",
        parent);
    var unchanged = nextPreparedContext();
    publish(unchanged, executor("worker/analysis_entry.py").prepare(unchanged).artifact());
    assertThat(jdbc.queryForObject("select count(*) from review.alerts", Integer.class))
        .isEqualTo(1);
    long newSeed = contextOn("2022-09-03");
    var added = nextPreparedContext();
    jdbc.update(
        "update analysis.input_transactions set input_role='TARGET' where run_id=? and tx_id=?",
        added.runId(),
        newSeed);
    jdbc.update(
        "insert into analysis.scores(type_class,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,run_id) values(0,?,.9,1,0,0,0,0,0,0,0,0,?)",
        newSeed,
        added.runId());
    publish(added, executor("worker/analysis_entry.py").prepare(added).artifact());
    long child =
        jdbc.queryForObject(
            "select source_alert_id from review.alert_lineage where target_alert_id=? and kind='FOLLOWUP_OF'",
            Long.class,
            parent);
    assertThat(jdbc.queryForObject("select count(*) from review.alerts", Integer.class))
        .isEqualTo(2);
    assertThat(alerts.detail(parent, null).get("version")).isEqualTo(1);
    assertThat(
            jdbc.queryForMap("select status,outcome from review.alerts where alert_id=?", parent))
        .containsEntry("status", "CLOSED")
        .containsEntry("outcome", "NORMAL");
    var repeated = nextPreparedContext();
    publish(repeated, executor("worker/analysis_entry.py").prepare(repeated).artifact());
    assertThat(jdbc.queryForObject("select count(*) from review.alerts", Integer.class))
        .isEqualTo(2);
    assertThat(alerts.versions(child)).hasSize(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where action='FOLLOWUP_CREATED'",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void held_fact_is_not_a_confirmed_withdrawal() {
    long alert = firstAlert();
    jdbc.update("update ledger.transactions set integration_status='HELD' where tx_id=?", target);
    var context = nextPreparedContext();
    publish(context, executor("worker/analysis_entry.py").prepare(context).artifact());
    assertThat(
            jdbc.queryForObject(
                "select status from review.alerts where alert_id=?", String.class, alert))
        .isEqualTo("OPEN");
    assertThat(alerts.versions(alert)).hasSize(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.alert_change_proposals", Integer.class))
        .isZero();
  }

  com.moneylaundry.api.review.AlertProposalService proposals() {
    var time =
        new com.moneylaundry.api.review.BusinessTime(
            jdbc,
            service.tx,
            new org.springframework.mock.env.MockEnvironment()
                .withProperty("spring.profiles.active", "local"));
    return new com.moneylaundry.api.review.AlertProposalService(jdbc, service.tx, time, reviews());
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
  void corrected_core_withdrawal_preserves_judgments_and_removes_only_current_scope(
      boolean started) {
    long alert = firstAlert();
    long owner =
        jdbc.queryForObject(
            "select assignee_id from review.alerts where alert_id=?", Long.class, alert);
    if (started) {
      jdbc.update(
          "update review.alerts set review_started_at=now(),review_started_by=assignee_id where alert_id=?",
          alert);
      long group =
          jdbc.queryForObject(
              "insert into review.alert_groups(alert_id,label,evidence_version) values(?,'reviewed',1) returning group_id",
              Long.class,
              alert);
      jdbc.update(
          "insert into review.alert_members(group_id,alert_id,tx_id,evidence_version,review_role,state,decision) values(?,?,?,1,'SUBJECT','DECIDED','NORMAL')",
          group,
          alert,
          target);
    }
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", target);
    var context = nextPreparedContext();
    publish(context, executor("worker/analysis_entry.py").prepare(context).artifact());
    if (started) {
      assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
      long proposal =
          jdbc.queryForObject(
              "select proposal_id from review.alert_change_proposals where target_alert_id=?",
              Long.class,
              alert);
      long revision =
          jdbc.queryForObject(
              "select revision from review.alerts where alert_id=?", Long.class, alert);
      assertThat(
              proposals()
                  .vote(
                      proposal,
                      owner,
                      new com.moneylaundry.api.review.AlertProposalService.Vote(
                          UUID.randomUUID(),
                          0,
                          "ACCEPT",
                          Map.of(alert, revision),
                          "정정으로 사라진 근거 확인")))
          .containsEntry("status", "ACCEPTED");
      assertThat(
              jdbc.queryForMap(
                  "select state,decision,evidence_version from review.alert_members where alert_id=? and tx_id=?",
                  alert,
                  target))
          .containsEntry("state", "DECIDED")
          .containsEntry("decision", "NORMAL")
          .containsEntry("evidence_version", 1);
      assertThat((List<?>) reviews().detail(alert).get("withdrawnMembers")).hasSize(1);
    }
    assertThat(jdbc.queryForMap("select status,outcome from review.alerts where alert_id=?", alert))
        .containsEntry("status", "CLOSED")
        .containsEntry("outcome", "SCOPE_CLEARED");
    assertThat(
            jdbc.queryForObject(
                "select (summary->>'txCount')::int from review.alerts where alert_id=?",
                Integer.class,
                alert))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.effective_members where case_id=?",
                Integer.class,
                alert))
        .isZero();
    assertThat(((Map<?, ?>) reviews().detail(alert).get("summary")).get("txCount")).isEqualTo(0);
    assertThat(alerts.versions(alert)).hasSize(2);
    var repeat = nextPreparedContext();
    publish(repeat, executor("worker/analysis_entry.py").prepare(repeat).artifact());
    assertThat(alerts.versions(alert)).hasSize(2);
  }

  @org.junit.jupiter.params.ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(
      strings = {"ACCEPT", "REJECT", "STALE_FACT", "STALE_CASE"})
  void multi_owner_merge_requires_current_unanimous_approval(String outcome) {
    long alert = firstAlert();
    long owner =
        jdbc.queryForObject(
            "select assignee_id from review.alerts where alert_id=?", Long.class, alert);
    long other =
        jdbc.queryForObject(
            "select min(user_id) from core.users where role='STAFF' and user_id<>?",
            Long.class,
            owner);
    jdbc.update(
        "update review.alerts set review_started_at=now(),review_started_by=assignee_id where alert_id=?",
        alert);
    long source =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now()+interval '1 hour',now()) returning alert_id",
            Long.class,
            other);
    jdbc.update(
        "insert into review.alert_versions select ?,1,run_id,fingerprint,evidence,now(),now() from review.alert_versions where alert_id=? and version=1",
        source,
        alert);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", source);
    var context = nextPreparedContext();
    publish(context, executor("worker/analysis_entry.py").prepare(context).artifact());
    long proposal =
        jdbc.queryForObject(
            "select proposal_id from review.alert_change_proposals where target_alert_id=?",
            Long.class,
            alert);
    long revision =
        jdbc.queryForObject(
            "select revision from review.alerts where alert_id=?", Long.class, alert);
    var firstVote =
        new com.moneylaundry.api.review.AlertProposalService.Vote(
            UUID.randomUUID(), 0, "ACCEPT", Map.of(alert, revision), "첫 담당자 확인");
    assertThat(proposals().vote(proposal, owner, firstVote)).containsEntry("status", "OPEN");
    assertThat(proposals().vote(proposal, owner, firstVote)).containsEntry("status", "OPEN");
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select merged_into_alert_id from review.alerts where alert_id=?",
                Long.class,
                source))
        .isNull();
    if ("STALE_FACT".equals(outcome))
      jdbc.update(
          "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", target);
    if ("STALE_CASE".equals(outcome))
      jdbc.update("update review.alerts set revision=revision+1 where alert_id=?", source);
    var lastVote =
        new com.moneylaundry.api.review.AlertProposalService.Vote(
            UUID.randomUUID(),
            1,
            "REJECT".equals(outcome) ? "REJECT" : "ACCEPT",
            Map.of(source, 0L),
            "두 번째 담당자 확인");
    if (outcome.startsWith("STALE")) {
      assertThatThrownBy(() -> proposals().vote(proposal, other, lastVote))
          .isInstanceOf(ApiException.class);
      assertThat(
              jdbc.queryForObject(
                  "select status from review.alert_change_proposals where proposal_id=?",
                  String.class,
                  proposal))
          .isEqualTo("SUPERSEDED");
    } else {
      assertThat(proposals().vote(proposal, other, lastVote))
          .containsEntry("status", "ACCEPT".equals(outcome) ? "ACCEPTED" : "REJECTED");
    }
    assertThat(alerts.detail(alert, null).get("version"))
        .isEqualTo("ACCEPT".equals(outcome) ? 2 : 1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where action='MERGED'", Integer.class))
        .isEqualTo("ACCEPT".equals(outcome) ? 1 : 0);
    if (Set.of("REJECT", "STALE_CASE").contains(outcome)) {
      var repeated = nextPreparedContext();
      publish(repeated, executor("worker/analysis_entry.py").prepare(repeated).artifact());
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from review.alert_change_proposals", Integer.class))
          .isEqualTo(1);
      if ("REJECT".equals(outcome)) {
        assertThat(
                jdbc.queryForObject(
                    "select status from review.alert_change_proposals where proposal_id=?",
                    String.class,
                    proposal))
            .isEqualTo("REJECTED");
      } else {
        assertThat(
                jdbc.queryForMap(
                    "select status,generation from review.alert_change_proposals where proposal_id=?",
                    proposal))
            .containsEntry("status", "OPEN")
            .containsEntry("generation", 2);
        assertThat(
                jdbc.queryForObject(
                    "select count(*) from review.alert_proposal_cases where proposal_id=? and response='PENDING'",
                    Integer.class,
                    proposal))
            .isEqualTo(2);
        assertThat(
                jdbc.queryForObject(
                    "select count(*) from review.events where action='PROPOSAL_SUPERSEDED' and snapshot ? 'votes'",
                    Integer.class))
            .isPositive();
        assertThat(
                jdbc.queryForObject(
                    "select v.run_id from review.alert_change_proposals p join review.alert_versions v on v.alert_id=p.target_alert_id and v.version=p.proposed_version where proposal_id=?",
                    UUID.class,
                    proposal))
            .isEqualTo(repeated.runId());
        assertThat(
                proposals()
                    .vote(
                        proposal,
                        owner,
                        new com.moneylaundry.api.review.AlertProposalService.Vote(
                            UUID.randomUUID(), 3, "ACCEPT", Map.of(alert, revision), "새 제안 확인")))
            .containsEntry("status", "OPEN");
        assertThat(
                proposals()
                    .vote(
                        proposal,
                        other,
                        new com.moneylaundry.api.review.AlertProposalService.Vote(
                            UUID.randomUUID(), 4, "ACCEPT", Map.of(source, 1L), "새 제안 동의")))
            .containsEntry("status", "ACCEPTED");
        assertThat(alerts.detail(alert, null).get("version")).isEqualTo(3);
        assertThat(alerts.versions(alert)).hasSize(2);
      }
    }
  }

  @Test
  void staff_change_between_preparation_and_publication_rejects_entire_plan() {
    long alert = firstAlert();
    contextOn("2022-09-03");
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    jdbc.update(
        "update review.alerts set review_started_at=now(),review_started_by=assignee_id,revision=revision+1 where alert_id=?",
        alert);
    assertThatThrownBy(() -> publish(context, artifact))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("ALERT_BASELINE_CHANGED");
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.alert_change_proposals", Integer.class))
        .isZero();
  }

  @Test
  void changed_report_manifest_rejects_automatic_addition_before_any_publication() {
    long alert = firstAlert();
    contextOn("2022-09-03");
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    jdbc.update(
        "update ingest.report_sets set generation=generation+1 where business_date='2022-09-03'");
    assertThatThrownBy(() -> publish(context, artifact))
        .isInstanceOfSatisfying(
            AnalysisFailure.class,
            e -> {
              assertThat(e.code()).isEqualTo("STALE_INPUT");
              assertThat(e.kind()).isEqualTo(AnalysisFailure.Kind.PERMANENT);
            });
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where action='ADDED_EVIDENCE'", Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.alert_plans where run_id=?",
                Integer.class,
                context.runId()))
        .isGreaterThan(0);
  }

  @Test
  void cancelled_execution_cannot_publish_a_prepared_automatic_addition() {
    long alert = firstAlert();
    contextOn("2022-09-03");
    var context = nextPreparedContext();
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    jdbc.update(
        "update analysis.jobs set execution_id=? where job_id=?",
        UUID.randomUUID(),
        context.jobId());
    assertThatThrownBy(() -> publish(context, artifact))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("ALERT_PLAN_FENCED");
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where action='ADDED_EVIDENCE'", Integer.class))
        .isZero();
  }
}
