package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DashboardExecutionTests {
  @Autowired DashboardReadDatabase reads;
  @Autowired JdbcTemplate jdbc;
  @MockitoBean AnalysisScheduler scheduler;

  @Test
  void overrun_skips_duplicate_checks_and_does_not_block_other_scope() throws Exception {
    var projection = mock(DashboardProjection.class);
    when(projection.dueScopes())
        .thenReturn(
            List.of(DashboardProjection.Scope.PIPELINE, DashboardProjection.Scope.INVESTIGATION));
    var started = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var other = new CountDownLatch(1);
    var active = new AtomicInteger();
    var maximum = new AtomicInteger();
    when(projection.refresh(DashboardProjection.Scope.PIPELINE))
        .thenAnswer(
            i -> {
              maximum.accumulateAndGet(active.incrementAndGet(), Math::max);
              started.countDown();
              try {
                assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                return true;
              } finally {
                active.decrementAndGet();
              }
            });
    when(projection.refresh(DashboardProjection.Scope.INVESTIGATION))
        .thenAnswer(
            i -> {
              other.countDown();
              return true;
            });
    var worker = new DashboardRefreshWorker(projection, 5000, false);
    try {
      worker.checkNow();
      assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
      for (int i = 0; i < 10; i++) worker.checkNow();
      assertThat(other.await(2, TimeUnit.SECONDS)).isTrue();
      verify(projection, times(1)).refresh(DashboardProjection.Scope.PIPELINE);
      assertThat(maximum.get()).isEqualTo(1);
    } finally {
      release.countDown();
      worker.stop();
    }
  }

  @Test
  void absolute_deadline_cancels_database_work_and_pool_recovers() throws Exception {
    var pid = new AtomicInteger();
    long start = System.nanoTime();
    assertThatThrownBy(
            () ->
                reads.read(
                    c -> {
                      pid.set(c.jdbc().queryForObject("select pg_backend_pid()", Integer.class));
                      c.jdbc().execute("select pg_sleep(1.5)");
                      c.jdbc().execute("select pg_sleep(20)");
                      return 1;
                    }))
        .isInstanceOf(DashboardReadDatabase.Unavailable.class);
    double elapsed = (System.nanoTime() - start) / 1e9;
    assertThat(elapsed).isBetween(2.5, 5.0);
    long cleanupDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
    long remaining;
    do {
      remaining =
          jdbc.queryForObject(
              "select count(*) from pg_stat_activity where pid=? and state='active'",
              Long.class,
              pid.get());
      if (remaining == 0) break;
      Thread.sleep(20);
    } while (System.nanoTime() < cleanupDeadline);
    assertThat(remaining).as("PostgreSQL work must stop, not just the HTTP wait").isZero();
    int recovered = reads.read(c -> c.jdbc().queryForObject("select 42", Integer.class));
    assertThat(recovered).isEqualTo(42);
  }

  @Test
  void simultaneous_deadlines_cancel_all_active_queries() throws Exception {
    var pids = new CopyOnWriteArrayList<Integer>();
    try (var executor = Executors.newFixedThreadPool(4)) {
      var tasks = new ArrayList<Future<?>>();
      for (int i = 0; i < 4; i++)
        tasks.add(
            executor.submit(
                () -> {
                  long start = System.nanoTime();
                  assertThatThrownBy(
                          () ->
                              reads.read(
                                  c -> {
                                    pids.add(
                                        c.jdbc()
                                            .queryForObject(
                                                "select pg_backend_pid()", Integer.class));
                                    c.jdbc().execute("select pg_sleep(20)");
                                    return 1;
                                  }))
                      .isInstanceOf(DashboardReadDatabase.Unavailable.class);
                  assertThat((System.nanoTime() - start) / 1e9).isLessThan(5);
                }));
      for (var task : tasks) task.get(6, TimeUnit.SECONDS);
    }
    assertThat(pids).hasSize(4);
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
    long active;
    do {
      active = 0;
      for (int pid : pids)
        active +=
            jdbc.queryForObject(
                "select count(*) from pg_stat_activity where pid=? and state='active'",
                Long.class,
                pid);
      if (active == 0) break;
      Thread.sleep(20);
    } while (System.nanoTime() < deadline);
    assertThat(active).isZero();
  }

  @Test
  void pool_exhaustion_is_bounded_and_does_not_queue_requests_indefinitely() throws Exception {
    var entered = new CountDownLatch(4);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(4)) {
      var tasks = new ArrayList<Future<Integer>>();
      for (int i = 0; i < 4; i++)
        tasks.add(
            executor.submit(
                () ->
                    reads.read(
                        c -> {
                          entered.countDown();
                          try {
                            if (!release.await(2, TimeUnit.SECONDS))
                              throw new IllegalStateException("test timeout");
                          } catch (InterruptedException e) {
                            throw new IllegalStateException(e);
                          }
                          return 1;
                        })));
      try {
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        long start = System.nanoTime();
        assertThatThrownBy(() -> reads.read(c -> 1))
            .isInstanceOf(DashboardReadDatabase.Unavailable.class);
        assertThat((System.nanoTime() - start) / 1e9).isLessThan(1.5);
      } finally {
        release.countDown();
      }
      for (var task : tasks) assertThat(task.get(2, TimeUnit.SECONDS)).isEqualTo(1);
    }
  }

  @Test
  void readers_use_one_readonly_repeatable_snapshot() {
    var flags =
        reads.read(
            c ->
                c.jdbc()
                    .queryForMap(
                        "select current_setting('transaction_read_only') as ro,current_setting('transaction_isolation') as isolation"));
    assertThat(flags).containsEntry("ro", "on").containsEntry("isolation", "repeatable read");
    assertThatThrownBy(
            () ->
                reads.read(
                    c -> c.jdbc().update("update ops.business_clock set revision=revision+1")))
        .isInstanceOf(DashboardReadDatabase.Unavailable.class);
  }

  @Test
  void one_snapshot_does_not_mix_concurrent_commits() {
    long before =
        jdbc.queryForObject("select revision from ops.business_clock where id", Long.class);
    try {
      var seen =
          reads.read(
              c -> {
                long first =
                    c.jdbc()
                        .queryForObject(
                            "select revision from ops.business_clock where id", Long.class);
                jdbc.update("update ops.business_clock set revision=revision+1 where id");
                long second =
                    c.jdbc()
                        .queryForObject(
                            "select revision from ops.business_clock where id", Long.class);
                return List.of(first, second);
              });
      assertThat(seen).containsExactly(before, before);
      long after =
          reads.read(
              c ->
                  c.jdbc()
                      .queryForObject(
                          "select revision from ops.business_clock where id", Long.class));
      assertThat(after).isEqualTo(before + 1);
    } finally {
      jdbc.update("update ops.business_clock set revision=? where id", before);
    }
  }
}
