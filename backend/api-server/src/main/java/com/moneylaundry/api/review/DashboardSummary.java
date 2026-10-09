package com.moneylaundry.api.review;

import java.time.*;
import java.util.*;

/** Public dashboard contract. SQL aliases never cross the HTTP boundary. */
public record DashboardSummary(
    String businessAt,
    Range range,
    Section<Pipeline> pipeline,
    Section<Investigation> investigation) {
  public record Range(LocalDate from, LocalDate to) {}

  public record Section<T>(Instant computedAt, T data) {}

  public record Pipeline(
      Detection detection,
      List<Agreement> agreements,
      List<TypeCount> types,
      long pendingReports) {}

  public record Detection(
      long received, long analyzed, long suspicious, List<LocalDate> deliveryDates) {}

  public record Agreement(String agreement, long count) {}

  public record TypeCount(long type, long count) {}

  public record Personal(long pending, long aged, long closed) {}

  public record Institution(long alerts, long episodes, long aged, long today, long yesterday) {}

  public record Daily(String date, long incoming, long completed) {}

  public record DailyStatus(String date, long pending, long inProgress, long done) {}

  public record EpisodeCurrent(
      long open, long aged, long unreviewed, long createdToday, long closedToday) {}

  public record DurationStatistic(long samples, Double averageSeconds) {}

  public record EpisodeWork(
      EpisodeCurrent current, DurationStatistic firstReview, DurationStatistic completion) {}

  public record Investigation(
      Personal personal,
      Institution institution,
      long openAlertsAgedOver3Days,
      List<Daily> daily,
      List<DailyStatus> dailyAlertStatus,
      EpisodeWork episodeWork) {}

  static long count(Map<String, Object> row, String key) {
    return ((Number) row.get(key)).longValue();
  }

  private static DurationStatistic duration(Map<String, Object> row) {
    var value = (Number) row.get("average_seconds");
    return new DurationStatistic(count(row, "samples"), value == null ? null : value.doubleValue());
  }

  @SuppressWarnings("unchecked")
  static DashboardSummary assemble(
      Instant now,
      LocalDate from,
      LocalDate to,
      Map<String, Instant> computed,
      Map<String, Object> values,
      List<java.sql.Date> days) {
    Pipeline pipeline = null;
    if (computed.get("PIPELINE") != null) {
      var d = (Map<String, Object>) values.get("detection");
      pipeline =
          new Pipeline(
              new Detection(
                  count(d, "received"),
                  count(d, "analyzed"),
                  count(d, "suspicious"),
                  days.stream().map(java.sql.Date::toLocalDate).toList()),
              ((List<Map<String, Object>>) values.get("agreements"))
                  .stream()
                      .map(r -> new Agreement((String) r.get("agreement"), count(r, "count")))
                      .toList(),
              ((List<Map<String, Object>>) values.get("types"))
                  .stream().map(r -> new TypeCount(count(r, "type"), count(r, "count"))).toList(),
              count(values, "pendingReports"));
    }
    Investigation investigation = null;
    if (computed.get("INVESTIGATION") != null) {
      var p = (Map<String, Object>) values.get("personal");
      var i = (Map<String, Object>) values.get("institution");
      var e = (Map<String, Object>) values.get("episodeWork");
      var c = (Map<String, Object>) e.get("current");
      investigation =
          new Investigation(
              new Personal(count(p, "pending"), count(p, "aged"), count(p, "closed")),
              new Institution(
                  count(i, "alerts"),
                  count(i, "episodes"),
                  count(i, "aged"),
                  count(i, "today"),
                  count(i, "yesterday")),
              count(values, "openAlertsAgedOver3Days"),
              ((List<Map<String, Object>>) values.get("daily"))
                  .stream()
                      .map(
                          r ->
                              new Daily(
                                  r.get("day").toString(),
                                  count(r, "incoming"),
                                  count(r, "completed")))
                      .toList(),
              ((List<Map<String, Object>>) values.get("dailyAlertStatus"))
                  .stream()
                      .map(
                          r ->
                              new DailyStatus(
                                  r.get("date").toString(),
                                  count(r, "pending"),
                                  count(r, "inProgress"),
                                  count(r, "done")))
                      .toList(),
              new EpisodeWork(
                  new EpisodeCurrent(
                      count(c, "open"),
                      count(c, "aged"),
                      count(c, "unreviewed"),
                      count(c, "created_today"),
                      count(c, "closed_today")),
                  duration((Map<String, Object>) e.get("firstReview")),
                  duration((Map<String, Object>) e.get("completion"))));
    }
    return new DashboardSummary(
        now.toString(),
        new Range(from, to),
        new Section<>(computed.get("PIPELINE"), pipeline),
        new Section<>(computed.get("INVESTIGATION"), investigation));
  }
}
