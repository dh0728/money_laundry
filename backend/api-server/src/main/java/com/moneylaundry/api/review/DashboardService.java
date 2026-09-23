package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
  private final JdbcTemplate jdbc;
  private final BusinessTime time;

  public DashboardService(JdbcTemplate jdbc, BusinessTime time) {
    this.jdbc = jdbc;
    this.time = time;
  }

  private Timestamp at(LocalDate d) {
    return Timestamp.from(d.atStartOfDay(BusinessTime.KST).toInstant());
  }

  public Map<String, Object> view(long user, LocalDate from, LocalDate to) {
    if (from == null || to == null || from.isAfter(to) || from.plusYears(2).isBefore(to))
      throw AnalysisService.invalid();
    Instant now = time.now();
    LocalDate today = now.atZone(BusinessTime.KST).toLocalDate();
    var out = new LinkedHashMap<String, Object>();
    out.put("businessAt", now.toString());
    out.put(
        "personal",
        jdbc.queryForMap(
            "select count(*) filter(where status='OPEN') as pending,count(*) filter(where status='OPEN' and assigned_at<=?) as aged,count(*) filter(where status='CLOSED' and closed_by=? and closed_at>=? and closed_at<?) as closed from visible_review_cases where assignee_id=?",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            user,
            at(from),
            at(to.plusDays(1)),
            user));
    out.put(
        "institution",
        jdbc.queryForMap(
            "select count(*) filter(where kind='ALERT' and status='OPEN') as alerts,count(*) filter(where kind='EPISODE' and status='OPEN') as episodes,count(*) filter(where status='OPEN' and assigned_at<=?) as aged,count(*) filter(where kind='ALERT' and created_at>=? and created_at<?) as today,count(*) filter(where kind='ALERT' and created_at>=? and created_at<?) as yesterday from visible_review_cases",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            at(today),
            at(today.plusDays(1)),
            at(today.minusDays(1)),
            at(today)));
    // Today may include delayed batches; use their delivery dates, not only wall-clock yesterday.
    var deliveryDates =
        jdbc.queryForList(
            "select distinct analysis_date-1 from batch_jobs where job_type='ANALYSIS' and business_at>=? and business_at<? and analysis_date is not null order by 1",
            java.sql.Date.class,
            at(today),
            at(today.plusDays(1)));
    if (deliveryDates.isEmpty()) deliveryDates = List.of(java.sql.Date.valueOf(today.minusDays(1)));
    String placeholders = String.join(",", Collections.nCopies(deliveryDates.size(), "?"));
    var detectionArgs =
        new ArrayList<Object>(
            List.of(at(today), at(today.plusDays(1)), at(today), at(today.plusDays(1))));
    detectionArgs.addAll(deliveryDates);
    out.put(
        "detection",
        jdbc.queryForMap(
            "select count(*) as received,count(*) filter(where s.detected_at>=? and s.detected_at<?) as analyzed,count(*) filter(where s.detected_at>=? and s.detected_at<? and s.p_laundering>=s.threshold_value) as suspicious "
                + LedgerQueryService.BASE
                + " and t.business_date in ("
                + placeholders
                + ")",
            detectionArgs.toArray()));
    out.put(
        "deliveryDate", String.join(", ", deliveryDates.stream().map(Object::toString).toList()));
    out.put(
        "pendingReports",
        jdbc.queryForObject(
            "select count(*) from batch_jobs b left join report_versions v on v.upload_id=b.job_id where b.job_type='INGEST' and b.business_date in ("
                + placeholders
                + ") and b.status<>'EXPIRED' and v.stage_status is distinct from 'SUPERSEDED' and (b.status<>'COMPLETED' or v.stage_status is distinct from 'ACTIVE')",
            Long.class,
            deliveryDates.toArray()));
    out.put(
        "daily",
        jdbc.queryForList(
            "select (d AT TIME ZONE 'Asia/Seoul')::date as day,(select count(*) from visible_review_cases where kind='ALERT' and created_at>=d and created_at<d+interval '1 day') as incoming,(select count(*) from visible_review_cases where kind='ALERT' and closed_at>=d and closed_at<d+interval '1 day') as completed from generate_series(?::timestamptz,?::timestamptz,interval '1 day') d",
            at(from),
            at(to)));
    out.put(
        "agreements",
        jdbc.queryForList(
            "select case when s.p_laundering>=s.threshold_value then case when w.type_class=0 then 'ATYPICAL' else 'STRONG' end else case when w.type_class=0 then 'WEAK' else 'PATTERN_ONLY' end end as agreement,count(*) as count "
                + LedgerQueryService.BASE
                + " and s.detected_at>=? and s.detected_at<? group by 1 order by 1",
            at(from),
            at(to.plusDays(1))));
    out.put(
        "types",
        jdbc.queryForList(
            "select w.type_class as type,count(*) as count "
                + LedgerQueryService.BASE
                + " and s.detected_at>=? and s.detected_at<? and s.p_laundering>=s.threshold_value group by 1 order by 1",
            at(from),
            at(to.plusDays(1))));
    out.put(
        "activities",
        jdbc.queryForList(
            "select event_id,case_id,action,comment,business_at from review_events where actor_id=? and business_at>=? and business_at<? order by business_at desc,event_id desc limit 20",
            user,
            at(from),
            at(to.plusDays(1))));
    out.put(
        "priority",
        jdbc.queryForList(
            "select case_id,kind,alert_id,created_at,risk from visible_review_cases where assignee_id=? and status='OPEN' order by risk desc,created_at,case_id limit 10",
            user));
    return out;
  }
}
