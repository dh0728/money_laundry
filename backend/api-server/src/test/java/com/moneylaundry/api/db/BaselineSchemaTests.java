package com.moneylaundry.api.db;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.analysis.AnalysisRunService;
import com.moneylaundry.api.review.LedgerQueryService;
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

/**
 * The single V1 baseline is tested in a fresh DB, never layered over the former migration history.
 */
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
    jdbc.execute("truncate core.users,core.banks,core.owners,analysis.jobs,ingest.uploads cascade");
  }

  long staff() {
    return jdbc.queryForObject(
        "insert into core.users(username,name,role) values(?,'Tester','STAFF') returning user_id",
        Long.class,
        UUID.randomUUID().toString());
  }

  static final String HEADER =
      "Timestamp,From Bank,From Account,To Bank,To Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,From Bank Name,To Bank Name,From Entity ID,From Entity Name,To Entity ID,To Entity Name,Is Laundering\n";

  long receivedUpload(String day, String name, byte[] source) {
    return jdbc.queryForObject(
        "insert into ingest.uploads(business_date,status,file_name,file_hash,size_bytes,s3_key,received_at) values(?::date,'RECEIVED',?,?,?,?,now()) returning upload_id",
        Long.class,
        day,
        name,
        "a".repeat(64),
        source.length,
        name);
  }

  @Test
  void real_python_ingest_loads_the_ledger_with_numbered_accounts_and_encrypted_identities()
      throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    byte[] first =
        (HEADER
                + "2023/09/01 09:00,10,001,20,002,100,US Dollar,100,US Dollar,ACH,Bank10,Bank20,E1,Alice,E2,Bob,1\n"
                + "2023/09/01 10:00,10,003,20,002,90,Euro,90,Euro,ACH,Bank10,Bank20,E3,Carol,E2,Bob,0\n")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    byte[] second =
        (HEADER
                + "2023/09/02 09:00,10,004,10,001,5,US Dollar,5,US Dollar,ACH,Bank10,Bank10,E4,Dave,E1,Alice,0\n")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    // Account 001 suddenly belongs to someone else: the whole file is rejected.
    byte[] conflicting =
        (HEADER
                + "2023/09/03 09:00,10,001,20,002,1,US Dollar,1,US Dollar,ACH,Bank10,Bank20,E9,Mallory,E2,Bob,0\n")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    var store = mock(com.moneylaundry.api.ingest.storage.UploadStore.class);
    var files = java.util.Map.of("first", first, "second", second, "conflicting", conflicting);
    when(store.open(anyString()))
        .thenAnswer(
            invocation -> new java.io.ByteArrayInputStream(files.get(invocation.getArgument(0))));
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
        new com.moneylaundry.api.ingest.load.LedgerLoader(
            jdbc,
            store,
            database,
            python,
            "worker/analysis_entry.py",
            java.time.Duration.ofSeconds(30),
            encryption,
            search,
            "test",
            "fx_rates_usd_v1",
            "Asia/Seoul");
    long upload = receivedUpload("2023-09-01", "first", first);
    loader.load(upload);
    assertThat(
            jdbc.queryForObject(
                "select status from ingest.uploads where upload_id=?", String.class, upload))
        .isEqualTo("COMPLETED");
    assertThat(
            jdbc.queryForList(
                "select service_account_id from core.accounts order by account_id", String.class))
        .containsExactly("10-0001", "20-0001", "10-0002");
    assertThat(
            jdbc.queryForList(
                "select upload_id from ledger.transactions order by tx_id", Long.class))
        .containsExactly(upload, upload);
    assertThat(
            jdbc.queryForList(
                "select amount_usd from ledger.transactions order by tx_id",
                java.math.BigDecimal.class))
        .usingElementComparator(java.math.BigDecimal::compareTo)
        .containsExactly(new java.math.BigDecimal("100"), new java.math.BigDecimal("105.460511"));
    assertThat(
            jdbc.queryForList(
                "select is_laundering from evaluation.transaction_labels order by tx_id",
                Boolean.class))
        .containsExactly(true, false);
    assertThat(jdbc.queryForObject("select count(*) from core.owners", Integer.class)).isEqualTo(3);
    var protector =
        new com.moneylaundry.api.ingest.load.PrivateDataProtector(encryption, search, "test");
    var alice =
        jdbc.queryForMap(
            "select o.name_cipher,a.identity_cipher from core.accounts c join private.account_identities a using(account_id) join private.owner_identities o using(owner_id) where c.service_account_id='10-0001'");
    assertThat(protector.decrypt("entity-name", alice.get("name_cipher").toString(), "test"))
        .isEqualTo("Alice");
    assertThat(protector.decrypt("account:10", alice.get("identity_cipher").toString(), "test"))
        .isEqualTo("001");
    assertThat(alice.values().toString()).doesNotContain("Alice", "001");
    // Loading again changes nothing: the upload is no longer waiting.
    loader.load(upload);
    assertThat(jdbc.queryForObject("select count(*) from ledger.transactions", Integer.class))
        .isEqualTo(2);

    long next = receivedUpload("2023-09-02", "second", second);
    loader.load(next);
    assertThat(
            jdbc.queryForList(
                "select service_account_id from core.accounts order by account_id", String.class))
        .containsExactly("10-0001", "20-0001", "10-0002", "10-0003");
    assertThat(
            jdbc.queryForObject(
                "select a.service_account_id from ledger.transactions t join core.accounts a on a.account_id=t.to_account_id where t.upload_id=?",
                String.class,
                next))
        .isEqualTo("10-0001");

    long rejected = receivedUpload("2023-09-03", "conflicting", conflicting);
    loader.load(rejected);
    assertThat(
            jdbc.queryForMap(
                "select status,validation_errors::text as errors from ingest.uploads where upload_id=?",
                rejected))
        .containsEntry("status", "VALIDATION_FAILED");
    assertThat(
            jdbc.queryForObject(
                "select validation_errors::text from ingest.uploads where upload_id=?",
                String.class,
                rejected))
        .contains("IDENTITY_CONFLICT");
    assertThat(jdbc.queryForObject("select count(*) from ledger.transactions", Integer.class))
        .isEqualTo(3);
    assertThat(jdbc.queryForObject("select count(*) from core.owners", Integer.class)).isEqualTo(4);
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
            "insert into core.accounts(bank_id,account_no,owner_id) values(1,1,?) returning account_id",
            Long.class,
            owner);
    long upload =
        jdbc.queryForObject(
            "insert into ingest.uploads(business_date,status,file_name,file_hash,size_bytes,received_at) values('2023-09-01','COMPLETED','ledger.csv',repeat('a',64),1,now()) returning upload_id",
            Long.class);
    jdbc.update(
        """
        insert into ledger.transactions(upload_id,occurred_at,business_date,from_account_id,to_account_id,
          amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version)
        values(?,'2023-09-01T00:00:00Z','2023-09-01',?,?,10,'USD',10,'USD','ACH',10,'test')
        """,
        upload,
        account,
        account);
    assertThat(
            jdbc.queryForObject(
                "select service_account_id from core.accounts where account_id=?",
                String.class,
                account))
        .isEqualTo("1-0001");
    var service = new LedgerQueryService(jdbc);
    var filter = new LedgerQueryService.Filter(null, null, null, null, null, null, 0, 20);
    var owners = service.query("owners", filter);
    assertThat(owners.get("totalElements")).isEqualTo(1L);
    assertThat(owners.get("content").toString()).contains("저장된가명#12345");
    assertThat(service.query("accounts", filter).get("content").toString())
        .contains("저장된가명#12345", "1-0001");
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
  void account_numbers_keep_four_digits_and_grow_past_them() {
    jdbc.update("insert into core.banks(bank_id) values(3225455)");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'가명#1') returning owner_id",
            Long.class);
    for (int number : new int[] {1, 9999, 10000})
      jdbc.update(
          "insert into core.accounts(bank_id,account_no,owner_id) values(3225455,?,?)",
          number,
          owner);
    assertThat(
            jdbc.queryForList(
                "select service_account_id from core.accounts where bank_id=3225455 order by account_no",
                String.class))
        .containsExactly("3225455-0001", "3225455-9999", "3225455-10000");
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into core.accounts(bank_id,account_no,owner_id) values(3225455,1,?)",
                    owner))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void empty_run_freezes_once_and_registers_requests() {
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-03',now(),now(),.7,'QUEUED','FREEZE_INPUT') returning job_id",
            Long.class);
    var runs = new AnalysisRunService(jdbc, tx, Clock.systemUTC());
    UUID run = runs.freeze(job, Instant.parse("2023-09-03T00:00:00Z"));
    assertThat(runs.freeze(job, Instant.parse("2023-09-03T00:00:00Z"))).isEqualTo(run);
    assertThat(runs.completedTarget(-1)).isFalse();
    runs.registerRequest(run, UUID.randomUUID(), 1, "BINARY");
    assertThat(
            jdbc.queryForObject(
                "select status from analysis.model_requests where run_id=?", String.class, run))
        .isEqualTo("REGISTERED");
  }

  @Test
  void baseline_has_independent_roles_and_no_legacy_business_tables() {
    // V1 기준 스키마 + V2 룰 엔진(rules 스키마) + V3 룰 알림
    assertThat(
            jdbc.queryForObject(
                "select count(*) from public.flyway_schema_history where success", Integer.class))
        .isEqualTo(3);
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
                "select count(*) from information_schema.columns where table_schema='analysis' and table_name='alert_origin_ledger' and column_name='evidence'",
                Integer.class))
        .isZero();
    // One frozen copy per fact: the shared ledgers replaced the per-run copies and their marks.
    assertThat(
            jdbc.queryForObject(
                "select count(*) from unnest(array['analysis.input_reports','analysis.input_scores','analysis.alert_origins','analysis.alert_fact_checks','analysis.input_ledger_marks']) t where to_regclass(t) is not null",
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
                    "insert into review.episode_alerts(alert_id,episode_id,alert_version) values(?,?,1)",
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
