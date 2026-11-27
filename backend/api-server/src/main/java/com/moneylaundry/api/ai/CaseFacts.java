package com.moneylaundry.api.ai;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.RuleHitQuery;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
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
    paths(caseId, out);
    neighbors(caseId, kind, out);
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

  record Move(long from, long to, BigDecimal usd, Instant at) {}

  /**
   * 자금 경로: 들어오고 나간 돈이 모두 있는 계좌(경유 계좌) 가운데 오간 금액이 큰 두 곳을 골라, 그 계좌로 돈을 가장 많이 보낸 계좌 두 곳과 받은 계좌 두 곳, 첫
   * 유입에서 첫 유출까지 걸린 시간을 쓴다. 현재 범위의 거래(원장)만 쓴다.
   */
  private void paths(long caseId, List<String> out) {
    var moves =
        jdbc.query(
            """
            select l.from_account_id, l.to_account_id, l.amount_usd, l.occurred_at
            from review.current_members m join ledger.transactions l on l.tx_id = m.tx_id
            where m.case_id = ? and m.state in ('PENDING','DECIDED')
            """,
            (r, i) ->
                new Move(
                    r.getLong(1), r.getLong(2), r.getBigDecimal(3), r.getTimestamp(4).toInstant()),
            caseId);
    for (String line : pathLines(moves, accountCodes(moves))) out.add(line);
  }

  static List<String> pathLines(List<Move> moves, Map<Long, String> code) {
    var in = new java.util.HashMap<Long, BigDecimal>();
    var outgoing = new java.util.HashMap<Long, BigDecimal>();
    var firstIn = new java.util.HashMap<Long, Instant>();
    var firstOut = new java.util.HashMap<Long, Instant>();
    for (var m : moves) {
      if (m.from() == m.to()) continue;
      in.merge(m.to(), m.usd(), BigDecimal::add);
      outgoing.merge(m.from(), m.usd(), BigDecimal::add);
      firstIn.merge(m.to(), m.at(), (a, b) -> a.isBefore(b) ? a : b);
      firstOut.merge(m.from(), m.at(), (a, b) -> a.isBefore(b) ? a : b);
    }
    var hubs =
        in.keySet().stream()
            .filter(outgoing::containsKey)
            .sorted(
                Comparator.comparing((Long a) -> in.get(a).min(outgoing.get(a)))
                    .reversed()
                    .thenComparing(a -> code.getOrDefault(a, "")))
            .limit(2)
            .toList();
    var lines = new ArrayList<String>();
    for (long hub : hubs) {
      var sources = top(moves, m -> m.to() == hub && m.from() != hub, Move::from, code);
      var targets = top(moves, m -> m.from() == hub && m.to() != hub, Move::to, code);
      long hours = Duration.between(firstIn.get(hub), firstOut.get(hub)).toHours();
      lines.add(
          "자금 경로: "
              + String.join(", ", sources)
              + " → "
              + code.get(hub)
              + " → "
              + String.join(", ", targets)
              + ". 경유 계좌 "
              + code.get(hub)
              + " 유입 "
              + usd(in.get(hub))
              + " USD, 유출 "
              + usd(outgoing.get(hub))
              + " USD"
              + (hours >= 0 ? ", 첫 유입 후 " + hours + "시간 뒤 첫 유출" : ", 유출이 유입보다 먼저 시작"));
    }
    return lines;
  }

  /** 조건에 맞는 거래를 상대 계좌별로 합쳐 금액이 큰 두 곳을 "계좌 금액 USD" 로 돌려준다. */
  private static List<String> top(
      List<Move> moves,
      java.util.function.Predicate<Move> keep,
      java.util.function.Function<Move, Long> side,
      Map<Long, String> code) {
    var sums = new java.util.HashMap<Long, BigDecimal>();
    for (var m : moves) if (keep.test(m)) sums.merge(side.apply(m), m.usd(), BigDecimal::add);
    return sums.entrySet().stream()
        .sorted(
            Map.Entry.<Long, BigDecimal>comparingByValue()
                .reversed()
                .thenComparing(e -> code.getOrDefault(e.getKey(), "")))
        .limit(2)
        .map(e -> code.get(e.getKey()) + " " + usd(e.getValue()) + " USD")
        .toList();
  }

  private Map<Long, String> accountCodes(List<Move> moves) {
    var ids = new java.util.TreeSet<Long>();
    for (var m : moves) {
      ids.add(m.from());
      ids.add(m.to());
    }
    var codes = new java.util.HashMap<Long, String>();
    if (ids.isEmpty()) return codes;
    jdbc.query(
        "select account_id, service_account_id from core.accounts where account_id = any(?)",
        (org.springframework.jdbc.core.RowCallbackHandler)
            r -> codes.put(r.getLong(1), r.getString(2)),
        (Object) ids.toArray(Long[]::new));
    return codes;
  }

  /**
   * 이웃 Alert: 이 건의 계좌가 나오는 다른 공개 Alert(최대 5건)와 그 판정. Episode 는 소속 Alert 를, Alert 는 자기가 속한 Episode 의
   * 다른 Alert 를 이웃에서 뺀다(이미 함께 보는 건이다).
   */
  private void neighbors(long caseId, String kind, List<String> out) {
    var rows =
        jdbc.queryForList(
            """
            with mine as (
              select l.from_account_id as account_id from review.current_members m
              join ledger.transactions l on l.tx_id = m.tx_id
              where m.case_id = ? and m.state in ('PENDING','DECIDED')
              union
              select l.to_account_id from review.current_members m
              join ledger.transactions l on l.tx_id = m.tx_id
              where m.case_id = ? and m.state in ('PENDING','DECIDED')),
            together as (
              select ea.alert_id from review.episode_alerts ea
              where ea.episode_id = ? or ea.episode_id in (select episode_id from review.episode_alerts where alert_id = ?)),
            hits as (
              select a.alert_id, count(distinct x.account_id) as shared
              from review.alerts a
              join review.alert_transactions t on t.alert_id = a.alert_id and t.version = a.published_version
              join ledger.transactions l on l.tx_id = t.tx_id
              join mine x on x.account_id in (l.from_account_id, l.to_account_id)
              where a.merged_into_alert_id is null and a.alert_id <> ?
                and a.alert_id not in (select alert_id from together)
              group by a.alert_id)
            select h.alert_id, h.shared, a.status,
                   (select verdict from review.judgments j where j.alert_id = h.alert_id and j.superseded_at is null) as verdict,
                   (select j.verdict from review.episode_alerts ea join review.judgments j
                      on j.episode_id = ea.episode_id and j.superseded_at is null where ea.alert_id = h.alert_id) as episode_verdict
            from hits h join review.alerts a on a.alert_id = h.alert_id
            order by h.shared desc, h.alert_id limit 5
            """,
            caseId,
            caseId,
            caseId,
            caseId,
            caseId);
    if (rows.isEmpty()) return;
    var parts = new ArrayList<String>();
    for (var r : rows) {
      Object verdict = r.get("verdict") != null ? r.get("verdict") : r.get("episode_verdict");
      parts.add(
          "Alert "
              + r.get("alert_id")
              + "(공유 계좌 "
              + r.get("shared")
              + "개, "
              + (verdict == null
                  ? ("OPEN".equals(r.get("status")) ? "처리 중" : "판정 없음")
                  : "SUSPICIOUS".equals(verdict) ? "이상 판정" : "정상 판정")
              + ")");
    }
    out.add("같은 계좌가 나오는 다른 Alert " + rows.size() + "건: " + String.join(", ", parts));
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
