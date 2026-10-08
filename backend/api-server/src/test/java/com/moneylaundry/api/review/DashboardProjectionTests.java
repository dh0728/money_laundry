package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DashboardProjectionTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired DashboardProjection projection;
  @Autowired PlatformTransactionManager manager;
  @Autowired TransactionTemplate tx;
  @MockitoBean AnalysisScheduler scheduler;
  long account, user;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate " + DemoResetService.TABLES + "," + DemoResetService.DASHBOARD_TABLES);
    jdbc.update("delete from ops.dashboard_dirty");
    jdbc.update("insert into core.banks(bank_id) values(999019) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'가명#00001') returning owner_id",
            Long.class);
    account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999019,gen_random_uuid(),?) returning account_id",
            Long.class,
            owner);
    user = jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
  }

  long transaction(String date) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::date,?::date,?,?,1,'USD',1,'USD','ACH',1,'test') returning tx_id",
        Long.class,
        date,
        date,
        account,
        account);
  }

  long publishedAlert(String at) {
    return tx.execute(
        status -> {
          long job =
              jdbc.queryForObject(
                  "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-01',now(),now(),.7,'COMPLETED','COMPLETE') returning job_id",
                  Long.class);
          var run = UUID.randomUUID();
          jdbc.update(
              "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
          jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
          long alert =
              jdbc.queryForObject(
                  "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,?::timestamptz,?::timestamptz) returning alert_id",
                  Long.class,
                  user,
                  at,
                  at);
          jdbc.update(
              "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,repeat('f',64),'{}',now())",
              alert,
              run);
          jdbc.update("update review.alerts set published_version=1 where alert_id=?", alert);
          return alert;
        });
  }

  long received() {
    return jdbc.queryForObject(
        "select coalesce(sum(n),0)::bigint from ops.dashboard_model_counts", Long.class);
  }

  void drain() {
    for (var scope : DashboardProjection.Scope.values()) projection.refresh(scope);
  }

  @Test
  void changes_are_transactional_coalesced_and_only_affected_days_are_replaced() {
    tx.executeWithoutResult(
        s -> {
          transaction("2023-08-31");
          transaction("2023-08-31");
          assertThat(
                  jdbc.queryForObject(
                      "select count(*) from ops.dashboard_dirty where scope='MODEL'", Long.class))
              .isEqualTo(1);
          s.setRollbackOnly();
        });
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isFalse();
    long first = transaction("2023-08-31");
    transaction("2023-09-01");
    assertThat(received()).isZero();
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isTrue();
    var unchanged =
        jdbc.queryForObject(
            "select xmin::text from ops.dashboard_model_counts where business_date='2023-09-01'",
            String.class);
    jdbc.update("update ledger.transactions set integration_status='HELD' where tx_id=?", first);
    projection.refresh(DashboardProjection.Scope.MODEL);
    assertThat(received()).isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select xmin::text from ops.dashboard_model_counts where business_date='2023-09-01'",
                String.class))
        .isEqualTo(unchanged);
    jdbc.update(
        "update ledger.transactions set integration_status='ACTIVE',business_date='2023-09-02' where tx_id=?",
        first);
    projection.refresh(DashboardProjection.Scope.MODEL);
    assertThat(
            jdbc.queryForList(
                "select business_date::text from ops.dashboard_model_counts order by 1",
                String.class))
        .containsExactly("2023-09-01", "2023-09-02");
    jdbc.update("delete from ledger.transactions where tx_id=?", first);
    projection.refresh(DashboardProjection.Scope.MODEL);
    assertThat(received()).isEqualTo(1);
  }

  @Test
  void previous_committed_value_stays_readable_and_concurrent_change_survives_refresh()
      throws Exception {
    transaction("2023-08-31");
    projection.refresh(DashboardProjection.Scope.MODEL);
    transaction("2023-08-31");
    var calculated = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var blocked =
        new JdbcTemplate(jdbc.getDataSource()) {
          @Override
          public int update(String sql, Object... args) {
            int n = super.update(sql, args);
            if (sql.startsWith("insert into ops.dashboard_model_counts")) {
              calculated.countDown();
              try {
                if (!release.await(15, TimeUnit.SECONDS))
                  throw new IllegalStateException("test timeout");
              } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
              }
            }
            return n;
          }
        };
    try (var executor = Executors.newSingleThreadExecutor()) {
      var work =
          executor.submit(
              () ->
                  new DashboardProjection(blocked, manager)
                      .refresh(DashboardProjection.Scope.MODEL));
      try {
        assertThat(calculated.await(10, TimeUnit.SECONDS)).isTrue();
        assertThat(received()).isEqualTo(1); // Uncommitted delete/insert is never visible.
        assertThat(projection.refresh(DashboardProjection.Scope.MODEL))
            .isFalse(); // Another instance.
        transaction("2023-08-31"); // Must survive the first worker's queue deletion.
        publishedAlert("2023-09-01 00:00Z");
        assertThat(projection.refresh(DashboardProjection.Scope.CASES)).isTrue();
        assertThat(
                jdbc.queryForObject(
                    "select sum(n)::bigint from ops.dashboard_case_counts", Long.class))
            .isEqualTo(1);
      } finally {
        release.countDown();
      }
      assertThat(work.get(10, TimeUnit.SECONDS)).isTrue();
    }
    assertThat(received()).isEqualTo(2);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isTrue();
    assertThat(received()).isEqualTo(3);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isFalse();
  }

  @Test
  void failed_replacement_rolls_back_and_retry_does_not_double_count() {
    transaction("2023-08-31");
    drain();
    transaction("2023-08-31");
    var broken =
        new JdbcTemplate(jdbc.getDataSource()) {
          @Override
          public int update(String sql, Object... args) {
            int count = super.update(sql, args);
            if (sql.startsWith("insert into ops.dashboard_model_counts"))
              throw new IllegalStateException("fixture failure");
            return count;
          }
        };
    assertThatThrownBy(
            () -> new DashboardProjection(broken, manager).refresh(DashboardProjection.Scope.MODEL))
        .isInstanceOf(IllegalStateException.class);
    assertThat(received()).isEqualTo(1);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isTrue();
    assertThat(received()).isEqualTo(2);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isFalse();
  }

  @Test
  void report_and_delivery_values_update_independently_and_truncate_clears_rebuilt_values() {
    long upload =
        jdbc.queryForObject(
            "insert into ingest.uploads(bank_id,business_date,file_name,file_hash,size_bytes,status) values(999019,'2023-08-31','fixture.csv',repeat('a',64),1,'FAILED') returning upload_id",
            Long.class);
    jdbc.update(
        "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-01',now(),'2023-09-03 09:00+09',.7,'QUEUED','FEATURES')");
    projection.refresh(DashboardProjection.Scope.REPORTS);
    assertThat(jdbc.queryForObject("select n from ops.dashboard_report_counts", Long.class))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("select count(*) from ops.dashboard_delivery_days", Long.class))
        .isZero();
    projection.refresh(DashboardProjection.Scope.DELIVERY);
    assertThat(
            jdbc.queryForObject(
                "select business_date::text from ops.dashboard_delivery_days where detected_day='2023-09-03'",
                String.class))
        .isEqualTo("2023-08-31");
    jdbc.update("update ingest.uploads set status='EXPIRED' where upload_id=?", upload);
    projection.refresh(DashboardProjection.Scope.REPORTS);
    assertThat(jdbc.queryForObject("select count(*) from ops.dashboard_report_counts", Long.class))
        .isZero();
    transaction("2023-08-31");
    drain();
    jdbc.execute("truncate ledger.transactions cascade");
    drain();
    assertThat(received()).isZero();
  }

  @Test
  void employee_changes_do_not_dirty_model_and_clock_boundaries_need_no_rebuild() {
    transaction("2023-08-31");
    publishedAlert("2023-09-01 00:00Z");
    drain();
    var before = jdbc.queryForList("select xmin::text,n from ops.dashboard_model_counts");
    jdbc.update("update core.users set name=name where user_id=?", user);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isFalse();
    assertThat(projection.refresh(DashboardProjection.Scope.CASES)).isTrue();
    var clock = mock(BusinessTime.class);
    var dashboard = new DashboardService(jdbc, clock);
    var day = LocalDate.parse("2023-09-04");
    var now = Instant.parse("2023-09-04T00:00:00Z");
    when(clock.now()).thenReturn(now.minusSeconds(1), now);
    assertThat(dashboard.view(user, day, day).get("openAlertsAgedOver3Days")).isEqualTo(0L);
    assertThat(dashboard.view(user, day, day).get("openAlertsAgedOver3Days")).isEqualTo(1L);
    assertThat(jdbc.queryForList("select xmin::text,n from ops.dashboard_model_counts"))
        .isEqualTo(before);
  }

  @Test
  void restricted_worker_can_invalidate_but_cannot_read_or_write_ops() throws Exception {
    jdbc.execute(
        "do $$ begin if not exists(select from pg_roles where rolname='dashboard_worker_test') then create role dashboard_worker_test nosuperuser nocreatedb nocreaterole noinherit; end if; end $$");
    jdbc.execute(
        Files.readString(Path.of("worker/analysis_permissions.sql"))
            .replace(":\"worker_role\"", "dashboard_worker_test"));
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-01',now(),now(),.7,'QUEUED','FEATURES') returning job_id",
            Long.class);
    drain();
    tx.executeWithoutResult(
        s -> {
          jdbc.execute("set local role dashboard_worker_test");
          jdbc.update("update analysis.jobs set status='RUNNING' where job_id=?", job);
        });
    assertThat(projection.refresh(DashboardProjection.Scope.DELIVERY)).isTrue();
    for (String sql :
        List.of("select * from ops.dashboard_delivery_days", "delete from ops.dashboard_dirty"))
      assertThatThrownBy(
              () ->
                  tx.executeWithoutResult(
                      s -> {
                        jdbc.execute("set local role dashboard_worker_test");
                        jdbc.execute(sql);
                      }))
          .isInstanceOf(DataAccessException.class);
  }

  @Test
  void background_worker_drains_changes_and_retries_failed_scope_without_blocking_model()
      throws Exception {
    transaction("2023-08-31");
    jdbc.update("update core.users set name=name where user_id=?", user);
    var observed = spy(projection);
    var casesDone = new CountDownLatch(1);
    var attempts = new java.util.concurrent.atomic.AtomicInteger();
    doAnswer(
            invocation -> {
              if (attempts.incrementAndGet() == 1)
                throw new IllegalStateException("fixture failure");
              boolean changed = (boolean) invocation.callRealMethod();
              if (changed) casesDone.countDown();
              return changed;
            })
        .when(observed)
        .refresh(DashboardProjection.Scope.CASES);
    var modelDone = new CountDownLatch(1);
    doAnswer(
            invocation -> {
              boolean changed = (boolean) invocation.callRealMethod();
              if (changed) modelDone.countDown();
              return changed;
            })
        .when(observed)
        .refresh(DashboardProjection.Scope.MODEL);
    // The second successful CASES pass is observable through the durable queue.
    var worker = new DashboardRefreshWorker(observed, 100, true);
    try {
      worker.start();
      assertThat(modelDone.await(10, TimeUnit.SECONDS)).isTrue();
      assertThat(casesDone.await(10, TimeUnit.SECONDS)).isTrue();
      assertThat(received()).isEqualTo(1);
    } finally {
      worker.stop();
    }
    assertThat(
            jdbc.queryForObject(
                "select count(*) from ops.dashboard_dirty where scope in ('MODEL','CASES')",
                Long.class))
        .isZero();
  }

  @Test
  void dashboard_reads_stored_values_without_source_rescan_or_fallback() {
    transaction("2023-08-31");
    drain();
    transaction("2023-08-31");
    var observed = spy(new JdbcTemplate(jdbc.getDataSource()));
    var time =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "local"));
    jdbc.update("update ops.business_clock set business_at='2023-09-01 09:00+09'");
    var dashboard = new DashboardService(observed, time);
    var day = LocalDate.parse("2023-09-01");
    var result = dashboard.view(user, day, day);
    assertThat(((Map<?, ?>) result.get("detection")).get("received")).isEqualTo(1L);
    assertThat(result).doesNotContainKeys("refreshing", "generation", "stale");
    for (var invocation : mockingDetails(observed).getInvocations()) {
      if (invocation.getArguments().length > 0
          && invocation.getArguments()[0] instanceof String sql)
        assertThat(sql).doesNotContain("ledger.", "analysis.", "review.cases", "dashboard_dirty");
    }
    assertThat(received()).isEqualTo(1);
    assertThat(projection.refresh(DashboardProjection.Scope.MODEL)).isTrue();
    assertThat(((Map<?, ?>) dashboard.view(user, day, day).get("detection")).get("received"))
        .isEqualTo(2L);
  }
}
