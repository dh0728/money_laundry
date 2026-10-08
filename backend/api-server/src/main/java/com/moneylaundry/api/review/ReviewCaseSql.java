package com.moneylaundry.api.review;

/** Published lifecycle and per-case risk are separate read projections. */
final class ReviewCaseSql {
  private ReviewCaseSql() {}

  static final String PUBLISHED =
      """
      (select c.* from review.cases c where c.kind='EPISODE'
       or (c.published_version is not null and c.merged_into_alert_id is null))
      """;

  static final String WITH_RISK = "(select c.*,c.risk_score as risk from " + PUBLISHED + " c)";

  // Only list fields cross the JDBC boundary. Detailed aggregates stay in the
  // stored summary and are available through the selected case's detail API.
  static final String LIST_COLUMNS =
      """
      c.case_id,c.kind,c.alert_id,c.status,c.outcome,c.revision,
      c.assignee_id,c.created_at,c.assigned_at,c.closed_at,
      c.published_version,c.review_started_at,
      (select jsonb_object_agg(key,value) from jsonb_each(c.summary)
       where key in ('txCount','subjectCount','seedCount','riskScore','primaryType',
         'totalAmountUsd','amountsByCurrency','firstTxAt','lastTxAt',
         'pendingCount','sourceAlertIds','primaryTypes')) as summary
      """;
}
