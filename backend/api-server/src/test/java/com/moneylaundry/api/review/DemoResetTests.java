package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.*;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.storage.UploadStore;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DemoResetTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean UploadStore store;
  DemoResetService service;
  BusinessTime clock;
  long admin;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate " + DemoResetService.TABLES + ",demo_reset_files,demo_resets");
    jdbc.update("update demo_business_clock set business_at=null,revision=0");
    clock =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "local"));
    service = new DemoResetService(jdbc, tx, clock, store);
    admin = jdbc.queryForObject("select user_id from users where username='admin'", Long.class);
    when(store.resetScope()).thenReturn("s3:test/dev/");
    when(store.removeDemoFiles(anyString(), anyBoolean())).thenReturn(true);
  }

  long job(String status) {
    return jdbc.queryForObject(
        "insert into batch_jobs(job_type,status) values('INGEST',?) returning job_id",
        Long.class,
        status);
  }

  DemoResetService.ResetInput input() {
    return new DemoResetService.ResetInput(
        UUID.randomUUID(), (String) service.preview(admin).get("snapshot"), "시연 데이터 초기화");
  }

  @Test
  void clears_demonstration_data_and_clock_but_preserves_configuration_and_identity_sequences() {
    var users = jdbc.queryForList("select * from users order by user_id");
    var banks = jdbc.queryForList("select * from banks order by bank_id");
    var fx = jdbc.queryForList("select * from fx_rates order by currency");
    jdbc.update(
        "insert into banks(bank_id,name,is_reporting) values(999999,'reset-test',true) on conflict(bank_id) do nothing");
    jdbc.update(
        "insert into bank_reporting_periods(bank_id,effective_from_date) select 999999,'2023-01-01' where not exists(select 1 from bank_reporting_periods where bank_id=999999)");
    var periods = jdbc.queryForList("select * from bank_reporting_periods order by period_id");
    long old = job("COMPLETED");
    jdbc.update("insert into alerts(assignee_id) values(?)", admin);
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(?,'e','cipher','cipher','test') returning entity_id",
            Long.class,
            UUID.randomUUID());
    long account =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999999,?,'a',?,'cipher','test') returning account_id",
            Long.class,
            UUID.randomUUID(),
            entity);
    jdbc.update(
        "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(now(),?,?,10,'USD',10,'USD','ACH',10,'test','2023-09-01')",
        account,
        account);
    var result = service.reset(admin, input());
    assertThat(result.get("status")).isEqualTo("COMPLETED");
    for (String table : DemoResetService.TABLES.split(","))
      assertThat(jdbc.queryForObject("select count(*) from " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(jdbc.queryForList("select * from users order by user_id")).isEqualTo(users);
    assertThat(jdbc.queryForList("select * from banks where bank_id<>999999 order by bank_id"))
        .containsAll(
            banks.stream().filter(b -> !Integer.valueOf(999999).equals(b.get("bank_id"))).toList());
    assertThat(jdbc.queryForList("select * from bank_reporting_periods order by period_id"))
        .isEqualTo(periods);
    assertThat(jdbc.queryForList("select * from fx_rates order by currency")).isEqualTo(fx);
    assertThat(clock.view().get("configured")).isEqualTo(false);
    clock.set(
        Instant.parse("2023-09-01T00:00:00Z"), ((Number) clock.view().get("revision")).longValue());
    assertThat(job("COMPLETED")).isGreaterThan(old);
  }

  @Test
  void cleanup_failure_is_retryable_and_same_request_never_deletes_new_data() {
    long id = job("FAILED");
    String key = "uploads/12/" + id + "/file.csv";
    jdbc.update("update batch_jobs set s3_key=? where job_id=?", key, id);
    var request = input();
    assertThat(service.reset(admin, request).get("status")).isEqualTo("FILES_PENDING");
    when(store.removeDemoFiles(key, false)).thenThrow(new IllegalStateException("secret"));
    assertThat(service.cleanup(admin, request.requestId()).get("status")).isEqualTo("FILES_FAILED");
    long newJob = job("COMPLETED");
    assertThat(service.reset(admin, request).get("status")).isEqualTo("FILES_FAILED");
    assertThat(jdbc.queryForObject("select job_id from batch_jobs", Long.class)).isEqualTo(newJob);
    doReturn(true).when(store).removeDemoFiles(key, false);
    assertThat(service.cleanup(admin, request.requestId()).get("status")).isEqualTo("COMPLETED");
    assertThat(service.latest(admin).get("resetId")).isEqualTo(request.requestId());
  }

  @Test
  void stale_preview_busy_jobs_and_live_urls_do_not_delete_anything() {
    var stale = input();
    long id = job("RUNNING");
    assertCode(() -> service.reset(admin, stale), "RESET_PREVIEW_STALE");
    var busy = input();
    assertCode(() -> service.reset(admin, busy), "RESET_BUSY");
    jdbc.update(
        "update batch_jobs set status='FAILED',url_expires_at=now()+interval '10 minutes' where job_id=?",
        id);
    var live = input();
    assertCode(() -> service.reset(admin, live), "RESET_UPLOAD_URL_ACTIVE");
    assertThat(jdbc.queryForObject("select count(*) from batch_jobs", Integer.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("select count(*) from demo_resets", Integer.class)).isZero();
    verify(store, never()).removeDemoFiles(anyString(), anyBoolean());
  }

  @Test
  void prod_staff_and_missing_confirmation_are_rejected() {
    long staff = jdbc.queryForObject("select user_id from users where username='l1a'", Long.class);
    assertCode(() -> service.preview(staff), "FORBIDDEN");
    var prodClock =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "prod,dev"));
    var prod = new DemoResetService(jdbc, tx, prodClock, store);
    assertCode(() -> prod.preview(admin), "DEMO_CONTROL_DISABLED");
    assertCode(
        () -> service.reset(admin, new DemoResetService.ResetInput(UUID.randomUUID(), "x", "")),
        "RESET_CONFIRMATION_REQUIRED");
  }

  @Test
  void table_writer_blocks_reset_without_partial_deletion() throws Exception {
    job("FAILED");
    var request = input();
    try (var connection = jdbc.getDataSource().getConnection()) {
      connection.setAutoCommit(false);
      connection.createStatement().execute("lock table batch_jobs in row exclusive mode");
      assertCode(() -> service.reset(admin, request), "RESET_BUSY");
      connection.rollback();
    }
    assertThat(jdbc.queryForObject("select count(*) from batch_jobs", Integer.class)).isEqualTo(1);
  }

  @Test
  void targets_only_recorded_inference_requests_and_rejects_changed_storage_on_retry() {
    long id = job("COMPLETED");
    UUID run = UUID.randomUUID(), request = UUID.randomUUID();
    jdbc.update("insert into analysis_runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, id);
    jdbc.update(
        "insert into analysis_model_requests(request_id,execution_round,run_id,model_kind,status) values(?,1,?,'BINARY','STOPPED')",
        request,
        run);
    var reset = input();
    service.reset(admin, reset);
    assertThat(
            jdbc.queryForList(
                "select object_key from demo_reset_files order by object_key", String.class))
        .containsExactly(
            "requests/" + id + "/BINARY/" + request + "/",
            "results/" + id + "/BINARY/" + request + "/");
    when(store.resetScope()).thenReturn("s3:other/dev/");
    assertThat(service.cleanup(admin, reset.requestId()).get("status")).isEqualTo("FILES_FAILED");
    verify(store, never()).removeDemoFiles(anyString(), anyBoolean());
  }

  @Test
  void unacknowledged_remote_request_blocks_even_failed_parent() {
    long id = job("FAILED");
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis_runs(run_id,job_id,status) values(?,?,'ACTIVE')", run, id);
    jdbc.update(
        "insert into analysis_model_requests(request_id,execution_round,run_id,model_kind,status) values(?,1,?,'BINARY','PUBLISHED')",
        UUID.randomUUID(),
        run);
    var request = input();
    assertCode(() -> service.reset(admin, request), "RESET_BUSY");
  }

  @Test
  void unexpected_dependency_rolls_back_reset_receipt_and_clock_together() {
    job("FAILED");
    var request = input();
    jdbc.execute("create table reset_dependency_test(job_id bigint references batch_jobs)");
    try {
      assertThatThrownBy(() -> service.reset(admin, request))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
      assertThat(jdbc.queryForObject("select count(*) from batch_jobs", Integer.class))
          .isEqualTo(1);
      assertThat(jdbc.queryForObject("select count(*) from demo_resets", Integer.class)).isZero();
      assertThat(clock.view().get("revision")).isEqualTo(0L);
      verify(store, never()).removeDemoFiles(anyString(), anyBoolean());
    } finally {
      jdbc.execute("drop table reset_dependency_test");
    }
  }

  private void assertCode(Runnable action, String code) {
    assertThatThrownBy(action::run)
        .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(code));
  }
}
