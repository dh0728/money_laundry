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
            .isEqualTo(2);
      }
      assertThat(
              jdbc.queryForList(
                  "select phase from analysis_model_tasks where run_id=? order by model_kind",
                  String.class,
                  run))
          .containsExactly("PUBLISH", "PUBLISH");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transaction_features where run_id=? and features->>'demo_value'=(tx_id%100)::text",
                  Integer.class, run))
          .isEqualTo(2);
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
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_model_tasks where run_id=? and status='CANCELLED' and execution_id is null",
                Integer.class,
                run))
        .isEqualTo(2);
  }

  @Test
  void retry_reuses_prepared_models_without_rewriting_feature_rows() {
    var executor = executor("worker/analysis_entry.py");
    var first = executor.prepare(claim());
    var before =
        jdbc.queryForList(
            "select input_artifact::text,operation_attempts from analysis_model_tasks where run_id=? order by model_kind",
            run);
    var second = executor.prepare(claim());
    assertThat(second.artifact()).isEqualTo(first.artifact());
    assertThat(
            jdbc.queryForList(
                "select input_artifact::text,operation_attempts from analysis_model_tasks where run_id=? order by model_kind",
                run))
        .isEqualTo(before);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transaction_features where run_id=?", Integer.class, run))
        .isEqualTo(2);
  }

  @Test
  void type_failure_preserves_binary_and_next_parent_execution_recovers() throws Exception {
    Path failType = storage.resolve("fail_type.py");
    Files.writeString(
        failType,
        """
        import sys
        sys.path.insert(0, %s)
        import pipeline
        from worker_transport import ProtocolError
        original = pipeline.write_demo_input
        calls = 0
        def fail_type(source, output):
            global calls
            calls += 1
            if calls == 2:
                raise ProtocolError('injected second model failure')
            return original(source, output)
        pipeline.write_demo_input = fail_type
        from analysis_entry import main
        raise SystemExit(main())
        """
            .formatted(
                "'" + Path.of("worker").toAbsolutePath().toString().replace("\\", "/") + "'"));
    assertThatThrownBy(() -> executor(failType.toString()).prepare(claim()))
        .isInstanceOf(AnalysisFailure.class);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transaction_features where run_id=? and model_kind='BINARY'",
                Integer.class,
                run))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_run_stage_results where run_id=? and stage='FEATURES'",
                Integer.class,
                run))
        .isZero();
    var binary =
        jdbc.queryForObject(
            "select input_artifact::text from analysis_model_tasks where run_id=? and model_kind='BINARY'",
            String.class,
            run);
    executor("worker/analysis_entry.py").prepare(claim());
    assertThat(
            jdbc.queryForObject(
                "select input_artifact::text from analysis_model_tasks where run_id=? and model_kind='BINARY'",
                String.class,
                run))
        .isEqualTo(binary);
    assertThat(
            jdbc.queryForList(
                "select operation_attempts from analysis_model_tasks where run_id=? order by model_kind",
                Integer.class,
                run))
        .containsExactly(1, 2);
  }

  @Test
  void missing_prepared_file_is_rejected_without_recalculating() throws Exception {
    var executor = executor("worker/analysis_entry.py");
    executor.prepare(claim());
    String path =
        jdbc.queryForObject(
            "select input_artifact->>'path' from analysis_model_tasks where run_id=? and model_kind='BINARY'",
            String.class,
            run);
    Files.delete(storage.resolve("worker").resolve(path));
    assertThatThrownBy(() -> executor.prepare(claim()))
        .isInstanceOfSatisfying(
            AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("WORKER_INPUT_INVALID"));
  }

  @Test
  void feature_insert_failure_rolls_back_artifact_and_parent_checkpoint() {
    jdbc.execute(
        """
        create function reject_test_features() returns trigger language plpgsql as $$
        begin raise exception 'injected feature storage failure'; end $$
        """);
    jdbc.execute(
        "create trigger reject_test_features before insert on transaction_features for each row execute function reject_test_features()");
    try {
      assertThatThrownBy(() -> executor("worker/analysis_entry.py").prepare(claim()))
          .isInstanceOfSatisfying(
              AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("DB_UNAVAILABLE"));
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transaction_features where run_id=?", Integer.class, run))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_model_tasks where run_id=? and input_artifact is not null",
                  Integer.class,
                  run))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_run_stage_results where run_id=?",
                  Integer.class,
                  run))
          .isZero();
    } finally {
      jdbc.execute("drop trigger reject_test_features on transaction_features");
      jdbc.execute("drop function reject_test_features()");
    }
    executor("worker/analysis_entry.py").prepare(claim());
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transaction_features where run_id=?", Integer.class, run))
        .isEqualTo(2);
  }

  @Test
  void abandoned_model_token_is_replaced_and_changed_binding_is_rejected() throws Exception {
    var context = claim();
    Path abandon = storage.resolve("abandon.py");
    Files.writeString(
        abandon,
        """
        import sys
        sys.path.insert(0, %s)
        import pipeline
        def abandon(*args):
            raise SystemExit(74)
        pipeline.write_demo_input = abandon
        from analysis_entry import main
        raise SystemExit(main())
        """
            .formatted(
                "'" + Path.of("worker").toAbsolutePath().toString().replace("\\", "/") + "'"));
    assertThatThrownBy(() -> executor(abandon.toString()).prepare(context))
        .isInstanceOf(AnalysisFailure.class);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_model_tasks where run_id=? and model_kind='BINARY'",
                String.class,
                run))
        .isEqualTo("ACTIVE");
    assertThatThrownBy(() -> executor("worker/analysis_entry.py").prepare(context))
        .isInstanceOfSatisfying(
            AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("RUN_FENCED"));
    executor("worker/analysis_entry.py").prepare(claim());
    assertThat(
            jdbc.queryForObject(
                "select operation_attempts from analysis_model_tasks where run_id=? and model_kind='BINARY'",
                Integer.class,
                run))
        .isEqualTo(2);
    jdbc.update(
        "update analysis_model_tasks set binding=jsonb_set(binding,'{model_version}','\"changed\"') where run_id=? and model_kind='TYPE'",
        run);
    assertThatThrownBy(() -> executor("worker/analysis_entry.py").prepare(claim()))
        .isInstanceOfSatisfying(
            AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("WORKER_INPUT_INVALID"));
  }

  @Test
  void runner_automatically_publishes_and_polls_without_recording_wait_as_failure()
      throws Exception {
    Path script = storage.resolve("remote_double.py");
    Files.writeString(
        script,
        """
        import sys, os, json
        sys.path.insert(0, %s)
        import httpx, psycopg
        import model_publication, inference_dispatch
        from test_frozen_input_postgres import MemoryS3
        settings = model_publication.Settings('https://inference.example','x'*32,'test','dev/test/','ap-northeast-2')
        os.environ.update(INFERENCE_API_URL=settings.api_url,INFERENCE_API_TOKEN=settings.token,S3_BUCKET=settings.bucket)
        model_publication.configured = lambda: (settings, MemoryS3())
        def remote(request):
            if request.method == 'PUT':
                body = json.loads(request.content)
            else:
                request_id = request.url.path.split('/')[-3]
                with psycopg.connect(os.environ['WORKER_DB_URL'],user=os.environ['WORKER_DB_USER'],password=os.environ['WORKER_DB_PASSWORD']) as db:
                    run,kind,job = db.execute('select m.run_id,m.model_kind,r.job_id from analysis_model_requests m join analysis_runs r using(run_id) where request_id=%%s',(request_id,)).fetchone()
                body = dict(contract_version=2,job_id=job,run_id=str(run),model_kind=kind,request_id=request_id,execution_round=1)
            return httpx.Response(202 if request.method=='PUT' else 200,json={**body,'status':'RUNNING','revision':1})
        advance = inference_dispatch.advance
        inference_dispatch.advance = lambda *args: advance(*args, transport=httpx.MockTransport(remote))
        from analysis_entry import main
        raise SystemExit(main())
        """
            .formatted(
                "'" + Path.of("worker").toAbsolutePath().toString().replace("\\", "/") + "'"));
    try (var runner = new AnalysisRunner(service, executor(script.toString()), runs, integration)) {
      runner.scan();
      runner.scan();
      assertThat(service.job(job).stage()).isEqualTo(AnalysisStage.INFERENCE);
      assertThat(service.job(job).status()).isEqualTo("RETRY_WAIT");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_model_tasks where run_id=? and phase='WAIT_REMOTE' and status='WAITING'",
                  Integer.class,
                  run))
          .isEqualTo(2);
      jdbc.update("update batch_jobs set retry_at=now()-interval '1 second' where job_id=?", job);
      runner.scan();
      assertThat(service.job(job).status()).isEqualTo("RETRY_WAIT");
      assertThat(service.job(job).failures()).isZero();
      var models = (List<?>) service.detail(job).get("models");
      assertThat(models).hasSize(2);
      assertThat(models.toString())
          .contains("remoteStatus=RUNNING")
          .doesNotContain("https://", "input_artifact", "signature");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_failures where job_id=?", Integer.class, job))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_model_tasks where run_id=? and remote_snapshot->>'status'='RUNNING'",
                  Integer.class,
                  run))
          .isEqualTo(2);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_run_stage_results where run_id=? and stage='INFERENCE'",
                  Integer.class,
                  run))
          .isZero();
      runs.cancel(run, "REPORT_CORRECTED");
      runner.scan();
      assertThat(service.job(job).error()).isEqualTo("RUN_CANCELLED");
    }
  }

  @Test
  void invalid_collected_scores_expose_the_documented_failure_code() throws Exception {
    var features = claim();
    executor("worker/analysis_entry.py").prepare(features);
    jdbc.update("update batch_jobs set current_stage='INFERENCE' where job_id=?", job);
    jdbc.update(
        "update analysis_model_tasks set phase='COLLECT',status='FAILED',error_code='RESULT_INVALID' where run_id=? and model_kind='BINARY'",
        run);
    Path failed = storage.resolve("failed_collection.py");
    Files.writeString(failed, "raise SystemExit(77)\n");
    var context =
        new AnalysisStageExecutor.Context(
            job, AnalysisStage.INFERENCE, features.executionId(), List.of(), Map.of(), run);
    assertThatThrownBy(() -> executor(failed.toString()).prepare(context))
        .isInstanceOfSatisfying(
            AnalysisFailure.class, e -> assertThat(e.code()).isEqualTo("SCORES_MISMATCH"));
    jdbc.update("update batch_jobs set status='FAILED' where job_id=?", job);
    service.resume(job);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_model_tasks where run_id=? and model_kind='BINARY'",
                String.class,
                run))
        .isEqualTo("READY");
  }

  @Test
  void runner_collects_real_parquet_and_persists_scores_before_alerts() throws Exception {
    Path script = storage.resolve("completed_remote_double.py");
    Files.writeString(
        script,
        """
        import sys, os, json, io
        sys.path.insert(0, %s)
        import httpx, psycopg, pyarrow.parquet as pq
        import model_publication, inference_dispatch
        from test_frozen_input_postgres import MemoryS3
        from demo_calculator import build_targets, calculate
        from worker_transport import Request, descriptor
        settings = model_publication.Settings('https://inference.example','x'*32,'test','dev/test/','ap-northeast-2')
        os.environ.update(INFERENCE_API_URL=settings.api_url,INFERENCE_API_TOKEN=settings.token,S3_BUCKET=settings.bucket)
        def result(request_id):
            with psycopg.connect(os.environ['WORKER_DB_URL'],user=os.environ['WORKER_DB_USER'],password=os.environ['WORKER_DB_PASSWORD']) as db:
                run,kind,job,binding = db.execute('select m.run_id,m.model_kind,r.job_id,t.binding from analysis_model_requests m join analysis_runs r using(run_id) join analysis_model_tasks t using(run_id,model_kind) where m.request_id=%%s',(request_id,)).fetchone()
                ids = [r[0] for r in db.execute("select tx_id from analysis.input_transactions where run_id=%%s and input_role='TARGET'",(run,))]
            req = Request(job,kind.lower(),request_id,1,binding['model_version'],binding['feature_version'],str(run))
            stream = io.BytesIO()
            pq.write_table(calculate(build_targets(ids),req.model_kind,model_version=req.model_version,feature_version=req.feature_version),stream)
            data = stream.getvalue()
            metadata = dict(req.identity(),**req.versions(),status='COMPLETED',row_count=len(ids),files=[descriptor('scores','dev/test/'+req.output+'scores.parquet',data)])
            return req, metadata, data
        class Results(MemoryS3):
            def get_object(self, **args):
                if args['Key'].endswith('/scores.parquet'):
                    request_id = args['Key'].split('/')[-4]
                    return {'Body':io.BytesIO(result(request_id)[2])}
                return super().get_object(**args)
        model_publication.configured = lambda: (settings, Results())
        def remote(request):
            if request.method == 'PUT':
                return httpx.Response(202,json={**json.loads(request.content),'status':'QUEUED','revision':1})
            req,metadata,data = result(request.url.path.split('/')[-3])
            return httpx.Response(200,json={**req.identity(),'status':'COMPLETED','revision':2,'result':metadata})
        advance = inference_dispatch.advance
        inference_dispatch.advance = lambda *args: advance(*args, transport=httpx.MockTransport(remote))
        from analysis_entry import main
        raise SystemExit(main())
        """
            .formatted(
                "'" + Path.of("worker").toAbsolutePath().toString().replace("\\", "/") + "'"));
    jdbc.update("update batch_jobs set threshold_value=0.5 where job_id=?", job);
    try (var runner = new AnalysisRunner(service, executor(script.toString()), runs, integration)) {
      runner.scan(); // FEATURES
      runner.scan(); // PUBLISH
      jdbc.update("update batch_jobs set retry_at=now()-interval '1 second' where job_id=?", job);
      runner.scan(); // GET + COLLECT
      assertThat(service.job(job).stage()).isEqualTo(AnalysisStage.SCORES);
      assertThat(service.job(job).status()).isEqualTo("QUEUED");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_model_tasks where run_id=? and status='SUCCEEDED'",
                  Integer.class,
                  run))
          .isEqualTo(2);
      runner.scan(); // SCORES
      assertThat(service.job(job).stage()).isEqualTo(AnalysisStage.ALERTS);
      assertThat(service.job(job).status()).isEqualTo("QUEUED");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from inference_results where run_id=? and score_pct=0",
                  Integer.class,
                  run))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transactions where scored_job_id=?", Integer.class, job))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject(
                  "select completed from analysis_run_stage_results where run_id=? and stage='SCORES'",
                  Boolean.class,
                  run))
          .isTrue();
      runner.scan(); // ALERTS is not connected; do not claim whole-job completion.
      assertThat(service.job(job).status()).isEqualTo("FAILED");
      assertThat(service.job(job).error()).isEqualTo("PIPELINE_NOT_CONFIGURED");
      service.resume(job);
      assertThat(service.job(job).stage()).isEqualTo(AnalysisStage.ALERTS);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from inference_results where run_id=?", Integer.class, run))
          .isEqualTo(1);
    }
  }

  @Test
  void explicit_resume_resets_only_failed_local_publication() {
    executor("worker/analysis_entry.py").prepare(claim());
    jdbc.update(
        "update analysis_model_tasks set status='FAILED',action_required=true,consecutive_failures=3 where run_id=? and model_kind='BINARY'",
        run);
    jdbc.update(
        "update analysis_model_tasks set phase='COLLECT' where run_id=? and model_kind='TYPE'",
        run);
    jdbc.update(
        "update batch_jobs set status='FAILED',current_stage='INFERENCE',error_code='MODEL_TASK_FAILED' where job_id=?",
        job);
    service.resume(job);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_model_tasks where run_id=? and model_kind='BINARY'",
                String.class,
                run))
        .isEqualTo("READY");
    assertThat(
            jdbc.queryForObject(
                "select phase from analysis_model_tasks where run_id=? and model_kind='TYPE'",
                String.class,
                run))
        .isEqualTo("COLLECT");
    assertThat(service.job(job).status()).isEqualTo("QUEUED");
  }
}
