package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.review.DashboardLists.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

final class DashboardQueries {
  private final JdbcTemplate jdbc;
  private final BusinessTime time;

  DashboardQueries(JdbcTemplate jdbc, BusinessTime time) {
    this.jdbc = jdbc;
    this.time = time;
  }

  private Timestamp at(LocalDate d) {
    return Timestamp.from(d.atStartOfDay(BusinessTime.KST).toInstant());
  }

  public DashboardSummary view(long user, LocalDate from, LocalDate to) {
    if (from == null || to == null || from.isAfter(to) || from.plusYears(2).isBefore(to))
      throw AnalysisService.invalid();
    Instant now = time.now();
    LocalDate today = now.atZone(BusinessTime.KST).toLocalDate();
    var out = new LinkedHashMap<String, Object>();
    out.putAll(caseWidgets(user, now, from, to));
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
        "pendingReports",
        jdbc.queryForObject(
            "select coalesce(sum(n),0)::bigint from ops.dashboard_report_counts where business_date in ("
                + placeholders
                + ")",
            Long.class,
            deliveryDates.toArray()));
    var days = dailyCharts(from, to);
    out.put("daily", days);
    out.put("dailyAlertStatus", days);
    var computed = new HashMap<String, Instant>();
    jdbc.query(
        "select scope,computed_at from ops.dashboard_refresh_state",
        (org.springframework.jdbc.core.RowCallbackHandler)
            row -> {
              var timestamp = row.getTimestamp("computed_at");
              computed.put(
                  row.getString("scope"), timestamp == null ? null : timestamp.toInstant());
            });
    return DashboardSummary.assemble(now, from, to, computed, out, deliveryDates);
  }

  List<Map<String, Object>> daily(LocalDate from, LocalDate to) {
    return dailyCharts(from, to);
  }

  private List<Map<String, Object>> dailyCharts(LocalDate from, LocalDate to) {
    return jdbc.queryForList(
        """
      with incoming as (
        select (created_at at time zone 'Asia/Seoul')::date as day,sum(n)::bigint as incoming,
          coalesce(sum(n) filter(where not linked and status='OPEN'),0)::bigint as pending,
          coalesce(sum(n) filter(where episode_status='OPEN'),0)::bigint as in_progress,
          coalesce(sum(n) filter(where episode_status='CLOSED' or (not linked and status='CLOSED')),0)::bigint as done
        from ops.dashboard_case_counts where kind='ALERT' and created_at>=? and created_at<? group by 1
      ), completed as (
        select (closed_at at time zone 'Asia/Seoul')::date as day,sum(n)::bigint as completed
        from ops.dashboard_case_counts where kind='ALERT' and closed_at>=? and closed_at<? group by 1
      )
      select d::date as day,to_char(d,'YYYY-MM-DD') as date,coalesce(i.incoming,0) as incoming,
        coalesce(c.completed,0) as completed,coalesce(i.pending,0) as pending,
        coalesce(i.in_progress,0) as "inProgress",coalesce(i.done,0) as done
      from generate_series(?::date::timestamp,?::date::timestamp,interval '1 day') d
      left join incoming i on i.day=d::date left join completed c on c.day=d::date order by d
      """,
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
    return dailyCharts(from, to);
  }

  @SuppressWarnings("unchecked")
  Map<String, Object> episodeWork(Instant now, LocalDate from, LocalDate to) {
    return (Map<String, Object>) caseWidgets(0, now, from, to).get("episodeWork");
  }

  private Map<String, Object> caseWidgets(long user, Instant now, LocalDate from, LocalDate to) {
    var today = now.atZone(BusinessTime.KST).toLocalDate();
    var row =
        jdbc.queryForMap(
            """
      with p as (select ?::bigint as actor,?::timestamptz as current_at,?::timestamptz as aged,
        ?::timestamptz as today,?::timestamptz as tomorrow,?::timestamptz as yesterday,
        ?::timestamptz as start_at,?::timestamptz as end_at)
      select
      coalesce(sum(n) filter(where assignee_id=p.actor and status='OPEN'),0)::bigint as personal_pending,
      coalesce(sum(n) filter(where assignee_id=p.actor and status='OPEN' and assigned_at<=p.aged),0)::bigint as personal_aged,
      coalesce(sum(n) filter(where assignee_id=p.actor and status='CLOSED' and closed_by=p.actor and closed_at>=p.start_at and closed_at<p.end_at),0)::bigint as personal_closed,
      coalesce(sum(n) filter(where kind='ALERT' and status='OPEN'),0)::bigint as alerts,
      coalesce(sum(n) filter(where kind='EPISODE' and status='OPEN'),0)::bigint as episodes,
      coalesce(sum(n) filter(where status='OPEN' and assigned_at<=p.aged),0)::bigint as aged,
      coalesce(sum(n) filter(where kind='ALERT' and created_at>=p.today and created_at<p.tomorrow),0)::bigint as created_today,
      coalesce(sum(n) filter(where kind='ALERT' and created_at>=p.yesterday and created_at<p.today),0)::bigint as created_yesterday,
      coalesce(sum(n) filter(where kind='ALERT' and status='OPEN' and assigned_at<=p.aged),0)::bigint as alert_aged,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and status='OPEN'),0)::bigint as episode_open,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and status='OPEN' and assigned_at<=p.aged),0)::bigint as episode_aged,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and status='OPEN' and (first_review is null or first_review>p.current_at)),0)::bigint as episode_unreviewed,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and created_at>=p.today),0)::bigint as episode_created,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and status='CLOSED' and closed_at>=p.today and closed_at<=p.current_at),0)::bigint as episode_closed,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and first_review<=p.current_at and first_review>=p.start_at and first_review<p.end_at),0)::bigint as review_samples,
      coalesce(sum(n) filter(where kind='EPISODE' and created_at<=p.current_at and status='CLOSED' and closed_at<=p.current_at and closed_at>=p.start_at and closed_at<p.end_at),0)::bigint as completion_samples,
      sum(n*extract(epoch from (first_review-assigned_at))) filter(where kind='EPISODE' and created_at<=p.current_at and first_review<=p.current_at and first_review>=p.start_at and first_review<p.end_at) as review_seconds,
      sum(n*extract(epoch from (closed_at-created_at))) filter(where kind='EPISODE' and created_at<=p.current_at and status='CLOSED' and closed_at<=p.current_at and closed_at>=p.start_at and closed_at<p.end_at) as completion_seconds
      from ops.dashboard_case_counts cross join p
      """,
            user,
            Timestamp.from(now),
            Timestamp.from(now.minus(Duration.ofDays(3))),
            at(today),
            at(today.plusDays(1)),
            at(today.minusDays(1)),
            at(from),
            at(to.plusDays(1)));
    var work = new LinkedHashMap<String, Object>();
    work.put("asOf", now.toString());
    work.put(
        "current",
        Map.of(
            "open",
            row.get("episode_open"),
            "aged",
            row.get("episode_aged"),
            "unreviewed",
            row.get("episode_unreviewed"),
            "created_today",
            row.get("episode_created"),
            "closed_today",
            row.get("episode_closed")));
    work.put("firstReview", duration(row, "review"));
    work.put("completion", duration(row, "completion"));
    return Map.of(
        "personal",
        Map.of(
            "pending",
            row.get("personal_pending"),
            "aged",
            row.get("personal_aged"),
            "closed",
            row.get("personal_closed")),
        "institution",
        Map.of(
            "alerts",
            row.get("alerts"),
            "episodes",
            row.get("episodes"),
            "aged",
            row.get("aged"),
            "today",
            row.get("created_today"),
            "yesterday",
            row.get("created_yesterday")),
        "openAlertsAgedOver3Days",
        row.get("alert_aged"),
        "episodeWork",
        work);
  }

  private Map<String, Object> duration(Map<String, Object> row, String prefix) {
    long samples = ((Number) row.get(prefix + "_samples")).longValue();
    var result = new LinkedHashMap<String, Object>();
    result.put("samples", samples);
    result.put(
        "average_seconds",
        samples == 0 ? null : ((Number) row.get(prefix + "_seconds")).doubleValue() / samples);
    return result;
  }

  public List<Activity> activities(long user, LocalDate from, LocalDate to) {
    if (from == null || to == null || from.isAfter(to) || from.plusYears(2).isBefore(to))
      throw AnalysisService.invalid();
    return jdbc.query(
        "select event_id,case_id,action,comment,business_at from review.event_history where actor_id=? and business_at>=? and business_at<? order by business_at desc,event_id desc limit 20",
        (r, n) ->
            new Activity(
                r.getString("event_id"),
                r.getString("case_id"),
                r.getString("action"),
                r.getString("comment"),
                r.getTimestamp("business_at").toInstant()),
        user,
        at(from),
        at(to.plusDays(1)));
  }

  public Queues queues(long user) {
    Instant now = time.now();
    var priority =
        jdbc.query(
            "select case_id,kind,alert_id,created_at,risk from ops.dashboard_case_items where assignee_id=? and status='OPEN' order by risk desc,created_at,case_id limit 10",
            (r, n) ->
                new Priority(
                    r.getString("case_id"),
                    r.getString("kind"),
                    r.getString("alert_id"),
                    r.getTimestamp("created_at").toInstant(),
                    r.getDouble("risk")),
            user);
    var oldest =
        jdbc.query(
            "select case_id,assignee,extract(epoch from (?::timestamptz-assigned_at)) as age_seconds,(first_review is null or first_review>?) as awaiting_review from ops.dashboard_case_items where kind='EPISODE' and status='OPEN' and created_at<=? order by assigned_at,case_id limit 20",
            (r, n) ->
                new Oldest(
                    r.getString("case_id"),
                    r.getString("assignee"),
                    r.getDouble("age_seconds"),
                    r.getBoolean("awaiting_review")),
            Timestamp.from(now),
            Timestamp.from(now),
            Timestamp.from(now));
    return new Queues(now.toString(), priority, oldest);
  }
}
