package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class StaffAssignmentTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @MockitoBean AnalysisScheduler scheduler;
  List<Long> staff;

  @BeforeEach
  void setup() {
    jdbc.update("update core.users set password_hash=null,last_assigned_at=null");
    staff =
        jdbc.queryForList(
            "select user_id from core.users where role='STAFF' order by user_id limit 3",
            Long.class);
    for (long id : staff)
      jdbc.update("update core.users set password_hash='test-only' where user_id=?", id);
    jdbc.update("update ops.business_clock set business_at='2023-09-01',revision=revision+1");
  }

  @Test
  void rotatesWithinOneBatchDespiteEqualFutureHistoryAndPastBusinessTime() {
    jdbc.update(
        "update core.users set last_assigned_at='2099-01-01' where password_hash is not null");
    tx.executeWithoutResult(
        status -> {
          for (int i = 0; i < 12; i++)
            assertThat(StaffAssignment.next(jdbc)).isEqualTo(staff.get(i % 3));
        });
    assertThat(
            jdbc.queryForObject(
                "select min(last_assigned_at)>'2099-01-01' from core.users where password_hash is not null",
                Boolean.class))
        .isTrue();
  }

  @Test
  void rotatesFromMixedHistoryAndNullWithoutRestoringOldBusinessTime() {
    jdbc.update(
        "update core.users set last_assigned_at='2099-01-01' where user_id=?", staff.get(0));
    jdbc.update(
        "update core.users set last_assigned_at='2023-09-01' where user_id=?", staff.get(1));
    var expected = List.of(staff.get(2), staff.get(1), staff.get(0));
    for (int i = 0; i < 9; i++) {
      long actual = tx.execute(status -> StaffAssignment.next(jdbc));
      assertThat(actual).isEqualTo(expected.get(i % 3));
    }
  }

  @Test
  void rollbackDoesNotConsumeTurnAndNoEligibleStaffFails() {
    tx.executeWithoutResult(
        status -> {
          assertThat(StaffAssignment.next(jdbc)).isEqualTo(staff.getFirst());
          status.setRollbackOnly();
        });
    long next = tx.execute(status -> StaffAssignment.next(jdbc));
    assertThat(next).isEqualTo(staff.getFirst());
    jdbc.update("update core.users set password_hash=null");
    assertThatThrownBy(() -> tx.execute(status -> StaffAssignment.next(jdbc)))
        .isInstanceOfSatisfying(
            com.moneylaundry.api.analysis.AnalysisFailure.class,
            error -> {
              assertThat(error.code()).isEqualTo("ALERT_ASSIGNEE_UNAVAILABLE");
              assertThat(error.kind())
                  .isEqualTo(com.moneylaundry.api.analysis.AnalysisFailure.Kind.PERMANENT);
            });
    assertThatThrownBy(() -> StaffAssignment.next(jdbc))
        .hasMessage("ASSIGNMENT_REQUIRES_TRANSACTION");
  }

  @Test
  void concurrentTransactionsShareOneRotation() throws Exception {
    var start = new CountDownLatch(1);
    try (var pool = Executors.newFixedThreadPool(3)) {
      List<Future<Long>> futures = new ArrayList<>();
      for (int i = 0; i < 12; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return tx.execute(status -> StaffAssignment.next(jdbc));
                }));
      start.countDown();
      Map<Long, Integer> counts = new HashMap<>();
      for (var f : futures) counts.merge(f.get(20, TimeUnit.SECONDS), 1, Integer::sum);
      assertThat(counts.keySet()).containsExactlyInAnyOrderElementsOf(staff);
      assertThat(counts.values()).containsOnly(4);
    }
  }
}
