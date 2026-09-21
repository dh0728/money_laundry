package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class AnalysisRunnerTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired PlatformTransactionManager manager;
  @MockitoBean AnalysisScheduler scheduler;
  final List<AnalysisRunner> runners = new ArrayList<>();

  AnalysisRunner runner(AnalysisStageExecutor executor) {
    var result = new AnalysisRunner(service, executor);
    runners.add(result);
    return result;
  }

  @AfterEach
  void release() {
    runners.forEach(AnalysisRunner::close);
  }

  AnalysisService service;
  MutableClock clock;

  static class MutableClock extends Clock {
    Instant now = Instant.parse("2026-09-09T18:00:00Z");

    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    public Clock withZone(ZoneId zone) {
      return Clock.fixed(now, zone);
    }

    public Instant instant() {
      return now;
    }

    void advance(long seconds) {
      now = now.plusSeconds(seconds);
    }
  }

  @BeforeEach
  void setup() {
    jdbc.execute("truncate batch_jobs cascade");
    clock = new MutableClock();
    service =
        new AnalysisService(
            jdbc, new TransactionTemplate(manager), clock, "Asia/Seoul", 0.7, LocalTime.of(3, 0));
  }

  long upload(String status, Instant at) {
    return jdbc.queryForObject(
        "insert into batch_jobs(job_type,status,received_at) values('INGEST',?,?) returning job_id",
        Long.class,
        status,
        at == null ? null : Timestamp.from(at));
  }

  long stageJob() {
    long id = service.registerNow();
    jdbc.update("update batch_jobs set current_stage='FEATURES' where job_id=?", id);
    return id;
  }

  @Test
  void cutoff_snapshot_is_fixed_and_late_upload_moves_to_next_day() {
    long included = upload("RUNNING", clock.instant());
    long late = upload("COMPLETED", clock.instant().plusNanos(1000));
    upload("URL_ISSUED", null);
    long id = service.registerScheduled();
    assertThat(
            jdbc.queryForList(
                "select upload_id from analysis_uploads where job_id=?", Long.class, id))
        .containsExactly(included);
    clock.advance(86400);
    long next = service.registerScheduled();
    assertThat(
            jdbc.queryForList(
                "select upload_id from analysis_uploads where job_id=?", Long.class, next))
        .containsExactly(late);
  }

  @Test
  void waiting_does_not_count_attempts_and_failed_ingest_is_not_empty_success() {
    long upload = upload("RUNNING", clock.instant());
    long id = service.registerNow();
    AnalysisRunner runner =
        runner(
            c -> {
              throw new AssertionError("no model while ingest pending");
            });
    runner.scan();
    assertThat(service.job(id).status()).isEqualTo("RETRY_WAIT");
    assertThat(service.job(id).attempts()).isZero();
    jdbc.update("update batch_jobs set status='FAILED' where job_id=?", upload);
    clock.advance(5);
    runner.scan();
    assertThat(service.job(id).status()).isEqualTo("FAILED");
    assertThat(service.job(id).error()).isEqualTo("INGEST_FAILED");
    jdbc.update("update batch_jobs set status='VALIDATION_FAILED' where job_id=?", upload);
    service.resume(id);
    runner.scan();
    assertThat(service.job(id).status()).isEqualTo("COMPLETED");
    assertThat(service.detail(id).get("completionReason")).isEqualTo("EMPTY_INPUT");
  }

  @Test
  void same_calculation_error_stops_on_third_and_resume_keeps_history() {
    long id = stageJob();
    AtomicInteger attempts = new AtomicInteger();
    AnalysisRunner runner =
        runner(
            c -> {
              attempts.incrementAndGet();
              throw new AnalysisFailure("CALCULATION", AnalysisFailure.Kind.COMPUTATION);
            });
    runner.scan();
    assertThat(service.job(id).retryAt()).isEqualTo(clock.instant().plusSeconds(60));
    runner.scan();
    assertThat(attempts).hasValue(1);
    clock.advance(60);
    runner.scan();
    assertThat(service.job(id).retryAt()).isEqualTo(clock.instant().plusSeconds(300));
    clock.advance(300);
    runner.scan();
    assertThat(service.job(id).status()).isEqualTo("FAILED");
    clock.advance(86400);
    runner.scan();
    assertThat(attempts).hasValue(3);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_failures where job_id=?", Integer.class, id))
        .isEqualTo(3);
    service.resume(id);
    runner.scan();
    assertThat(service.job(id).failures()).isEqualTo(1);
    assertThat(attempts).hasValue(4);
  }

  @Test
  void connection_retry_intervals_and_success_preserve_completed_stage() {
    long id = stageJob();
    AtomicInteger calls = new AtomicInteger();
    AnalysisRunner runner =
        runner(
            c -> {
              if (calls.incrementAndGet() < 3)
                throw new AnalysisFailure("S3_UNAVAILABLE", AnalysisFailure.Kind.CONNECTION);
              return new AnalysisStageExecutor.Result(c.stage().name());
            });
    runner.scan();
    assertThat(service.job(id).retryAt()).isEqualTo(clock.instant().plusSeconds(30));
    clock.advance(30);
    runner.scan();
    assertThat(service.job(id).retryAt()).isEqualTo(clock.instant().plusSeconds(120));
    clock.advance(120);
    runner.scan();
    assertThat(service.job(id).stage()).isEqualTo(AnalysisStage.INFERENCE);
    assertThat(service.job(id).failures()).isZero();
    runner.scan();
    runner.scan();
    runner.scan();
    assertThat(service.job(id).status()).isEqualTo("COMPLETED");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_stage_results where job_id=? and completed",
                Integer.class,
                id))
        .isEqualTo(4);
    assertThatThrownBy(() -> service.resume(id)).hasMessageContaining("상태");
  }

  @Test
  void alternating_codes_do_not_gain_unapproved_total_cap() {
    long id = stageJob();
    AtomicInteger count = new AtomicInteger();
    AnalysisRunner runner =
        runner(
            c -> {
              throw new AnalysisFailure(
                  count.incrementAndGet() % 2 == 0 ? "A" : "B", AnalysisFailure.Kind.COMPUTATION);
            });
    for (int i = 0; i < 6; i++) {
      runner.scan();
      clock.advance(60);
    }
    assertThat(service.job(id).status()).isEqualTo("RETRY_WAIT");
    assertThat(service.job(id).failures()).isEqualTo(1);
    assertThat(service.job(id).attempts()).isEqualTo(6);
  }

  @Test
  void stale_owner_recovery_retains_failure_counter_and_fences_late_commit() {
    long id = stageJob();
    AtomicInteger commit = new AtomicInteger();
    AnalysisStageExecutor executor =
        new AnalysisStageExecutor() {
          public Result prepare(Context c) {
            jdbc.update(
                "update batch_jobs set execution_id=? where job_id=?", UUID.randomUUID(), id);
            return new Result("late");
          }

          public void commit(Context c, Result r) {
            commit.incrementAndGet();
          }
        };
    runner(executor).scan();
    assertThat(commit).hasValue(0);
    jdbc.update(
        "update batch_jobs set consecutive_failures=2,error_code='CALCULATION' where job_id=?", id);
    runners.getFirst().close();
    AnalysisRunner restarted =
        runner(
            c -> {
              throw new AnalysisFailure("CALCULATION", AnalysisFailure.Kind.COMPUTATION);
            });
    restarted.recover();
    assertThat(service.job(id).failures()).isEqualTo(2);
    restarted.scan();
    assertThat(service.job(id).status()).isEqualTo("FAILED");
  }

  @Test
  void commit_db_failure_does_not_repeat_prepare_and_rolls_back_fixture_writes() {
    long id = stageJob();
    AtomicInteger prepared = new AtomicInteger(), committed = new AtomicInteger();
    AnalysisStageExecutor executor =
        new AnalysisStageExecutor() {
          public Result prepare(Context c) {
            prepared.incrementAndGet();
            return new Result("s3://fixture/result");
          }

          public void commit(Context c, Result r) {
            jdbc.update("update batch_jobs set suspicious_tx_count=8 where job_id=?", id);
            if (committed.incrementAndGet() < 3)
              throw new org.springframework.dao.DataAccessResourceFailureException(
                  "simulated DB outage");
          }
        };
    AnalysisRunner runner = runner(executor);
    runner.scan();
    assertThat(
            jdbc.queryForObject(
                "select suspicious_tx_count from batch_jobs where job_id=?", Integer.class, id))
        .isNull();
    clock.advance(30);
    runner.scan();
    clock.advance(120);
    runner.scan();
    assertThat(prepared).hasValue(1);
    assertThat(committed).hasValue(3);
    assertThat(service.job(id).stage()).isEqualTo(AnalysisStage.INFERENCE);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_failures where job_id=?", Integer.class, id))
        .isEqualTo(2);
  }

  @Test
  void live_runner_cannot_be_stolen_by_second_runner() throws Exception {
    long id = stageJob();
    var entered = new java.util.concurrent.CountDownLatch(1);
    var release = new java.util.concurrent.CountDownLatch(1);
    AnalysisRunner first =
        runner(
            c -> {
              entered.countDown();
              try {
                if (!release.await(10, java.util.concurrent.TimeUnit.SECONDS))
                  throw new AssertionError("release timeout");
              } catch (InterruptedException e) {
                throw new AssertionError(e);
              }
              return new AnalysisStageExecutor.Result("live");
            });
    try (var threads = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      var task = threads.submit(first::scan);
      try {
        assertThat(entered.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        UUID token = service.job(id).executionId();
        runner(
                c -> {
                  throw new AssertionError("stolen execution");
                })
            .scan();
        assertThat(service.job(id).executionId()).isEqualTo(token);
      } finally {
        release.countDown();
      }
      task.get(10, java.util.concurrent.TimeUnit.SECONDS);
    }
    assertThat(service.job(id).stage()).isEqualTo(AnalysisStage.INFERENCE);
  }

  @Test
  void generic_commit_failure_uses_three_failure_policy_and_reuses_prepared_result() {
    long id = stageJob();
    AtomicInteger prepared = new AtomicInteger();
    AnalysisRunner runner =
        runner(
            new AnalysisStageExecutor() {
              public Result prepare(Context c) {
                prepared.incrementAndGet();
                return new Result("prepared");
              }

              public void commit(Context c, Result result) {
                throw new IllegalStateException("fixture calculation failure");
              }
            });
    for (int i = 0; i < 3; i++) {
      runner.scan();
      runner.scan();
      clock.advance(i == 0 ? 60 : 300);
    }
    assertThat(service.job(id).status()).isEqualTo("FAILED");
    assertThat(service.job(id).failures()).isEqualTo(3);
    assertThat(prepared).hasValue(1);
  }

  @Test
  void pending_commit_owner_keeps_leadership_between_scans() {
    long id = stageJob();
    AtomicInteger prepared = new AtomicInteger(), committed = new AtomicInteger();
    AnalysisRunner first =
        runner(
            new AnalysisStageExecutor() {
              public Result prepare(Context c) {
                prepared.incrementAndGet();
                return new Result("prepared");
              }

              public void commit(Context c, Result result) {
                if (committed.incrementAndGet() == 1)
                  throw new org.springframework.dao.DataAccessResourceFailureException("fixture");
              }
            });
    first.scan();
    UUID token = service.job(id).executionId();
    runner(
            c -> {
              throw new AssertionError("pending owner was stolen");
            })
        .scan();
    assertThat(service.job(id).executionId()).isEqualTo(token);
    clock.advance(30);
    first.scan();
    assertThat(prepared).hasValue(1);
    assertThat(service.job(id).stage()).isEqualTo(AnalysisStage.INFERENCE);
  }

  @Test
  void custom_cutoff_drives_cron_and_snapshot_and_start_is_preserved() {
    service =
        new AnalysisService(
            jdbc, new TransactionTemplate(manager), clock, "Asia/Seoul", 0.7, LocalTime.of(4, 30));
    assertThat(service.cron()).isEqualTo("0 30 4 * * *");
    long included = upload("RUNNING", clock.instant().plusSeconds(5400));
    long id = service.registerScheduled();
    assertThat(
            jdbc.queryForList(
                "select upload_id from analysis_uploads where job_id=?", Long.class, id))
        .containsExactly(included);
    jdbc.update("update batch_jobs set current_stage='FEATURES' where job_id=?", id);
    AnalysisRunner runner =
        runner(
            c -> {
              throw new AnalysisFailure("CONFIG", AnalysisFailure.Kind.PERMANENT);
            });
    runner.scan();
    Object started = service.detail(id).get("startedAt");
    assertThat(started).isEqualTo(clock.instant());
    clock.advance(600);
    service.resume(id);
    runner.scan();
    assertThat(service.detail(id).get("startedAt")).isEqualTo(started);
  }
}
