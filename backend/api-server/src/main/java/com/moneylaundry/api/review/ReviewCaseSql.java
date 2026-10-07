package com.moneylaundry.api.review;

/** Published lifecycle and per-case risk are separate read projections. */
final class ReviewCaseSql {
  private ReviewCaseSql() {}

  static final String PUBLISHED =
      """
      (select c.* from review.cases c
       where c.kind='EPISODE' or exists (
         select 1 from review.alert_versions v join analysis.runs r using(run_id)
         join analysis.jobs j on j.job_id=r.job_id
         where v.alert_id=c.alert_id and r.status='COMPLETED' and j.status='COMPLETED'))
      """;

  // A scalar aggregate is bound to one case. An underestimated global risk set
  // must not turn into a cases x risks nested-loop scan before LIMIT.
  static final String WITH_RISK =
      """
      (select c.*,coalesce((select max(seed_risk) from (
        select t.seed_risk from review.saved_members m
        join review.alert_transactions t on t.alert_id=m.alert_id
          and t.version=m.evidence_version and t.tx_id=m.tx_id
        where m.case_id=c.case_id and m.state not in ('EXCLUDED','TRANSFERRED')
          and t.role='SEED'
        union all
        select t.seed_risk from review.latest_versions v
        join review.alert_transactions t using(alert_id,version)
        where c.kind='ALERT' and v.alert_id=c.alert_id and t.role='SEED'
          and (c.status='OPEN' or not exists (
            select 1 from review.alert_groups g where g.alert_id=c.alert_id))
          and not exists (select 1 from review.alert_members m
            where m.alert_id=c.alert_id and m.tx_id=t.tx_id)
      ) members),0) as risk from %s c)
      """
          .formatted(PUBLISHED);
}
