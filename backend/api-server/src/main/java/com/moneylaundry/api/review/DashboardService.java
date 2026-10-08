package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
  // Whole-period aggregates need a set of published scores, not one lookup per ledger row.
  // Select the latest eligible result before applying the displayed detection date range.
  static final String SCORE_BASE =
      """
      from ledger.transactions t
      left join (
        select i.*,j.job_id,j.threshold_value,j.business_at as detected_at
        from analysis.current_scores c join analysis.scores i using(run_id,tx_id)
        join analysis.runs ar on ar.run_id=i.run_id
        join analysis.jobs j on j.job_id=ar.job_id and j.current_run_id=ar.run_id
        where j.status='COMPLETED' and ar.status='COMPLETED'
      ) s on s.tx_id=t.tx_id
      left join lateral (
        select s.type_class::bigint as type_class
        where s.job_id is not null
      ) w on true
      where t.integration_status='ACTIVE'
      """;

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
            "select count(*) filter(where status='OPEN') as pending,count(*) filter(where status='OPEN' and assigned_at<=?) as aged,count(*) filter(where status='CLOSED' and closed_by=? and closed_at>=? and closed_at<?) as closed from "
                + ReviewCaseSql.PUBLISHED
                + " where assignee_id=?",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            user,
            at(from),
            at(to.plusDays(1)),
            user));
    out.put(
        "institution",
        jdbc.queryForMap(
            "select count(*) filter(where kind='ALERT' and status='OPEN') as alerts,count(*) filter(where kind='EPISODE' and status='OPEN') as episodes,count(*) filter(where status='OPEN' and assigned_at<=?) as aged,count(*) filter(where kind='ALERT' and created_at>=? and created_at<?) as today,count(*) filter(where kind='ALERT' and created_at>=? and created_at<?) as yesterday from "
                + ReviewCaseSql.PUBLISHED
                + "",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            at(today),
            at(today.plusDays(1)),
            at(today.minusDays(1)),
            at(today)));
    out.put(
        "openAlertsAgedOver3Days",
        jdbc.queryForObject(
            "select count(*) from "
                + ReviewCaseSql.PUBLISHED
                + " where kind='ALERT' and status='OPEN' and assigned_at<=?",
            Long.class,
            Timestamp.from(now.minus(Duration.ofDays(3)))));
    out.put("episodeWork", episodeWork(now, from, to));
    // Today may include delayed batches; use their delivery dates, not only wall-clock yesterday.
    var deliveryDates =
        jdbc.queryForList(
            "select distinct analysis_date-1 from analysis.jobs where true and business_at>=? and business_at<? and analysis_date is not null order by 1",
            java.sql.Date.class,
            at(today),
            at(today.plusDays(1)));
    if (deliveryDates.isEmpty()) deliveryDates = List.of(java.sql.Date.valueOf(today.minusDays(1)));
    String placeholders = String.join(",", Collections.nCopies(deliveryDates.size(), "?"));
    out.putAll(scoreWidgets(from, to, today, deliveryDates));
    out.put(
        "deliveryDate", String.join(", ", deliveryDates.stream().map(Object::toString).toList()));
    out.put(
        "pendingReports",
        jdbc.queryForObject(
            "select count(*) from ingest.uploads b left join ingest.report_versions v on v.upload_id=b.upload_id where true and b.business_date in ("
                + placeholders
                + ") and b.status<>'EXPIRED' and v.stage_status is distinct from 'SUPERSEDED' and (b.status<>'COMPLETED' or v.stage_status is distinct from 'ACTIVE')",
            Long.class,
            deliveryDates.toArray()));
    out.put("daily", daily(from, to));
    out.put("dailyAlertStatus", dailyAlertStatus(from, to));
    out.put(
        "activities",
        jdbc.queryForList(
            "select event_id,case_id,action,comment,business_at from review.event_history where actor_id=? and business_at>=? and business_at<? order by business_at desc,event_id desc limit 20",
            user,
            at(from),
            at(to.plusDays(1))));
    out.put(
        "priority",
        jdbc.queryForList(
            "select case_id,kind,alert_id,created_at,risk from "
                + ReviewCaseSql.WITH_RISK
                + " where assignee_id=? and status='OPEN' order by risk desc,created_at,case_id limit 10",
            user));
    return out;
  }

  List<Map<String, Object>> daily(LocalDate from, LocalDate to) {
    // Aggregate each date range once, rather than counting the cases again for every day.
    return jdbc.queryForList(
        """
        with incoming as (
          select (created_at at time zone 'Asia/Seoul')::date as day,count(*) as count
          from %s where kind='ALERT' and created_at>=? and created_at<?
          group by 1
        ), completed as (
          select (closed_at at time zone 'Asia/Seoul')::date as day,count(*) as count
          from %s where kind='ALERT' and closed_at>=? and closed_at<?
          group by 1
        )
        select d::date as day,coalesce(i.count,0) as incoming,coalesce(c.count,0) as completed
        from generate_series(?::date::timestamp,?::date::timestamp,interval '1 day') d
        left join incoming i on i.day=d::date
        left join completed c on c.day=d::date order by d
        """
            .formatted(ReviewCaseSql.PUBLISHED, ReviewCaseSql.PUBLISHED),
        at(from),
        at(to.plusDays(1)),
        at(from),
        at(to.plusDays(1)),
        java.sql.Date.valueOf(from),
        java.sql.Date.valueOf(to));
  }

  Map<String, Object> modelDistribution(LocalDate from, LocalDate to) {
    // The two widgets use the same published scores and detection period.
    var counts =
        jdbc.queryForList(
            "select s.p_laundering>=s.threshold_value as suspicious,w.type_class,count(*) as count "
                + SCORE_BASE
                + " and s.detected_at>=? and s.detected_at<? group by 1,2",
            at(from),
            at(to.plusDays(1)));
    return distribution(counts);
  }

  Map<String, Object> scoreWidgets(
      LocalDate from, LocalDate to, LocalDate today, List<java.sql.Date> deliveryDates) {
    var args =
        new ArrayList<Object>(
            List.of(at(today), at(today.plusDays(1)), at(from), at(to.plusDays(1))));
    args.addAll(deliveryDates);
    args.addAll(List.of(at(from), at(to.plusDays(1))));
    // Reception and model widgets share the current score join. Aggregate once
    // while preserving their different business-date / detection-date filters.
    var counts =
        jdbc.queryForList(
            """
        select t.business_date,s.detected_at>=? and s.detected_at<? as analyzed_today,
          s.detected_at>=? and s.detected_at<? as in_period,
          s.p_laundering>=s.threshold_value as suspicious,w.type_class,count(*) as count
        """
                + SCORE_BASE
                + " and (t.business_date in ("
                + String.join(",", Collections.nCopies(deliveryDates.size(), "?"))
                + ") or (s.detected_at>=? and s.detected_at<?)) group by 1,2,3,4,5",
            args.toArray());
    var selectedDays = new HashSet<>(deliveryDates);
    long received = 0, analyzed = 0, suspicious = 0;
    var period = new ArrayList<Map<String, Object>>();
    for (var row : counts) {
      long count = ((Number) row.get("count")).longValue();
      if (selectedDays.contains(row.get("business_date"))) {
        received += count;
        if (Boolean.TRUE.equals(row.get("analyzed_today"))) {
          analyzed += count;
          if (Boolean.TRUE.equals(row.get("suspicious"))) suspicious += count;
        }
      }
      if (Boolean.TRUE.equals(row.get("in_period"))) period.add(row);
    }
    var result = new LinkedHashMap<>(distribution(period));
    result.put(
        "detection", Map.of("received", received, "analyzed", analyzed, "suspicious", suspicious));
    return result;
  }

  private Map<String, Object> distribution(List<Map<String, Object>> counts) {
    var agreements = new TreeMap<String, Long>();
    var types = new TreeMap<Long, Long>();
    for (var row : counts) {
      boolean suspicious = Boolean.TRUE.equals(row.get("suspicious"));
      long type = ((Number) row.get("type_class")).longValue();
      long count = ((Number) row.get("count")).longValue();
      String agreement =
          suspicious ? (type == 0 ? "ATYPICAL" : "STRONG") : (type == 0 ? "WEAK" : "PATTERN_ONLY");
      agreements.merge(agreement, count, Long::sum);
      if (suspicious) types.merge(type, count, Long::sum);
    }
    return Map.of(
        "agreements",
        agreements.entrySet().stream()
            .map(e -> Map.of("agreement", e.getKey(), "count", e.getValue()))
            .toList(),
        "types",
        types.entrySet().stream()
            .map(e -> Map.of("type", e.getKey(), "count", e.getValue()))
            .toList());
  }

  List<Map<String, Object>> dailyAlertStatus(LocalDate from, LocalDate to) {
    // One row per published Alert, independent of evidence versions or transaction count.
    // Do not use the risk projection: this chart only needs lifecycle and membership.
    return jdbc.queryForList(
        """
        with counts as (
          select (c.created_at at time zone 'Asia/Seoul')::date as day,
            count(*) filter(where e.alert_id is null and c.status='OPEN') as pending,
            count(*) filter(where ep.status='OPEN') as in_progress,
            count(*) filter(where ep.status='CLOSED'
              or (e.alert_id is null and c.status='CLOSED')) as done
          from review.cases c
          left join review.episode_alerts e on e.alert_id=c.alert_id
          left join review.cases ep on ep.case_id=e.episode_id
          where c.kind='ALERT' and c.created_at>=? and c.created_at<?
            and c.published_version is not null and c.merged_into_alert_id is null
          group by 1
        )
        select to_char(d,'YYYY-MM-DD') as date,coalesce(c.pending,0) as pending,
          coalesce(c.in_progress,0) as "inProgress",coalesce(c.done,0) as done
        from generate_series(?::date::timestamp,?::date::timestamp,interval '1 day') d
        left join counts c on c.day=d::date order by d
        """,
        at(from),
        at(to.plusDays(1)),
        java.sql.Date.valueOf(from),
        java.sql.Date.valueOf(to));
  }

  Map<String, Object> episodeWork(Instant now, LocalDate from, LocalDate to) {
    var today = now.atZone(BusinessTime.KST).toLocalDate();
    String base =
        """
      from review.cases c left join lateral (
        select min(e.business_at) as first_review from review.event_history e
        where e.case_id=c.case_id and e.actor_id=c.assignee_id and e.action='REVIEW_START'
          and e.business_at>=c.assigned_at and e.business_at<=?
      ) r on true where c.kind='EPISODE' and c.created_at<=?
      """;
    var result = new LinkedHashMap<String, Object>();
    result.put("asOf", now.toString());
    result.put(
        "current",
        jdbc.queryForMap(
            "select count(*) filter(where c.status='OPEN') as open,count(*) filter(where c.status='OPEN' and c.assigned_at<=?) as aged,count(*) filter(where c.status='OPEN' and r.first_review is null) as unreviewed,count(*) filter(where c.created_at>=?) as created_today,count(*) filter(where c.status='CLOSED' and c.closed_at>=? and c.closed_at<=?) as closed_today "
                + base,
            Timestamp.from(now.minus(Duration.ofDays(3))),
            at(today),
            at(today),
            Timestamp.from(now),
            Timestamp.from(now),
            Timestamp.from(now)));
    result.put(
        "firstReview",
        jdbc.queryForMap(
            "select count(*) as samples,avg(extract(epoch from (r.first_review-c.assigned_at))) as average_seconds "
                + base
                + " and r.first_review>=? and r.first_review<?",
            Timestamp.from(now),
            Timestamp.from(now),
            at(from),
            at(to.plusDays(1))));
    result.put(
        "completion",
        jdbc.queryForMap(
            "select count(*) as samples,avg(extract(epoch from (c.closed_at-c.created_at))) as average_seconds "
                + base
                + " and c.status='CLOSED' and c.closed_at>=? and c.closed_at<? and c.closed_at<=?",
            Timestamp.from(now),
            Timestamp.from(now),
            at(from),
            at(to.plusDays(1)),
            Timestamp.from(now)));
    result.put(
        "oldestOpen",
        jdbc.queryForList(
            "select c.case_id as \"caseId\",u.name as assignee,extract(epoch from (?::timestamptz-c.assigned_at)) as age_seconds,(r.first_review is null) as awaiting_review from review.cases c join core.users u on u.user_id=c.assignee_id left join lateral (select min(e.business_at) as first_review from review.event_history e where e.case_id=c.case_id and e.actor_id=c.assignee_id and e.action='REVIEW_START' and e.business_at>=c.assigned_at and e.business_at<=?) r on true where c.kind='EPISODE' and c.status='OPEN' and c.created_at<=? order by c.assigned_at,c.case_id limit 20",
            Timestamp.from(now),
            Timestamp.from(now),
            Timestamp.from(now)));
    return result;
  }
}
