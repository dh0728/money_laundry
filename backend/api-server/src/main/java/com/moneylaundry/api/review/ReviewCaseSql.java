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
}
