package com.moneylaundry.api.db;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.AnalysisRunService;
import com.moneylaundry.api.review.BusinessTime;
import com.moneylaundry.api.review.LedgerQueryService;
import com.moneylaundry.api.review.ReviewService;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/** The replacement baseline is tested in a fresh DB, never layered over V1-V17. */
class BaselineSchemaTests {
  static PostgreSQLContainer postgres;
  static JdbcTemplate jdbc;
  static TransactionTemplate tx;

  @BeforeAll
  static void start() {
    postgres = new PostgreSQLContainer("postgres:17-alpine");
    postgres.start();
    var source =
        new DriverManagerDataSource(
            postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    Flyway.configure().dataSource(source).locations("classpath:db/migration").load().migrate();
    jdbc = new JdbcTemplate(source);
    tx = new TransactionTemplate(new JdbcTransactionManager(source));
  }

  @AfterAll
  static void stop() {
    if (postgres != null) postgres.stop();
  }

  @BeforeEach
  void reset() {
    jdbc.execute("truncate core.users,core.banks,core.owners,analysis.jobs cascade");
  }

  long staff() {
    return jdbc.queryForObject(
        "insert into core.users(username,name,role) values(?,'Tester','STAFF') returning user_id",
        Long.class,
        UUID.randomUUID().toString());
  }

  @Test
  void real_python_ingest_publishes_encrypted_reports_and_separate_labels() throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    jdbc.update("insert into core.banks(bank_id,is_reporting) values(10,true)");
    jdbc.update(
        "insert into core.bank_reporting_periods(bank_id,effective_from_date) values(10,'2023-01-01')");
    byte[] source =
        ("Timestamp,From Bank,From Account,To Bank,To Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,From Bank Name,To Bank Name,From Entity ID,From Entity Name,To Entity ID,To Entity Name,Is Laundering\n"
                + "2023/09/01 09:00,10,001,20,002,100,US Dollar,100,US Dollar,ACH,Bank10,Bank20,E1,Alice,E2,Bob,1\n")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    long upload =
        jdbc.queryForObject(
            "insert into ingest.uploads(bank_id,business_date,status,file_name,file_hash,size_bytes,s3_key,received_at) values(10,'2023-09-01','RECEIVED','report.csv',? ,?,'fixture',now()) returning upload_id",
            Long.class,
            "a".repeat(64),
            source.length);
    var store = mock(com.moneylaundry.api.storage.UploadStore.class);
    when(store.open("fixture")).thenAnswer(invocation -> new java.io.ByteArrayInputStream(source));
    var database =
        new org.springframework.boot.jdbc.autoconfigure.JdbcConnectionDetails() {
          public String getJdbcUrl() {
            return postgres.getJdbcUrl();
          }

          public String getUsername() {
            return postgres.getUsername();
          }

          public String getPassword() {
            return postgres.getPassword();
          }
        };
    String encryption = java.util.Base64.getEncoder().encodeToString(new byte[32]);
    byte[] searchBytes = new byte[32];
    java.util.Arrays.fill(searchBytes, (byte) 1);
    String search = java.util.Base64.getEncoder().encodeToString(searchBytes);
    var loader =
        new com.moneylaundry.api.ingest.LedgerLoader(
            jdbc,
            store,
            database,
            python,
            "worker/analysis_entry.py",
            java.time.Duration.ofSeconds(30),
            encryption,
            search,
            "test",
            "Asia/Seoul");
    loader.load(upload);
    assertThat(
            jdbc.queryForObject(
                "select status from ingest.uploads where upload_id=?", String.class, upload))
        .isEqualTo("COMPLETED");
    var report = jdbc.queryForMap("select * from private.bank_reports");
    var protector =
        new com.moneylaundry.api.ingest.PrivateDataProtector(encryption, search, "test");
    String plain =
        protector.decrypt(
            "report:" + report.get("version_id") + ":" + report.get("source_row"),
            report.get("payload_cipher").toString(),
            "test");
    assertThat(plain).contains("Alice", "\"isLaundering\":null");
    assertThat(report.get("payload_cipher").toString()).doesNotContain("Alice", "001");
    assertThat(
            jdbc.queryForObject(
                "select is_laundering from evaluation.report_labels", Boolean.class))
        .isTrue();
    loader.load(upload);
    assertThat(jdbc.queryForObject("select count(*) from ingest.report_versions", Integer.class))
        .isEqualTo(1);
    jdbc.update("insert into core.fx_rates values('test','USD',1)");
    UUID token = UUID.randomUUID();
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage,execution_id,execution_owner) values('2023-09-02',now(),now(),.7,'RUNNING','INTEGRATE',?,?) returning job_id",
            Long.class,
            token,
            token);
    jdbc.update("insert into analysis.receipts values(?,?)", job, upload);
    var command =
        new ProcessBuilder(
            python,
            "-B",
            "worker/analysis_entry.py",
            "--job-id",
            Long.toString(job),
            "--stage",
            "INTEGRATE",
            "--execution-id",
            token.toString());
    command
        .environment()
        .putAll(
            java.util.Map.of(
                "WORKER_DB_URL",
                com.moneylaundry.api.analysis.PythonAnalysisExecutor.workerDatabaseUrl(
                    postgres.getJdbcUrl()),
                "WORKER_DB_USER",
                postgres.getUsername(),
                "WORKER_DB_PASSWORD",
                postgres.getPassword(),
                "INGEST_ENCRYPTION_KEY",
                encryption,
                "INGEST_SEARCH_KEY",
                search,
                "INGEST_KEY_VERSION",
                "test",
                "INGEST_FX_VERSION",
                "test"));
    var process = command.start();
    try {
      assertThat(process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      assertThat(process.exitValue()).isZero();
    } finally {
      if (process.isAlive()) process.destroyForcibly();
    }
    assertThat(jdbc.queryForObject("select count(*) from ledger.transactions", Integer.class))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from core.owners where display_name like '%#%'", Integer.class))
        .isEqualTo(2);
    assertThat(jdbc.queryForObject("select count(*) from private.owner_identities", Integer.class))
        .isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "select completed from analysis.stage_results where job_id=? and stage='INTEGRATE'",
                Boolean.class,
                job))
        .isTrue();
    var runs = new AnalysisRunService(jdbc, tx, Clock.systemUTC(), new ObjectMapper());
    UUID completed = runs.freeze(job, Instant.now());
    runs.complete(completed);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE',execution_id=null,execution_owner=null where job_id=?",
        job);
    long version = ((Number) report.get("version_id")).longValue();
    long correction =
        jdbc.queryForObject(
            "insert into ingest.correction_requests(bank_id,business_date,version_id,reason_code,source_revision) values(10,'2023-09-01',?,'TEST',1) returning correction_id",
            Long.class,
            version);
    byte[] changed =
        new String(source, java.nio.charset.StandardCharsets.UTF_8)
            .replace(",100,", ",110,")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    long replacement =
        jdbc.queryForObject(
            "insert into ingest.uploads(bank_id,business_date,status,file_name,file_hash,size_bytes,s3_key,received_at) values(10,'2023-09-01','RECEIVED','replacement.csv',?,?,'replacement',now()) returning upload_id",
            Long.class,
            "b".repeat(64),
            changed.length);
    jdbc.update(
        "insert into ingest.correction_uploads values(?,?,?)",
        replacement,
        correction,
        UUID.randomUUID());
    when(store.open("replacement"))
        .thenAnswer(invocation -> new java.io.ByteArrayInputStream(changed));
    loader.load(replacement);
    assertThat(
            jdbc.queryForObject(
                "select status from ingest.uploads where upload_id=?", String.class, replacement))
        .isEqualTo("COMPLETED");
    UUID secondToken = UUID.randomUUID();
    long next =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage,execution_id,execution_owner) values('2023-09-03',now(),now(),.7,'RUNNING','INTEGRATE',?,?) returning job_id",
            Long.class,
            secondToken,
            secondToken);
    jdbc.update("insert into analysis.receipts values(?,?)", next, replacement);
    command.command(
        python,
        "-B",
        "worker/analysis_entry.py",
        "--job-id",
        Long.toString(next),
        "--stage",
        "INTEGRATE",
        "--execution-id",
        secondToken.toString());
    var retry = command.start();
    try {
      assertThat(retry.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      assertThat(retry.exitValue()).isZero();
    } finally {
      if (retry.isAlive()) retry.destroyForcibly();
    }
    assertThat(
            jdbc.queryForObject(
                "select error_code from ingest.report_versions where upload_id=?",
                String.class,
                replacement))
        .isEqualTo("COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from ledger.transactions where integration_status='ACTIVE' and amount_paid=100",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void investigation_transfer_and_dissolution_preserve_relational_decisions() {
    long user = staff();
    jdbc.update("update core.users set password_hash='test' where user_id=?", user);
    jdbc.update("insert into core.banks(bank_id) values(9)");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'가명#1') returning owner_id",
            Long.class);
    UUID publicAccount = UUID.randomUUID();
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(service_account_id,bank_id,owner_id) values(?,9,?) returning account_id",
            Long.class,
            publicAccount,
            owner);
    long transaction =
        jdbc.queryForObject(
            """
        insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,
        amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
        values('2023-09-01Z','2023-09-01',?,?,1,'USD',1,'USD','ACH',1,'test') returning tx_id
        """,
            Long.class,
            account,
            account);
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-02',now(),now(),.7,'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
    var clock = mock(BusinessTime.class);
    when(clock.now()).thenReturn(Instant.parse("2023-09-02T00:00:00Z"));
    var evidence = mock(AlertQueryService.class);
    var service = new ReviewService(jdbc, tx, clock, evidence);
    var ids = new java.util.ArrayList<Long>();
    for (int n = 0; n < 2; n++) {
      long alert =
          jdbc.queryForObject(
              "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
              Long.class,
              user);
      ids.add(alert);
      jdbc.update(
          "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,'test','{}')",
          alert,
          run);
      jdbc.update(
          "insert into review.alert_transactions values(?,1,?,'SEED','[]')", alert, transaction);
      var row =
          java.util.Map.of(
              "txId",
              transaction,
              "role",
              "SEED",
              "occurredAt",
              "2023-09-01T00:00:00Z",
              "fromAccountId",
              publicAccount.toString(),
              "toAccountId",
              publicAccount.toString(),
              "scores",
              java.util.Map.of("p_laundering", .9, "p_1", .9));
      var fullRow = new java.util.HashMap<String, Object>(row);
      fullRow.putAll(
          java.util.Map.of(
              "paymentCurrency",
              "USD",
              "receivingCurrency",
              "USD",
              "paymentFormat",
              "ACH",
              "amountPaid",
              1,
              "amountReceived",
              1,
              "amountUsd",
              1));
      var doc =
          java.util.Map.<String, Object>of(
              "runId", run, "version", 1, "transactions", java.util.List.of(fullRow));
      jdbc.update(
          "update review.alert_versions set evidence=?::jsonb,published_at=now() where alert_id=? and version=1",
          new ObjectMapper().writeValueAsString(doc),
          alert);
      jdbc.update("update review.alerts set published_version=1 where alert_id=?", alert);
      when(evidence.detail(eq(alert), nullable(Integer.class))).thenReturn(doc);
    }
    long first = ids.getFirst();
    service.command(
        user,
        new ReviewService.Command(
            UUID.randomUUID(),
            "DECIDE",
            java.util.List.of(
                new ReviewService.Selection(first, 1, 0, java.util.List.of(transaction))),
            null,
            null,
            null,
            "NORMAL",
            "검토"));
    assertThat(
            jdbc.queryForObject(
                "select decision from review.alert_members where alert_id=?", String.class, first))
        .isEqualTo("NORMAL");
    var selections = new java.util.ArrayList<ReviewService.Selection>();
    for (long id : ids)
      selections.add(
          new ReviewService.Selection(
              id,
              ((Number) service.detail(id).get("revision")).longValue(),
              0,
              java.util.List.of()));
    long episode =
        ((Number)
                service
                    .command(
                        user,
                        new ReviewService.Command(
                            UUID.randomUUID(),
                            "TRANSFER",
                            selections,
                            null,
                            null,
                            null,
                            null,
                            "이관"))
                    .get("targetCaseId"))
            .longValue();
    assertThat(jdbc.queryForObject("select count(*) from review.episode_members", Integer.class))
        .isEqualTo(2);
    var detail = service.detail(episode);
    var groups = (java.util.List<java.util.Map<String, Object>>) detail.get("groups");
    long group = ((Number) groups.getFirst().get("groupId")).longValue();
    service.command(
        user,
        new ReviewService.Command(
            UUID.randomUUID(),
            "UNLINK",
            java.util.List.of(
                new ReviewService.Selection(
                    episode,
                    ((Number) detail.get("revision")).longValue(),
                    group,
                    java.util.List.of())),
            null,
            null,
            null,
            null,
            "해체"));
    assertThat(jdbc.queryForObject("select count(*) from review.episode_members", Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select outcome from review.episodes where episode_id=?", String.class, episode))
        .isEqualTo("DISSOLVED");
    assertThat(
            jdbc.queryForObject(
                "select decision from review.alert_members where alert_id=?", String.class, first))
        .isEqualTo("NORMAL");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.events where episode_id=? and action='DISSOLVE'",
                Integer.class,
                episode))
        .isEqualTo(1);
  }

  @Test
  void ledger_reads_stored_alias_and_keeps_unanalyzed_transactions() {
    jdbc.update("insert into core.banks(bank_id) values(1)");
    UUID publicOwner = UUID.randomUUID();
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(?,'저장된가명#12345') returning owner_id",
            Long.class,
            publicOwner);
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(service_account_id,bank_id,owner_id) values(gen_random_uuid(),1,?) returning account_id",
            Long.class,
            owner);
    jdbc.update(
        """
        insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,
          amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
        values('2023-09-01T00:00:00Z','2023-09-01',?,?,10,'USD',10,'USD','ACH',10,'test')
        """,
        account,
        account);
    var service = new LedgerQueryService(jdbc);
    var filter = new LedgerQueryService.Filter(null, null, null, null, null, null, 0, 20);
    var owners = service.query("owners", filter);
    assertThat(owners.get("totalElements")).isEqualTo(1L);
    assertThat(owners.get("content").toString()).contains("저장된가명#12345");
    assertThat(service.query("accounts", filter).get("content").toString()).contains("저장된가명#12345");
    var transactions = service.query("transactions", filter);
    assertThat(transactions.get("totalElements")).isEqualTo(1L);
    assertThat(transactions.get("content").toString()).contains("UNANALYZED", "저장된가명#12345");
    assertThat(
            service
                .query(
                    "owners",
                    new LedgerQueryService.Filter(
                        null, null, null, null, null, null, 0, 20, "저장된가명", null))
                .get("totalElements"))
        .isEqualTo(1L);
    assertThat(
            service
                .query(
                    "owners",
                    new LedgerQueryService.Filter(
                        null, null, null, null, java.util.List.of("SUSPICIOUS"), null, 0, 20))
                .get("totalElements"))
        .isEqualTo(0L);
  }

  @Test
  void empty_run_freezes_once_and_cancellation_fences_registered_requests() {
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-03',now(),now(),.7,'QUEUED','FREEZE_INPUT') returning job_id",
            Long.class);
    var runs = new AnalysisRunService(jdbc, tx, Clock.systemUTC(), new ObjectMapper());
    UUID run = runs.freeze(job, Instant.parse("2023-09-03T00:00:00Z"));
    assertThat(runs.freeze(job, Instant.parse("2023-09-03T00:00:00Z"))).isEqualTo(run);
    assertThat(runs.completedTarget(-1)).isFalse();
    runs.registerRequest(run, UUID.randomUUID(), 1, "BINARY");
    runs.cancel(run, "REPORT_CORRECTED");
    assertThat(
            jdbc.queryForObject(
                "select status from analysis.runs where run_id=?", String.class, run))
        .isEqualTo("CANCELLED");
    assertThat(
            jdbc.queryForObject(
                "select status from analysis.model_requests where run_id=?", String.class, run))
        .isEqualTo("BLOCKED");
    assertThat(
            jdbc.queryForObject(
                "select error_code from analysis.jobs where job_id=?", String.class, job))
        .isEqualTo("RUN_CANCELLED");
  }

  @Test
  void baseline_has_independent_roles_and_no_legacy_business_tables() {
    assertThat(
            jdbc.queryForObject(
                "select count(*) from public.flyway_schema_history where success", Integer.class))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForList(
                "select table_name from information_schema.tables where table_schema='public'",
                String.class))
        .containsExactly("flyway_schema_history");
    assertThat(
            jdbc.queryForObject(
                "select to_regclass('review.alerts') is not null and to_regclass('review.episodes') is not null and to_regclass('ingest.uploads') is not null and to_regclass('analysis.jobs') is not null",
                Boolean.class))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from information_schema.columns where table_schema='analysis' and table_name='alert_origins' and column_name='evidence'",
                Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from information_schema.columns where table_schema='review' and column_name='members'",
                Integer.class))
        .isZero();
  }

  @Test
  void stored_alias_and_private_identity_have_distinct_constraints() {
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'김민준#00001') returning owner_id",
            Long.class);
    jdbc.update(
        "insert into private.owner_identities values(?,'token','cipher','name','v1')", owner);
    assertThat(
            jdbc.queryForObject(
                "select display_name from core.owners where owner_id=?", String.class, owner))
        .isEqualTo("김민준#00001");
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'김민준#00001')"))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into private.owner_identities values(-1,'other','cipher','name','v1')"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void episode_minimum_is_checked_at_commit_and_dissolution_is_atomic() {
    long user = staff();
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into review.episodes(assignee_id,created_at,assigned_at) values(?,now(),now())",
                    user))
        .isInstanceOf(DataIntegrityViolationException.class);
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-02',now(),now(),.7,'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
    long episode =
        tx.execute(
            s -> {
              long id =
                  jdbc.queryForObject(
                      "insert into review.episodes(assignee_id,created_at,assigned_at) values(?,now(),now()) returning episode_id",
                      Long.class,
                      user);
              for (int i = 0; i < 2; i++) {
                long alert =
                    jdbc.queryForObject(
                        "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
                        Long.class,
                        user);
                assertThat(alert).isNotEqualTo(id);
                jdbc.update(
                    "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,'test','{}')",
                    alert,
                    run);
                jdbc.update(
                    "insert into review.episode_alerts(alert_id,episode_id,alert_version,label) values(?,?,1,'source')",
                    alert,
                    id);
              }
              return id;
            });
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "delete from review.episode_alerts where episode_id=? and alert_id=(select min(alert_id) from review.episode_alerts where episode_id=?)",
                    episode,
                    episode))
        .isInstanceOf(DataIntegrityViolationException.class);
    tx.executeWithoutResult(
        s -> {
          jdbc.update("delete from review.episode_alerts where episode_id=?", episode);
          jdbc.update(
              "update review.episodes set status='CLOSED',outcome='DISSOLVED',closed_at=now() where episode_id=?",
              episode);
        });
    assertThat(jdbc.queryForObject("select count(*) from review.episode_alerts", Integer.class))
        .isZero();
  }

  @Test
  void current_run_cannot_belong_to_another_job_and_events_have_one_target() {
    long user = staff();
    long first =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-01',now(),now(),.7,'QUEUED','WAIT_INGEST') returning job_id",
            Long.class);
    long second =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-02',now(),now(),.7,'QUEUED','WAIT_INGEST') returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, first);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "update analysis.jobs set current_run_id=? where job_id=?", run, second))
        .isInstanceOf(DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into review.events(actor_id,action,comment,business_at,snapshot) values(?,'COMMENT','test',now(),'{}')",
                    user))
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}
