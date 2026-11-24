package com.moneylaundry.api.rules.engine;

import com.moneylaundry.api.rules.definition.RuleDefinition;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 룰 정의(JSON)를 SQL 로 바꾼다. SQL 의 뼈대는 템플릿마다 여기에 고정돼 있고, 정의에서 오는 것은 "어떤 항목을, 어떤 비교로, 어떤 숫자와"뿐이다. 항목과
 * 비교는 허용 목록에서 골라 붙이고 숫자는 바인딩 파라미터로 넣는다. 사용자가 적은 글자는 SQL 에 들어가지 않는다.
 *
 * <p>지금 되는 템플릿은 집계형 셋(FAN_OUT, FAN_IN, GATHER_SCATTER)이다.
 */
public final class RuleCompiler {
  private RuleCompiler() {}

  /** SQL 조각과 그 안의 ? 에 들어갈 값. */
  public record Sql(String text, List<Object> args) {}

  /** 평가기가 있는 템플릿 */
  public static final Set<String> SUPPORTED = Set.of("FAN_OUT", "FAN_IN", "GATHER_SCATTER");

  private static final Map<String, String> COMPARATORS =
      Map.of("GTE", ">=", "GT", ">", "LTE", "<=", "LT", "<", "EQ", "=");

  // 적중 조건 항목 → 집계 결과의 열. 템플릿의 평가 방식마다 다르다.
  private static final Map<String, String> FAN_COLUMNS =
      Map.of(
          "DISTINCT_COUNTERPARTIES", "distinct_counterparties",
          "TX_COUNT", "tx_count",
          "SUM_USD", "sum_usd");
  private static final Map<String, String> GATHER_SCATTER_COLUMNS =
      Map.of(
          "IN_COUNTERPARTIES", "in_counterparties",
          "OUT_COUNTERPARTIES", "out_counterparties",
          "SUM_USD", "in_usd",
          "OUT_IN_RATIO", "out_usd * 100 / nullif(in_usd, 0)");

  public static boolean supported(Object template) {
    return template instanceof String key && SUPPORTED.contains(key);
  }

  private static String comparator(Object cmp) {
    String sql = COMPARATORS.get(String.valueOf(cmp));
    if (sql == null) throw new IllegalArgumentException("비교 " + cmp + " 는 쓸 수 없습니다.");
    return sql;
  }

  private static Object value(Map<?, ?> condition) {
    Number value = RuleDefinition.number(condition.get("value"));
    if (value == null) throw new IllegalArgumentException("값이 빈 조건이 있습니다.");
    return value;
  }

  /**
   * 세는 거래(filter) → 원장 거래 t 에 거는 조건. 조건이 없으면 TRUE.
   *
   * <ul>
   *   <li>TX_USD: 보낸 금액의 USD 환산액
   *   <li>FIRST_PAIR: 같은 (송금 계좌 → 수취 계좌) 쌍의 더 이른 거래가 없다. 원장 처음부터 본다
   *   <li>FX_FOLLOW: 송금 계좌가 같은 분에 자기 계좌 안에서 환전했고, 환전해 받은 통화가 이 송금의 통화이며, 보낸 금액 ÷ 환전해 받은 금액이 0.8 ~
   *       1.25
   * </ul>
   */
  public static Sql filter(Map<String, Object> definition) {
    var args = new ArrayList<Object>();
    return new Sql(filterGroup(definition.get("filter"), args), args);
  }

  private static String filterGroup(Object group, List<Object> args) {
    var parts = new ArrayList<String>();
    for (Object item : RuleDefinition.items(group)) {
      if (RuleDefinition.group(item)) parts.add(filterGroup(item, args));
      else parts.add(filterCondition((Map<?, ?>) item, args));
    }
    if (parts.isEmpty()) return "true";
    boolean any = group instanceof Map<?, ?> map && "ANY".equals(map.get("op"));
    return "(" + String.join(any ? " or " : " and ", parts) + ")";
  }

  private static String filterCondition(Map<?, ?> condition, List<Object> args) {
    String field = String.valueOf(condition.get("field"));
    switch (field) {
      case "TX_USD" -> {
        args.add(value(condition));
        return "t.amount_usd " + comparator(condition.get("cmp")) + " ?";
      }
      case "FIRST_PAIR" -> {
        return """
            not exists (select 1 from ledger.transactions p
              where p.from_account_id = t.from_account_id and p.to_account_id = t.to_account_id
                and p.integration_status = 'ACTIVE'
                and (p.occurred_at, p.tx_id) < (t.occurred_at, t.tx_id))""";
      }
      case "FX_FOLLOW" -> {
        return """
            exists (select 1 from ledger.transactions s
              where s.from_account_id = t.from_account_id and s.to_account_id = t.from_account_id
                and s.integration_status = 'ACTIVE'
                and s.payment_currency <> s.receiving_currency and s.amount_received > 0
                and s.occurred_at >= date_trunc('minute', t.occurred_at)
                and s.occurred_at < date_trunc('minute', t.occurred_at) + interval '1 minute'
                and s.receiving_currency = t.payment_currency
                and t.amount_paid between s.amount_received * 0.8 and s.amount_received * 1.25)""";
      }
      default -> throw new IllegalArgumentException("세는 거래 항목 " + field + " 는 아직 평가할 수 없습니다.");
    }
  }

