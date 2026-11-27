package com.moneylaundry.api.ai;

import com.moneylaundry.api.common.BusinessTime;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 대시보드 종합 위험지수(0~100). 지표 네 개를 평소 대비로 점수화해 가중 평균한다. 숫자는 모두 여기서 계산하고 Claude 는 설명 문장만 쓴다. 읽는 표는 대시보드
 * 집계(ops.dashboard_*)뿐이다.
 *
 * <ul>
 *   <li>의심 거래 비율(30): 최근 거래일의 의심 비율 ÷ 그 앞 30일 평균
 *   <li>신규 Alert(25): 오늘 생성 Alert ÷ 앞 7일 하루 평균
 *   <li>고위험 비중(25): 최근 거래일의 점수 90 이상 비중 ÷ 그 앞 30일 평균
 *   <li>미처리 적체(20): 배정 후 3일 넘은 처리 전 Alert ÷ 처리 전 Alert
 * </ul>
 *
 * 배수는 0.5배 이하 0점, 1배 20점, 2배 60점, 3배 이상 100점(구간별 직선). 적체는 0% 0점, 50% 이상 100점. 기준선이 없는 지표는 빼고 남은
 * 가중치로 다시 나눈다.
 */
@Component
public class DashboardRisk {
  public record Indicator(
      String key,
      String label,
      int weight,
      String current,
      String baseline,
      BigDecimal ratio,
      Integer score) {}

  public record Index(
      LocalDate latestTxDate,
      LocalDate businessDate,
      Integer score,
      String level,
      List<Indicator> indicators) {}

  private final JdbcTemplate jdbc;
  private final BusinessTime time;

  public DashboardRisk(JdbcTemplate jdbc, BusinessTime time) {
    this.jdbc = jdbc;
    this.time = time;
  }

  public Index compute() {
    var now = time.now();
    LocalDate today = now.atZone(BusinessTime.KST).toLocalDate();
    LocalDate latest =
        jdbc.queryForObject(
            "select max(business_date) from ops.dashboard_model_counts where business_date<=?",
            LocalDate.class,
            java.sql.Date.valueOf(today));
    var components = new ArrayList<Indicator>();
    if (latest != null) {
      components.add(suspicious(latest));
      components.add(highRisk(latest));
    }
    components.add(newAlerts(today));
    components.add(backlog(now));
    int weights = 0;
    double sum = 0;
    for (var c : components)
      if (c.score() != null) {
        weights += c.weight();
        sum += c.weight() * c.score();
      }
    Integer score = weights == 0 ? null : (int) Math.round(sum / weights);
    return new Index(latest, today, score, score == null ? null : level(score), components);
  }

  /** 그 거래일 의심 거래의 유형별 건수(많은 순). */
  public List<String> typeCounts(LocalDate day) {
    return jdbc
        .queryForList(
            "select coalesce(type_class,0) as type,sum(n)::bigint as count from ops.dashboard_model_counts where suspicious and business_date=? group by 1 order by 2 desc,1",
            date(day))
        .stream()
        .map(
            row ->
                com.moneylaundry.api.review.CaseSummary.TYPES[((Number) row.get("type")).intValue()]
                    + " "
                    + row.get("count")
                    + "건")
        .toList();
  }

  static String level(int score) {
    return score >= 80 ? "심각" : score >= 60 ? "높음" : score >= 40 ? "경계" : score >= 20 ? "보통" : "낮음";
  }

  /** 배수 → 점수: (0.5,0) (1,20) (2,60) (3,100) 사이를 직선으로 잇는다. */
  static int ratioScore(double r) {
    if (r <= 0.5) return 0;
    if (r <= 1) return (int) Math.round((r - 0.5) / 0.5 * 20);
    if (r <= 2) return (int) Math.round(20 + (r - 1) * 40);
    if (r <= 3) return (int) Math.round(60 + (r - 2) * 40);
    return 100;
  }

  static int backlogScore(double share) {
    return (int) Math.round(Math.min(1, share / 0.5) * 100);
  }

