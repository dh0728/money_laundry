package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisFailure;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Serializes the shared Alert/Episode rotation independently of business time. */
final class StaffAssignment {
  private StaffAssignment() {}

  static long next(JdbcTemplate jdbc) {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("ASSIGNMENT_REQUIRES_TRANSACTION");
    jdbc.queryForList("select pg_advisory_xact_lock(17002004)");
    var staff =
        jdbc.queryForList(
            "select u.user_id from core.users u join core.assignable_staff s using(user_id) order by u.last_assigned_at nulls first,u.user_id limit 1 for update of u");
    if (staff.isEmpty())
      throw new AnalysisFailure("ALERT_ASSIGNEE_UNAVAILABLE", AnalysisFailure.Kind.PERMANENT);
    long user = ((Number) staff.getFirst().get("user_id")).longValue();
    // Strictly advance even with imported future timestamps or a backwards DB clock.
    jdbc.update(
        "update core.users set last_assigned_at=greatest(clock_timestamp(),(select max(u.last_assigned_at)+interval '1 microsecond' from core.users u join core.assignable_staff s using(user_id))) where user_id=?",
        user);
    return user;
  }
}