  /** 적중 조건(where) → 집계 결과에 거는 조건. */
  private static String where(Object group, Map<String, String> columns, List<Object> args) {
    var parts = new ArrayList<String>();
    for (Object item : RuleDefinition.items(group)) {
      if (RuleDefinition.group(item)) {
        parts.add(where(item, columns, args));
        continue;
      }
      var condition = (Map<?, ?>) item;
      String metric = String.valueOf(condition.get("metric"));
      if ("NO_REPEAT".equals(metric) && columns == FAN_COLUMNS) {
        parts.add("tx_count = distinct_counterparties");
        continue;
      }
      String column = columns.get(metric);
      if (column == null)
        throw new IllegalArgumentException("적중 조건 항목 " + metric + " 는 이 템플릿에서 평가할 수 없습니다.");
      args.add(value(condition));
      parts.add(column + " " + comparator(condition.get("cmp")) + " ?");
    }
    if (parts.isEmpty()) return "true";
    boolean any = group instanceof Map<?, ?> map && "ANY".equals(map.get("op"));
    return "(" + String.join(any ? " or " : " and ", parts) + ")";
  }

  /**
   * 적중을 rule_result 에 넣는 SQL. 읽는 것은 임시 표 rule_ftx(세는 거래를 통과한 거래)와 rule_busy(바쁜 계좌)다.
   *
   * <p>앞의 ? 순서: 기간(분), 검사 시작일, 검사 끝일, 그다음 적중 조건의 값들.
   *
   * <p>검사 시점(트리거)은 대상 계좌의 거래 한 건이고, 같은 계좌의 같은 분은 한 번만 본다. 그 시각(분)을 포함해 직전 기간 안의 거래를 모은다. 적중 1건은 대상
   * × 거래 기준일이다. 측정값은 그날 가장 크게 넘은 검사 시점의 값이고, 근거 거래는 그날 적중한 검사 시점들의 근거 거래를 합친 것이다.
   */
  public static Sql evaluate(Map<String, Object> definition, String from, String to) {
    String key = String.valueOf(definition.get("template"));
    if (!supported(key)) throw new IllegalArgumentException("이 템플릿의 평가기는 아직 없습니다.");
    Number window = RuleDefinition.number(definition.get("windowMinutes"));
    if (window == null) throw new IllegalArgumentException("기간이 없습니다.");
    var args = new ArrayList<Object>(List.of(window.intValue(), from, to));
    String sql =
        "GATHER_SCATTER".equals(key)
            ? gatherScatter(where(definition.get("where"), GATHER_SCATTER_COLUMNS, args))
            : fan("FAN_IN".equals(key), where(definition.get("where"), FAN_COLUMNS, args));
    return new Sql(sql, args);
  }

  // 대상 × 날짜마다 한 줄로 줄이는 꼬리. hit 에는 subject, at, business_date, window_from, strength, measured,
  // tx_ids 가 있어야 한다.
  // 측정값은 그날 가장 크게 넘은 검사 시점의 것, 근거 거래는 그날 적중한 검사 시점들의 근거 거래를 합친 것이다.
  // 측정값을 고르는 쪽과 근거 거래를 합치는 쪽을 따로 집계해 조인하면 PostgreSQL 이 한쪽을 줄마다 다시 계산하는 계획을 고른다. 그래서 한 번에 센다.
  private static final String PER_DAY =
      """
      , flat as (
        select h.subject, h.business_date, h.window_from, h.at, x,
               first_value(h.measured) over (partition by h.subject, h.business_date
                                             order by h.strength desc, h.at desc) as measured
        from hit h cross join lateral unnest(h.tx_ids) x
      )
      insert into rule_result(subject_id, hit_date, measured, tx_ids, window_start, window_end)
      select subject, business_date, measured, array_agg(distinct x order by x), min(window_from), max(at)
      from flat group by subject, business_date, measured
      """;

