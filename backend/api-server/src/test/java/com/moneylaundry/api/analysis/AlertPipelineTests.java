package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.freeze.AlertInputSnapshot;
import com.moneylaundry.api.analysis.worker.PythonAnalysisExecutor;
import com.moneylaundry.api.common.ApiException;
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
  @Autowired org.springframework.transaction.support.TransactionTemplate tx;
  @Autowired AlertQueryService alerts;
  long target;
  long account;
  long receiver;
  // block-pin-1 never publishes a lone seed: the fixture Alert is the PASS pair
  // account -> receiver (target) followed by receiver -> account (returnSeed).
  long returnSeed;

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
            "insert into core.accounts(bank_id,owner_id) select bank_id,owner_id from core.accounts where account_id=? returning account_id",
            Long.class,
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
    returnSeed = transfer("2022-09-02 23:40+09", "2022-09-02", receiver, account, 1);
    attach(returnSeed, target);
    runs.snapshot(run, returnSeed, "TARGET");

    tx.executeWithoutResult(s -> snapshot.freeze(run, Instant.parse("2022-09-03T00:00:00Z")));
    score(target, run);
    score(returnSeed, run);
  }

  long transfer(String at, String day, long from, long to, int amount) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(?::timestamptz,?,?,?,'USD',?,'USD','ACH',?,'test',?::date) returning tx_id",
        Long.class,
        at,
        from,
        to,
        amount,
        amount,
        amount,
        day);
  }

  /** Puts txId into the loaded file that already carries sameFileAs. */
  void attach(long txId, long sameFileAs) {
    jdbc.update(
        "update ledger.transactions set upload_id=(select upload_id from ledger.transactions where tx_id=?) where tx_id=?",
        sameFileAs,
        txId);
  }

  void score(long txId, UUID scoreRun) {
    jdbc.update(
        "insert into analysis.scores(type_class,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,run_id) values(0,?,.9,1,0,0,0,0,0,0,0,0,?)",
        txId,
        scoreRun);
  }

  /** Makes a frozen transaction of the prepared run a scored seed. */
  void promote(AnalysisStageExecutor.Context context, long txId) {
    // CONTEXT now lives in the shared ledger, so the promoted row becomes this run's own TARGET.
    jdbc.update(
        """
        insert into analysis.input_transactions
        select run_id,tx_id,'TARGET',occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,
          to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,
          payment_currency,payment_format,amount_usd,fx_rate_version
        from analysis.run_inputs where run_id=? and tx_id=?
        on conflict(run_id,tx_id) do update set input_role='TARGET'
        """,
        context.runId(),
        txId);
    score(txId, context.runId());
  }

  /** A next-day seed account -> receiver that continues the fixture flow as PASS at account. */
  long seedOn(String day) {
    long id = transfer(day + " 10:00+09", day, account, receiver, 1);
    report(id, day, "2022-09-03 01:00+09");
    return id;
  }

  void report(long txId, String day, String received) {
    long upload =
        jdbc.queryForObject(
            """
            with existing as (select upload_id from ingest.uploads where business_date=?::date and status='COMPLETED'),
            added as (insert into ingest.uploads(file_name,file_hash,size_bytes,status,business_date,received_at)
              select 'fixture.csv',repeat('a',64),1,'COMPLETED',?::date,?::timestamptz
              where not exists(select 1 from existing) returning upload_id)
            select upload_id from existing union all select upload_id from added
            """,
            Long.class,
            day,
            day,
            received);
    jdbc.update(
        "update ingest.uploads set received_at=?::timestamptz where upload_id=?", received, upload);
    jdbc.update("update ledger.transactions set upload_id=? where tx_id=?", upload, txId);
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
    tx.executeWithoutResult(s -> snapshot.freeze(checking, Instant.parse("2022-09-04T00:00:00Z")));
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
    long nearby = contextOn("2022-08-31");
    long future = contextOn("2022-09-05");
    UUID checking = freezeCheck();
    var ids =
        jdbc.queryForList(
            "select tx_id from analysis.run_inputs where run_id=?", Long.class, checking);
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
    // A file dated and received after the check's cutoff is not part of its input.
    jdbc.update(
        "insert into ingest.uploads(file_name,file_hash,size_bytes,status,business_date,received_at) values('future.csv',repeat('b',64),1,'COMPLETED','2030-01-01','2030-01-01 09:00+09')");
    UUID checking = freezeCheck();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_alert_origins where run_id=?",
                Integer.class,
                checking))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.source_manifest m join ingest.uploads u using(upload_id) where m.run_id=? and u.business_date='2030-01-01'",
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
  void actual_freeze_empty_targets_rechecks_next_day_without_a_new_version() {
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
                  "select count(*) from analysis.run_inputs where run_id=? and tx_id=?",
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
    // A non-seed transaction is context, never a member: no new seed, no new version.
    assertThat(alerts.versions(alert)).hasSize(1);
    assertThat(alerts.detail(alert, null).get("transactions")).isEqualTo(old.get("transactions"));
    assertThat(alerts.detail(alert, null)).doesNotContainKey("forwardComplete");
    assertThat(alerts.detail(alert, null).get("dataAsOf")).isEqualTo("2022-09-03T00:00:00Z");
    assertThat(alerts.detail(alert, null).get("lastCheckedAt"))
        .isNotNull()
        .isNotEqualTo(old.get("lastCheckedAt"));
    assertThat(alerts.list(0, 20, null, null, follow).get("totalElements")).isEqualTo(0L);
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
                "select alert_id from analysis.run_alert_origins where run_id=?",
                Long.class,
                pending))
        .containsExactlyInAnyOrder(parent, child);
    jdbc.update(
        "insert into review.alert_versions select ?,2,?,fingerprint,evidence,now(),null from review.alert_versions where alert_id=? and version=1",
        parent,
        pending,
        parent);
    assertThat(alerts.detail(parent, null).get("version")).isEqualTo(1);
    assertThat(alerts.versions(parent)).hasSize(1);
    assertThatThrownBy(() -> alerts.detail(parent, 2)).isInstanceOf(ApiException.class);
    assertThat(alerts.detail(parent, null).get("transactions")).isEqualTo(old.get("transactions"));
    assertThat(alerts.versions(parent)).hasSize(1);
  }

  @Test
  void completed_only_visibility_hides_prepared_evidence() {
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
  }

  @Test
  void unassigned_historical_seed_is_revisited_without_target_or_existing_alert() {
    jdbc.update("delete from analysis.scores where run_id=? and tx_id=?", run, returnSeed);
    jdbc.update(
        "delete from analysis.input_transactions where run_id=? and tx_id=?", run, returnSeed);
    jdbc.update("delete from analysis.input_ledger where tx_id=?", returnSeed);
    jdbc.update("delete from analysis.target_ownership where tx_id=?", returnSeed);
    jdbc.update("delete from ledger.transactions where tx_id=?", returnSeed);
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("COMPLETED");
    }
    assertThat(jdbc.queryForObject("select count(*) from review.alert_versions", Integer.class))
        .isZero();
    // The lone target closes a cycle account -> receiver -> middle -> account the next day
    // (single-seed shape), without any new scored target.
    long middle =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,owner_id) select bank_id,owner_id from core.accounts where account_id=? returning account_id",
            Long.class,
            account);
    long connecting = transfer("2022-09-03 00:10+09", "2022-09-03", receiver, middle, 1);
    report(connecting, "2022-09-03", "2022-09-03 01:00+09");
    long closing = transfer("2022-09-03 00:20+09", "2022-09-03", middle, account, 1);
    attach(closing, connecting);
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
                  "select count(*) from analysis.run_alert_origins where run_id=?",
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
          .containsExactly(target, connecting, closing);
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
          AnalysisRunService.ingestLock(jdbc);
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          new com.moneylaundry.api.analysis.publish.AlertPublisher(jdbc)
              .publish(context.runId(), context.executionId(), artifact);
          runs.complete(context.runId());
          jdbc.update(
              "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE' where job_id=?",
              context.jobId());
        });
  }

  @Test
  void star_beyond_core_cap_publishes_linked_alerts_and_replay_preserves_ownership() {
    // 99 more seeds fan out of account to distinct receivers: one star face whose
    // pieces cannot fit one core of 64, so it becomes several Alerts joined by links.
    for (int i = 1; i <= 99; i++) {
      long spokeReceiver =
          jdbc.queryForObject(
              "insert into core.accounts(bank_id,owner_id) select bank_id,owner_id from core.accounts where account_id=? returning account_id",
              Long.class,
              account);
      long spoke =
          transfer(
              Instant.parse("2022-09-02T12:00:00Z").plusSeconds(60L * i).toString(),
              "2022-09-02",
              account,
              spokeReceiver,
              1);
      attach(spoke, target);
      runs.snapshot(run, spoke, "TARGET");
      score(spoke, run);
    }
    try (var runner = new AnalysisRunner(service, executor("worker/analysis_entry.py"), runs)) {
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("COMPLETED");
    }
    var ids = jdbc.queryForList("select alert_id from review.alerts order by alert_id", Long.class);
    assertThat(ids).hasSizeGreaterThan(1);
    var ownership =
        jdbc.queryForList(
            """
        select t.tx_id,t.alert_id from review.alert_transactions t join review.alerts a using(alert_id)
        where t.version=a.published_version and t.role='SEED' order by t.tx_id
        """);
    assertThat(ownership.stream().map(row -> row.get("tx_id")).distinct().count())
        .isEqualTo(ownership.size());
    var linked = new TreeSet<Long>();
    for (long id : ids) {
      var seeds =
          jdbc.queryForList(
              "select t.tx_id from review.alert_transactions t join review.alerts a using(alert_id) where a.alert_id=? and t.version=a.published_version and t.role='SEED'",
              Long.class,
              id);
      for (var flow : (List<Map<String, Object>>) alerts.detail(id, null).get("relatedFlows")) {
        // A link holds one seed of each side.
        assertThat((List<?>) flow.get("txIds"))
            .anySatisfy(key -> assertThat(seeds).contains(((Number) key).longValue()));
        for (Object other : (List<?>) flow.get("relatedAlertIds"))
          linked.add(((Number) other).longValue());
      }
    }
    assertThat(linked).isNotEmpty();
    var repeated = nextPreparedContext();
    publish(repeated, executor("worker/analysis_entry.py").prepare(repeated).artifact());
    assertThat(jdbc.queryForObject("select count(*) from review.alert_versions", Integer.class))
        .isEqualTo(ids.size());
    assertThat(
            jdbc.queryForList("select alert_id from review.alerts order by alert_id", Long.class))
        .isEqualTo(ids);
    assertThat(
            jdbc.queryForList(
                """
        select t.tx_id,t.alert_id from review.alert_transactions t join review.alerts a using(alert_id)
        where t.version=a.published_version and t.role='SEED' order by t.tx_id
        """))
        .isEqualTo(ownership);
    assertThat(
            jdbc.queryForObject(
                """
        select max(n) from (select count(*) n from review.alert_transactions t join review.alerts a using(alert_id)
        where t.version=a.published_version and t.role<>'CONTEXT' group by t.alert_id) counts
        """,
                Integer.class))
        .isLessThanOrEqualTo(64);
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
                      new com.moneylaundry.api.analysis.publish.AlertPublisher(jdbc)
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
  void investigated_merge_is_published_at_once_keeps_staff_edits_and_notifies_both_owners() {
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
            "insert into review.alerts(assignee_id,created_at,assigned_at,review_started_at,review_started_by) values(?,now()+interval '1 hour',now(),now(),?) returning alert_id",
            Long.class,
            other,
            other);
    jdbc.update(
        "insert into review.alert_versions select ?,1,run_id,fingerprint,evidence,now(),now() from review.alert_versions where alert_id=? and version=1",
        source,
        alert);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", source);
    // 사라지는 Alert에서 직원이 뺀 거래는 남는 Alert에서도 빠진 채로 유지된다.
    jdbc.update(
        "insert into review.alert_tx_edits(alert_id,tx_id,reason,editor_id,edited_at) values(?,?,'무관',?,now())",
        source,
        returnSeed,
        other);
    contextOn("2022-09-03");
    var context = nextPreparedContext();
    publish(context, executor("worker/analysis_entry.py").prepare(context).artifact());
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "select merged_into_alert_id from review.alerts where alert_id=?",
                Long.class,
                source))
        .isEqualTo(alert);
    assertThat(
            jdbc.queryForObject(
                "select alert_id from review.alert_tx_edits where tx_id=?", Long.class, returnSeed))
        .isEqualTo(alert);
    assertThat(
            jdbc.queryForObject(
                "select state from review.current_members where case_id=? and tx_id=?",
                String.class,
                alert,
                returnSeed))
        .isEqualTo("EXCLUDED");
    assertThat(
            jdbc.queryForList(
                "select user_id from review.notifications where kind='MERGED' order by user_id",
                Long.class))
        .containsExactlyInAnyOrder(owner, other);
    var repeat = nextPreparedContext();
    publish(repeat, executor("worker/analysis_entry.py").prepare(repeat).artifact());
    assertThat(alerts.versions(alert)).hasSize(2);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where action='MERGED'", Integer.class))
        .isEqualTo(1);
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
    jdbc.update(
        "insert into review.alert_tx_edits(alert_id,tx_id,reason,editor_id,edited_at) values(?,?,'무관',?,now())",
        alert,
        returnSeed,
        owner);
    long added = seedOn("2022-09-03");
    var context = nextPreparedContext();
    promote(context, added);
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    publish(context, artifact);
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "select state from review.current_members where case_id=? and tx_id=?",
                String.class,
                alert,
                returnSeed))
        .isEqualTo("EXCLUDED");
    assertThat(
            jdbc.queryForMap(
                "select state,decision,evidence_version from review.current_members where case_id=? and tx_id=?",
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
    long newSeed = seedOn("2022-09-03");
    var added = nextPreparedContext();
    promote(added, newSeed);
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
  void staff_change_between_preparation_and_publication_rejects_entire_plan() {
    long alert = firstAlert();
    long added = seedOn("2022-09-03");
    var context = nextPreparedContext();
    promote(context, added);
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    jdbc.update(
        "update review.alerts set review_started_at=now(),review_started_by=assignee_id,revision=revision+1 where alert_id=?",
        alert);
    assertThatThrownBy(() -> publish(context, artifact))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("ALERT_BASELINE_CHANGED");
    assertThat(alerts.detail(alert, null).get("version")).isEqualTo(1);
  }

  @Test
  void changed_file_manifest_rejects_automatic_addition_before_any_publication() {
    long alert = firstAlert();
    long added = seedOn("2022-09-03");
    var context = nextPreparedContext();
    promote(context, added);
    String artifact = executor("worker/analysis_entry.py").prepare(context).artifact();
    // A file received before the run's cutoff appears after the freeze: the input is stale.
    jdbc.update(
        "insert into ingest.uploads(file_name,file_hash,size_bytes,status,business_date,received_at) values('late.csv',repeat('c',64),1,'COMPLETED','2022-08-01','2022-09-03 12:00+09')");
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
  void detail_reports_growth_deadline_and_current_context_count() {
    long alert = firstAlert();
    var first = (Map<?, ?>) alerts.detail(alert, null).get("summary");
    // The core starts at 2022-09-02 23:30 KST; the block stops growing 336 hours later.
    assertThat(first.get("sealedAfter")).isEqualTo("2022-09-16T14:30:00Z");
    // A two-leg PASS has no fan centre, so the context query has no focal account.
    assertThat(first.get("contextCount")).isEqualTo(0L);

    long added = seedOn("2022-09-03");
    var context = nextPreparedContext();
    promote(context, added);
    publish(context, executor("worker/analysis_entry.py").prepare(context).artifact());
    var detail = alerts.detail(alert, null);
    assertThat(detail.get("version")).isEqualTo(2);
    // account now sends twice and receiver receives twice inside the core.
    var query = (Map<?, ?>) detail.get("contextQuery");
    assertThat(
            ((List<?>) query.get("focalAccounts"))
                .stream().map(f -> ((Map<?, ?>) f).get("accountId").toString()).toList())
        .containsExactlyInAnyOrderElementsOf(
            jdbc.queryForList(
                "select service_account_id::text from core.accounts where account_id in (?,?)",
                String.class,
                account,
                receiver));
    assertThat(query.get("firstAt")).isEqualTo("2022-09-01T14:30:00+00:00");
    assertThat(query.get("lastAt")).isEqualTo("2022-09-04T01:00:00+00:00");

    // Context is read from the current ledger: only rows of a focal account inside the window
    // and outside the core count, without a new evidence version.
    transfer("2022-09-03 12:00+09", "2022-09-03", receiver, account, 5);
    transfer("2022-09-05 12:00+09", "2022-09-05", account, receiver, 5);
    var summary = (Map<?, ?>) alerts.detail(alert, null).get("summary");
    assertThat(summary.get("contextCount")).isEqualTo(1L);
    assertThat(summary.get("sealedAfter")).isEqualTo("2022-09-16T14:30:00Z");
    assertThat(alerts.versions(alert)).hasSize(2);
    // The list keeps its documented summary fields only.
    var listed = (List<Map<String, Object>>) alerts.list(0, 20, null, null, null).get("content");
    assertThat(
            ((Map<?, ?>) listed.getFirst().get("summary"))
                .keySet().stream().map(Object::toString).toList())
        .doesNotContain("contextCount", "sealedAfter");
  }

  @Test
  void cancelled_execution_cannot_publish_a_prepared_automatic_addition() {
    long alert = firstAlert();
    long added = seedOn("2022-09-03");
    var context = nextPreparedContext();
    promote(context, added);
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
