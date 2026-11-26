package com.moneylaundry.api.ai;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.RuleHitQuery;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * AI 요약에 넘길 Alert · Episode 사실 목록. 숫자는 모두 여기서 계산하고 Claude 는 이 문장들만 보고 요약을 쓴다. 저장된 현재 범위
 * 요약(review.cases.summary)과 룰 적중을 읽기만 한다.
 */
@Component
public class CaseFacts {
  static final DateTimeFormatter KST_MINUTE =
      DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(BusinessTime.KST);

  public record Fact(String id, String text) {}

  public record Facts(long caseId, String kind, List<Fact> facts) {}

  private final JdbcTemplate jdbc;
  private final RuleHitQuery hits;

  public CaseFacts(JdbcTemplate jdbc, RuleHitQuery hits) {
    this.jdbc = jdbc;
    this.hits = hits;
  }

  public Facts build(long caseId) {
    var rows =
        jdbc.queryForList(
            "select kind, status, summary::text as summary from review.visible_cases where case_id=?",
            caseId);
    if (rows.isEmpty()) throw ApiException.notFound("사건이 없습니다.");
    var row = rows.getFirst();
    String kind = row.get("kind").toString();
    var summary =
        row.get("summary") == null
            ? Map.<String, Object>of()
            : ReviewJson.object(row.get("summary"));
    var out = new ArrayList<String>();
    out.add(
        ("EPISODE".equals(kind) ? "Episode" : "Alert")
            + " "
            + caseId
            + ", 상태 "
            + ("OPEN".equals(row.get("status")) ? "처리 중" : "종결"));
    flow(summary, out);
    if ("EPISODE".equals(kind)) episode(caseId, out);
    rules(caseId, out);
    var facts = new ArrayList<Fact>();
    for (int i = 0; i < out.size(); i++) facts.add(new Fact("F" + (i + 1), out.get(i)));
    return new Facts(caseId, kind, facts);
  }

  private static void flow(Map<String, Object> s, List<String> out) {
    if (s.get("txCount") != null)
      out.add(
          "근거 거래 "
              + s.get("txCount")
              + "건, 씨앗 거래 "
              + s.getOrDefault("seedCount", 0)
              + "건"
              + period(s.get("firstTxAt"), s.get("lastTxAt")));
    if (s.get("totalAmountUsd") != null)
      out.add("근거 거래 금액 합계 " + usd(s.get("totalAmountUsd")) + " USD");
    if (s.get("amountsByCurrency") instanceof Map<?, ?> amounts && amounts.size() > 1)
      out.add("통화별 송금액: " + amounts(amounts));
    if (s.get("riskScore") instanceof Number risk && risk.doubleValue() > 0)
      out.add("씨앗 거래 최고 모델 점수 " + score(risk));
    if (s.get("primaryType") != null) {
      String type = s.get("primaryType").toString();
      out.add(
          "모델 추정 유형 "
              + type
              + (s.get("typeShare") instanceof Number share && share.doubleValue() > 0
                  ? " (씨앗 거래 중 " + percent(share) + "가 이 유형 최상위)"
                  : ""));
    }
    if (s.get("typeDistribution") instanceof Map<?, ?> types && !types.isEmpty())
      out.add("의심 거래 유형별 건수: " + counts(types));
    if (s.get("netFlows") instanceof Map<?, ?> net && !net.isEmpty()) {
      var sorted =
          net.entrySet().stream()
              .map(e -> Map.entry(e.getKey().toString(), new BigDecimal(e.getValue().toString())))
              .sorted(Map.Entry.comparingByValue())
              .toList();
      var receivers =
          sorted.reversed().stream().filter(e -> e.getValue().signum() > 0).limit(3).toList();
      var senders = sorted.stream().filter(e -> e.getValue().signum() < 0).limit(3).toList();
      if (!receivers.isEmpty()) out.add("순유입이 큰 계좌: " + accounts(receivers));
      if (!senders.isEmpty()) out.add("순유출이 큰 계좌: " + accounts(senders));
    }
    if (s.get("topReceiverShare") instanceof Map<?, ?> shares)
      shares.forEach(
          (currency, share) ->
              out.add("수취액 상위 3개 계좌 비중(" + currency + "): " + percent((Number) share)));
    if (s.get("paymentFormats") instanceof Map<?, ?> formats && !formats.isEmpty())
      out.add("결제 수단별 건수: " + counts(formats));
    if (s.get("dailySuspiciousCount") instanceof Map<?, ?> days && !days.isEmpty())
      out.add("날짜별 의심 거래 건수(KST): " + counts(days));
  }