  /** FAN-OUT(대상 = 송금 계좌) · FAN-IN(대상 = 수취 계좌). 기간 안 대상 계좌의 같은 방향 거래를 센다. */
  private static String fan(boolean in, String where) {
    String subject = in ? "to_account_id" : "from_account_id";
    String other = in ? "from_account_id" : "to_account_id";
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        trig as (
          select distinct f.%1$s as subject, f.at, f.business_date
          from rule_ftx f, params p
          where f.business_date between p.date_from and p.date_to
            and not exists (select 1 from rule_busy b where b.account_id = f.%1$s)
        ), agg as (
          select g.subject, g.at, g.business_date, min(w.at) as window_from,
                 count(distinct w.%2$s) as distinct_counterparties, count(*) as tx_count,
                 sum(w.amount_usd) as sum_usd, array_agg(w.tx_id) as tx_ids
          from trig g cross join params p
          join rule_ftx w on w.%1$s = g.subject and w.at <= g.at and w.at > g.at - p.span
          group by g.subject, g.at, g.business_date
        ), hit as (
          select subject, at, business_date, window_from, tx_ids, distinct_counterparties as strength,
                 jsonb_build_object('DISTINCT_COUNTERPARTIES', distinct_counterparties,
                                    'TX_COUNT', tx_count, 'SUM_USD', sum_usd) as measured
          from agg where %3$s
        )
        """
            .formatted(subject, other, where)
        + PER_DAY;
  }

  /**
   * GATHER-SCATTER(대상 = 가운데 계좌). 검사 시점은 그 계좌의 출금이다. 기간 안 입금을 모으고, 출금은 기간 안 첫 입금 시각(같은 분 포함)부터 검사
   * 시점까지의 것만 센다. 기간 안에 입금이 없으면 적중이 아니다.
   */
  private static String gatherScatter(String where) {
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        trig as (
          select distinct f.from_account_id as subject, f.at, f.business_date
          from rule_ftx f, params p
          where f.business_date between p.date_from and p.date_to
            and not exists (select 1 from rule_busy b where b.account_id = f.from_account_id)
        ), inn as (
          select g.subject, g.at, g.business_date, min(w.at) as first_in,
                 count(distinct w.from_account_id) as in_counterparties,
                 sum(w.amount_usd) as in_usd, array_agg(w.tx_id) as in_ids
          from trig g cross join params p
          join rule_ftx w on w.to_account_id = g.subject and w.at <= g.at and w.at > g.at - p.span
          group by g.subject, g.at, g.business_date
        ), agg as (
          select i.*, o.out_counterparties, o.out_usd, o.out_ids
          from inn i cross join lateral (
            select count(distinct w.to_account_id) as out_counterparties,
                   coalesce(sum(w.amount_usd), 0) as out_usd, array_agg(w.tx_id) as out_ids
            from rule_ftx w
            where w.from_account_id = i.subject and w.at >= i.first_in and w.at <= i.at) o
        ), hit as (
          select subject, at, business_date, first_in as window_from, in_ids || out_ids as tx_ids,
                 least(in_counterparties, out_counterparties) as strength,
                 jsonb_build_object('IN_COUNTERPARTIES', in_counterparties,
                                    'OUT_COUNTERPARTIES', out_counterparties, 'SUM_USD', in_usd,
                                    'OUT_IN_RATIO', round(out_usd * 100 / nullif(in_usd, 0), 2)) as measured
          from agg where %s
        )
        """
            .formatted(where)
        + PER_DAY;
  }

  /** 정의에서 맨 위 그룹의 첫 조건 가운데 metric 이 같은 것의 값만 바꾼 정의. 그런 조건이 없으면 null. */
  public static Map<String, Object> withMetricValue(
      Map<String, Object> definition, String metric, Number value) {
    var items = new ArrayList<Object>();
    boolean replaced = false;
    for (Object item : RuleDefinition.items(definition.get("where"))) {
      if (!replaced
          && item instanceof Map<?, ?> condition
          && metric.equals(condition.get("metric"))) {
        var copy = new LinkedHashMap<String, Object>();
        condition.forEach((k, v) -> copy.put(String.valueOf(k), v));
        copy.put("value", value);
        items.add(copy);
        replaced = true;
      } else items.add(item);
    }
    if (!replaced) return null;
    var where = new LinkedHashMap<String, Object>();
    ((Map<?, ?>) definition.get("where")).forEach((k, v) -> where.put(String.valueOf(k), v));
    where.put("items", items);
    var copy = new LinkedHashMap<>(definition);
    copy.put("where", where);
    return copy;
  }

  /** 맨 위 그룹의 첫 조건 가운데 metric 이 같은 것의 값. 없으면 null. */
  public static Number metricValue(Map<String, Object> definition, String metric) {
    for (Object item : RuleDefinition.items(definition.get("where")))
      if (item instanceof Map<?, ?> condition && metric.equals(condition.get("metric")))
        return RuleDefinition.number(condition.get("value"));
    return null;
  }
}