  private Indicator suspicious(LocalDate latest) {
    var row =
        jdbc.queryForMap(
            """
            select coalesce(sum(n) filter(where business_date=?),0) as total,
                   coalesce(sum(n) filter(where business_date=? and suspicious),0) as suspicious,
                   coalesce(sum(n) filter(where business_date<?),0) as base_total,
                   coalesce(sum(n) filter(where business_date<? and suspicious),0) as base_suspicious
            from ops.dashboard_model_counts where business_date between ? and ?
            """,
            date(latest),
            date(latest),
            date(latest),
            date(latest),
            date(latest.minusDays(30)),
            date(latest));
    double total = num(row.get("total")), sus = num(row.get("suspicious"));
    double baseTotal = num(row.get("base_total")), baseSus = num(row.get("base_suspicious"));
    String current =
        percent(total == 0 ? 0 : sus / total) + " (" + (long) sus + " / " + (long) total + "건)";
    if (total == 0 || baseTotal == 0 || baseSus == 0)
      return new Indicator("suspiciousRate", "의심 거래 비율", 30, current, null, null, null);
    double r = (sus / total) / (baseSus / baseTotal);
    return new Indicator(
        "suspiciousRate",
        "의심 거래 비율",
        30,
        current,
        percent(baseSus / baseTotal) + " (앞 30일 평균)",
        ratio(r),
        ratioScore(r));
  }

  private Indicator highRisk(LocalDate latest) {
    var row =
        jdbc.queryForMap(
            """
            select coalesce(sum(n) filter(where business_date=?),0) as total,
                   coalesce(sum(n) filter(where business_date=? and score_pct>=90),0) as high,
                   coalesce(sum(n) filter(where business_date<?),0) as base_total,
                   coalesce(sum(n) filter(where business_date<? and score_pct>=90),0) as base_high
            from ops.dashboard_score_points where business_date between ? and ?
            """,
            date(latest),
            date(latest),
            date(latest),
            date(latest),
            date(latest.minusDays(30)),
            date(latest));
    double total = num(row.get("total")), high = num(row.get("high"));
    double baseTotal = num(row.get("base_total")), baseHigh = num(row.get("base_high"));
    String current = percent(total == 0 ? 0 : high / total) + " (" + (long) high + "건)";
    if (total == 0 || baseTotal == 0 || baseHigh == 0)
      return new Indicator("highRiskShare", "고위험(점수 90 이상) 비중", 25, current, null, null, null);
    double r = (high / total) / (baseHigh / baseTotal);
    return new Indicator(
        "highRiskShare",
        "고위험(점수 90 이상) 비중",
        25,
        current,
        percent(baseHigh / baseTotal) + " (앞 30일 평균)",
        ratio(r),
        ratioScore(r));
  }

  private Indicator newAlerts(LocalDate today) {
    var row =
        jdbc.queryForMap(
            """
            select coalesce(sum(n) filter(where created_at>=?),0) as today,
                   coalesce(sum(n) filter(where created_at<?),0) as week
            from ops.dashboard_case_counts where kind='ALERT' and created_at>=? and created_at<?
            """,
            at(today),
            at(today),
            at(today.minusDays(7)),
            at(today.plusDays(1)));
    double now = num(row.get("today")), avg = num(row.get("week")) / 7;
    String current = (long) now + "건";
    if (avg == 0) return new Indicator("newAlerts", "오늘 생성 Alert", 25, current, null, null, null);
    double r = now / avg;
    return new Indicator(
        "newAlerts",
        "오늘 생성 Alert",
        25,
        current,
        new BigDecimal(avg).setScale(1, RoundingMode.HALF_UP).toPlainString() + "건 (앞 7일 하루 평균)",
        ratio(r),
        ratioScore(r));
  }

  private Indicator backlog(java.time.Instant now) {
    var row =
        jdbc.queryForMap(
            """
            select count(*) as open, count(*) filter(where assigned_at<=?) as aged
            from ops.dashboard_case_items where kind='ALERT' and status='OPEN' and not linked
            """,
            Timestamp.from(now.minus(Duration.ofHours(72))));
    double open = num(row.get("open")), aged = num(row.get("aged"));
    String current = (long) aged + " / " + (long) open + "건";
    if (open == 0)
      return new Indicator("backlog", "3일 넘은 처리 전 Alert 비율", 20, current, null, null, 0);
    double share = aged / open;
    return new Indicator(
        "backlog",
        "3일 넘은 처리 전 Alert 비율",
        20,
        percent(share) + " (" + current + ")",
        null,
        null,
        backlogScore(share));
  }

  private static java.sql.Date date(LocalDate d) {
    return java.sql.Date.valueOf(d);
  }

  private static Timestamp at(LocalDate d) {
    return Timestamp.from(d.atStartOfDay(BusinessTime.KST).toInstant());
  }

  private static double num(Object value) {
    return ((Number) value).doubleValue();
  }

  private static BigDecimal ratio(double r) {
    return new BigDecimal(r).setScale(2, RoundingMode.HALF_UP);
  }

  private static String percent(double share) {
    return new BigDecimal(share * 100).setScale(2, RoundingMode.HALF_UP).toPlainString() + "%";
  }
}