  /** Episode 는 소속 Alert 의 요약과, 둘 이상의 Alert 에 나오는 계좌를 더한다. */
  private void episode(long episodeId, List<String> out) {
    var alerts =
        jdbc.queryForList(
            """
            select c.case_id, c.summary::text as summary from review.episode_alerts ea
            join review.cases c on c.case_id = ea.alert_id
            where ea.episode_id = ? order by c.case_id
            """,
            episodeId);
    out.add("소속 Alert " + alerts.size() + "건");
    for (var alert : alerts) {
      var s =
          alert.get("summary") == null
              ? Map.<String, Object>of()
              : ReviewJson.object(alert.get("summary"));
      out.add(
          "소속 Alert "
              + alert.get("case_id")
              + ": 근거 거래 "
              + s.getOrDefault("txCount", 0)
              + "건, 추정 유형 "
              + s.getOrDefault("primaryType", "패턴 미특정")
              + (s.get("riskScore") instanceof Number risk && risk.doubleValue() > 0
                  ? ", 최고 점수 " + score(risk)
                  : "")
              + period(s.get("firstTxAt"), s.get("lastTxAt")));
    }
    for (var shared :
        jdbc.queryForList(
            """
            with members as (
              select m.alert_id, t.from_account_id as account_id from review.current_members m
              join ledger.transactions t on t.tx_id = m.tx_id
              where m.case_id = ? and m.state in ('PENDING','DECIDED')
              union
              select m.alert_id, t.to_account_id from review.current_members m
              join ledger.transactions t on t.tx_id = m.tx_id
              where m.case_id = ? and m.state in ('PENDING','DECIDED'))
            select a.service_account_id as account,
                   array_to_string(array_agg(distinct m.alert_id order by m.alert_id), ', ') as alerts
            from members m join core.accounts a on a.account_id = m.account_id
            group by a.service_account_id having count(distinct m.alert_id) > 1
            order by count(distinct m.alert_id) desc, a.service_account_id limit 5
            """,
            episodeId,
            episodeId))
      out.add("계좌 " + shared.get("account") + "가 Alert " + shared.get("alerts") + "에 함께 나옴");
  }

  private void rules(long caseId, List<String> out) {
    for (var hit : hits.forCase(caseId)) {
      var conditions = new ArrayList<String>();
      for (var c : ReviewJson.rows(hit.get("conditions")))
        conditions.add(
            c.get("label")
                + " "
                + c.get("cmp")
                + " "
                + c.get("value")
                + (c.get("unit") == null ? "" : " " + c.get("unit"))
                + (c.get("measured") == null ? "" : " (관측 " + c.get("measured") + ")"));
      out.add(
          "룰 "
              + hit.get("code")
              + " "
              + hit.get("name")
              + " 해당"
              + (hit.get("subject") == null ? "" : ", 대상 계좌 " + hit.get("subject"))
              + (conditions.isEmpty() ? "" : ": " + String.join(", ", conditions)));
    }
  }

  private static String period(Object first, Object last) {
    if (first == null || last == null) return "";
    return ", 기간 "
        + KST_MINUTE.format(Instant.parse(first.toString()))
        + " ~ "
        + KST_MINUTE.format(Instant.parse(last.toString()))
        + " (KST)";
  }

  private static String usd(Object value) {
    return String.format("%,.0f", new BigDecimal(value.toString()));
  }

  private static String score(Number value) {
    return new BigDecimal(value.toString()).setScale(3, RoundingMode.HALF_UP).toPlainString();
  }

  private static String percent(Number value) {
    return new BigDecimal(value.toString())
            .multiply(BigDecimal.valueOf(100))
            .setScale(1, RoundingMode.HALF_UP)
            .toPlainString()
        + "%";
  }

  private static String amounts(Map<?, ?> values) {
    var parts = new ArrayList<String>();
    values.forEach((currency, amount) -> parts.add(usd(amount) + " " + currency));
    return String.join(", ", parts);
  }

  private static String counts(Map<?, ?> values) {
    var sorted = new LinkedHashMap<String, Long>();
    values.entrySet().stream()
        .sorted(
            Comparator.comparing((Map.Entry<?, ?> e) -> ((Number) e.getValue()).longValue())
                .reversed()
                .thenComparing(e -> e.getKey().toString()))
        .forEach(e -> sorted.put(e.getKey().toString(), ((Number) e.getValue()).longValue()));
    var parts = new ArrayList<String>();
    sorted.forEach((key, count) -> parts.add(key + " " + count + "건"));
    return String.join(", ", parts);
  }

  /** netFlows 의 키는 "계좌|통화" 다. */
  private static String accounts(List<Map.Entry<String, BigDecimal>> entries) {
    var parts = new ArrayList<String>();
    for (var e : entries) {
      String[] key = e.getKey().split("\\|");
      parts.add(key[0] + " " + usd(e.getValue().abs()) + " " + (key.length > 1 ? key[1] : ""));
    }
    return String.join(", ", parts).trim();
  }
}
