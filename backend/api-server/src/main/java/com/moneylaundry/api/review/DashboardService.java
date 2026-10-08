package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

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

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
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
            "select coalesce(sum(n) filter(where status='OPEN'),0)::bigint as pending,coalesce(sum(n) filter(where status='OPEN' and assigned_at<=?),0)::bigint as aged,coalesce(sum(n) filter(where status='CLOSED' and closed_by=? and closed_at>=? and closed_at<?),0)::bigint as closed from "
                + "ops.dashboard_case_counts"
                + " where assignee_id=?",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            user,
            at(from),
            at(to.plusDays(1)),
            user));
    out.put(
        "institution",
        jdbc.queryForMap(
            "select coalesce(sum(n) filter(where kind='ALERT' and status='OPEN'),0)::bigint as alerts,coalesce(sum(n) filter(where kind='EPISODE' and status='OPEN'),0)::bigint as episodes,coalesce(sum(n) filter(where status='OPEN' and assigned_at<=?),0)::bigint as aged,coalesce(sum(n) filter(where kind='ALERT' and created_at>=? and created_at<?),0)::bigint as today,coalesce(sum(n) filter(where kind='ALERT' and created_at>=? and created_at<?),0)::bigint as yesterday from "
                + "ops.dashboard_case_counts",
            Timestamp.from(now.minus(Duration.ofDays(3))),
            at(today),
            at(today.plusDays(1)),
            at(today.minusDays(1)),
            at(today)));
    out.put(
        "openAlertsAgedOver3Days",
        jdbc.queryForObject(
            "select coalesce(sum(n),0)::bigint from "
                + "ops.dashboard_case_counts"
                + " where kind='ALERT' and status='OPEN' and assigned_at<=?",
            Long.class,
            Timestamp.from(now.minus(Duration.ofDays(3)))));
    out.put("episodeWork", episodeWork(now, from, to));
    // Today may include delayed batches; use their delivery dates, not only wall-clock yesterday.
    var deliveryDates =
        jdbc.queryForList(
            "select business_date from ops.dashboard_delivery_days where detected_day>=(?::timestamptz at time zone 'Asia/Seoul')::date and detected_day<(?::timestamptz at time zone 'Asia/Seoul')::date order by 1",
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
            "select coalesce(sum(n),0)::bigint from ops.dashboard_report_counts where business_date in ("
                + placeholders
                + ")",
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
                + "ops.dashboard_case_items"
                + " where assignee_id=? and status='OPEN' order by risk desc,created_at,case_id limit 10",
            user));
    return out;
  }

  List<Map<String, Object>> daily(LocalDate from, LocalDate to) {
    // Aggregate each date range once, rather than counting the cases again for every day.
    return jdbc.queryForList(
        """
        with incoming as (
          select (created_at at time zone 'Asia/Seoul')::date as day,sum(n)::bigint as count
          from %s where kind='ALERT' and created_at>=? and created_at<?
          group by 1
        ), completed as (
          select (closed_at at time zone 'Asia/Seoul')::date as day,sum(n)::bigint as count
          from %s where kind='ALERT' and closed_at>=? and closed_at<?
          group by 1
        )
        select d::date as day,coalesce(i.count,0) as incoming,coalesce(c.count,0) as completed
        from generate_series(?::date::timestamp,?::date::timestamp,interval '1 day') d
        left join incoming i on i.day=d::date
        left join completed c on c.day=d::date order by d
        """
            .formatted("ops.dashboard_case_counts", "ops.dashboard_case_counts"),
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
            "select suspicious,type_class,sum(n)::bigint as count from ops.dashboard_model_counts "
                + "where detected_day>=(?::timestamptz at time zone 'Asia/Seoul')::date "
                + "and detected_day<(?::timestamptz at time zone 'Asia/Seoul')::date group by 1,2",
            at(from),
            at(to.plusDays(1)));
    return distribution(counts);
  }

  Map<String, Object> scoreWidgets(
      LocalDate from, LocalDate to, LocalDate today, List<java.sql.Date> deliveryDates) {
    var args =
        new ArrayList<Object>(
            List.of(
                java.sql.Date.valueOf(today),
                java.sql.Date.valueOf(from),
                java.sql.Date.valueOf(to)));
    args.addAll(deliveryDates);
    args.addAll(List.of(java.sql.Date.valueOf(from), java.sql.Date.valueOf(to)));
    var counts =
        jdbc.queryForList(
            "select business_date,detected_day=? as analyzed_today,detected_day between ? and ? as in_period,"
                + "suspicious,type_class,sum(n)::bigint as count from ops.dashboard_model_counts where business_date in ("
                + String.join(",", Collections.nCopies(deliveryDates.size(), "?"))
                + ") or detected_day between ? and ? group by 1,2,3,4,5",
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
            coalesce(sum(n) filter(where not c.linked and c.status='OPEN'),0)::bigint as pending,
            coalesce(sum(n) filter(where c.episode_status='OPEN'),0)::bigint as in_progress,
            coalesce(sum(n) filter(where c.episode_status='CLOSED'
              or (not c.linked and c.status='CLOSED')),0)::bigint as done
          from ops.dashboard_case_counts c
          where c.kind='ALERT' and c.created_at>=? and c.created_at<?
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
        "from (select c.*,case when first_review<=? then first_review end as visible_review from ops.dashboard_case_counts c) c where c.kind='EPISODE' and c.created_at<=? ";
    var result = new LinkedHashMap<String, Object>();
    result.put("asOf", now.toString());
    result.put(
        "current",
        jdbc.queryForMap(
            "select coalesce(sum(n) filter(where c.status='OPEN'),0)::bigint as open,coalesce(sum(n) filter(where c.status='OPEN' and c.assigned_at<=?),0)::bigint as aged,coalesce(sum(n) filter(where c.status='OPEN' and c.visible_review is null),0)::bigint as unreviewed,coalesce(sum(n) filter(where c.created_at>=?),0)::bigint as created_today,coalesce(sum(n) filter(where c.status='CLOSED' and c.closed_at>=? and c.closed_at<=?),0)::bigint as closed_today "
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
            "select coalesce(sum(n),0)::bigint as samples,sum(n*extract(epoch from (c.visible_review-c.assigned_at)))/nullif(sum(n),0) as average_seconds "
                + base
                + " and c.visible_review>=? and c.visible_review<?",
            Timestamp.from(now),
            Timestamp.from(now),
            at(from),
            at(to.plusDays(1))));
    result.put(
        "completion",
        jdbc.queryForMap(
            "select coalesce(sum(n),0)::bigint as samples,sum(n*extract(epoch from (c.closed_at-c.created_at)))/nullif(sum(n),0) as average_seconds "
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
            "select case_id as \"caseId\",assignee,extract(epoch from (?::timestamptz-assigned_at)) as age_seconds,(first_review is null or first_review>?) as awaiting_review from ops.dashboard_case_items where kind='EPISODE' and status='OPEN' and created_at<=? order by assigned_at,case_id limit 20",
            Timestamp.from(now),
            Timestamp.from(now),
            Timestamp.from(now)));
    return result;
  }
}
