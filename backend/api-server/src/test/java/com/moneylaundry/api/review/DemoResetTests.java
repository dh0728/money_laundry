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
  @Autowired DashboardProjection projection;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean UploadStore store;
  DemoResetService service;
  BusinessTime clock;
  long admin;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate " + DemoResetService.TABLES + ",ops.reset_files,ops.resets");
    jdbc.update("update ops.business_clock set business_at=null,revision=0");
    jdbc.update("insert into core.banks(bank_id) values(12) on conflict do nothing");
    clock =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "local"));
    service = new DemoResetService(jdbc, tx, clock, store);
    admin =
        jdbc.queryForObject("select user_id from core.users where username='admin'", Long.class);
    when(store.resetScope()).thenReturn("s3:test/dev/");
    when(store.removeDemoFiles(anyString(), anyBoolean())).thenReturn(true);
  }

  long job(String status) {
    return jdbc.queryForObject(
        "insert into ingest.uploads(bank_id,business_date,file_name,file_hash,size_bytes,status) values(12,'2023-09-01','fixture.csv',repeat('a',64),1,?) returning upload_id",
        Long.class,
        status);
  }

  long analysisJob(String status) {
    return jdbc.queryForObject(
        "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-02',now(),now(),0.7,?,'FEATURES') returning job_id",
        Long.class,
        status);
  }

  DemoResetService.ResetInput input() {
    return new DemoResetService.ResetInput(
        UUID.randomUUID(), (String) service.preview(admin).get("snapshot"), "시연 데이터 초기화");
  }

  @Test
  void clears_demonstration_data_and_clock_but_preserves_configuration_and_identity_sequences() {
    var users = jdbc.queryForList("select * from core.users order by user_id");
    var banks = jdbc.queryForList("select * from core.banks order by bank_id");
    var fx = jdbc.queryForList("select * from core.fx_rates order by currency");
    jdbc.update(
        "insert into core.banks(bank_id,name,is_reporting) values(999999,'reset-test',true) on conflict(bank_id) do nothing");
    jdbc.update(
        "insert into core.bank_reporting_periods(bank_id,effective_from_date) select 999999,'2023-01-01' where not exists(select 1 from core.bank_reporting_periods where bank_id=999999)");
    var periods = jdbc.queryForList("select * from core.bank_reporting_periods order by period_id");
    long old = job("COMPLETED");
    long reportSet =
        jdbc.queryForObject(
            "insert into ingest.report_sets(bank_id,business_date) values(999999,'2023-09-01') returning set_id",
            Long.class);
    long version =
        jdbc.queryForObject(
            "insert into ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status) values(?,?,1,now(),'ACTIVE') returning version_id",
            Long.class,
            reportSet,
            old);
    long report =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version) values(?,2,'test','cipher','test') returning report_id",
            Long.class,
            version);
    jdbc.update("insert into evaluation.report_labels values(?,true)", report);
    jdbc.update(
        "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now())",
        admin);
    long entity =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(?,'가명#00001') returning owner_id",
            Long.class,
            UUID.randomUUID());
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999999,?,?) returning account_id",
            Long.class,
            UUID.randomUUID(),
            entity);
    jdbc.update(
        "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(now(),?,?,10,'USD',10,'USD','ACH',10,'test','2023-09-01')",
        account,
        account);
    for (var scope : DashboardProjection.Scope.values()) projection.refresh(scope);
    var result = service.reset(admin, input());
    assertThat(result.get("status")).isEqualTo("COMPLETED");
    for (String table :
        (DemoResetService.TABLES + "," + DemoResetService.DASHBOARD_TABLES).split(","))
      assertThat(jdbc.queryForObject("select count(*) from " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(jdbc.queryForList("select * from core.users order by user_id")).isEqualTo(users);
    assertThat(jdbc.queryForList("select * from core.banks where bank_id<>999999 order by bank_id"))
        .containsAll(
            banks.stream().filter(b -> !Integer.valueOf(999999).equals(b.get("bank_id"))).toList());
    assertThat(jdbc.queryForList("select * from core.bank_reporting_periods order by period_id"))
        .isEqualTo(periods);
    assertThat(jdbc.queryForList("select * from core.fx_rates order by currency")).isEqualTo(fx);
    assertThat(clock.view().get("configured")).isEqualTo(false);
    clock.set(
        Instant.parse("2023-09-01T00:00:00Z"), ((Number) clock.view().get("revision")).longValue());
    assertThat(job("COMPLETED")).isGreaterThan(old);
  }

  @Test
  void cleanup_failure_is_retryable_and_same_request_never_deletes_new_data() {
    long id = job("FAILED");
    String key = "uploads/12/" + id + "/file.csv";
    jdbc.update("update ingest.uploads set s3_key=? where upload_id=?", key, id);
    var request = input();
    assertThat(service.reset(admin, request).get("status")).isEqualTo("FILES_PENDING");
    when(store.removeDemoFiles(key, false)).thenThrow(new IllegalStateException("secret"));
    assertThat(service.cleanup(admin, request.requestId()).get("status")).isEqualTo("FILES_FAILED");
    long newJob = job("COMPLETED");
    assertThat(service.reset(admin, request).get("status")).isEqualTo("FILES_FAILED");
    assertThat(jdbc.queryForObject("select upload_id from ingest.uploads", Long.class))
        .isEqualTo(newJob);
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
        "update ingest.uploads set status='FAILED',url_expires_at=now()+interval '10 minutes' where upload_id=?",
        id);
    var live = input();
    assertCode(() -> service.reset(admin, live), "RESET_UPLOAD_URL_ACTIVE");
    assertThat(jdbc.queryForObject("select count(*) from ingest.uploads", Integer.class))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("select count(*) from ops.resets", Integer.class)).isZero();
    verify(store, never()).removeDemoFiles(anyString(), anyBoolean());
  }

  @Test
  void prod_staff_and_missing_confirmation_are_rejected() {
    long staff =
        jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
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
      connection.createStatement().execute("lock table ingest.uploads in row exclusive mode");
      assertCode(() -> service.reset(admin, request), "RESET_BUSY");
      connection.rollback();
    }
    assertThat(jdbc.queryForObject("select count(*) from ingest.uploads", Integer.class))
        .isEqualTo(1);
  }

  @Test
  void targets_only_recorded_inference_requests_and_rejects_changed_storage_on_retry() {
    long id = analysisJob("COMPLETED");
    UUID run = UUID.randomUUID(), request = UUID.randomUUID();
    jdbc.update("insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, id);
    jdbc.update(
        "insert into analysis.model_requests(request_id,execution_round,run_id,model_kind,status) values(?,1,?,'BINARY','STOPPED')",
        request,
        run);
    var reset = input();
    service.reset(admin, reset);
    assertThat(
            jdbc.queryForList(
                "select object_key from ops.reset_files order by object_key", String.class))
        .containsExactly(
            "requests/" + id + "/BINARY/" + request + "/",
            "results/" + id + "/BINARY/" + request + "/");
    when(store.resetScope()).thenReturn("s3:other/dev/");
    assertThat(service.cleanup(admin, reset.requestId()).get("status")).isEqualTo("FILES_FAILED");
    verify(store, never()).removeDemoFiles(anyString(), anyBoolean());
  }

  @Test
  void unacknowledged_remote_request_blocks_even_failed_parent() {
    long id = analysisJob("FAILED");
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis.runs(run_id,job_id,status) values(?,?,'ACTIVE')", run, id);
    jdbc.update(
        "insert into analysis.model_requests(request_id,execution_round,run_id,model_kind,status) values(?,1,?,'BINARY','PUBLISHED')",
        UUID.randomUUID(),
        run);
    var request = input();
    assertCode(() -> service.reset(admin, request), "RESET_BUSY");
  }

  @Test
  void unexpected_dependency_rolls_back_reset_receipt_and_clock_together() {
    job("FAILED");
    var request = input();
    jdbc.execute("create table reset_dependency_test(job_id bigint references ingest.uploads)");
    try {
      assertThatThrownBy(() -> service.reset(admin, request))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
      assertThat(jdbc.queryForObject("select count(*) from ingest.uploads", Integer.class))
          .isEqualTo(1);
      assertThat(jdbc.queryForObject("select count(*) from ops.resets", Integer.class)).isZero();
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
