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
 * <p>되는 템플릿은 패턴 여섯과 일반 넷이다. 집계형(FAN_OUT, FAN_IN, GATHER_SCATTER), 2홉형(SCATTER_GATHER), 경로형(CYCLE,
 * RANDOM), 일반(LARGE_TX, STRUCTURING, SAME_AMOUNT, PASS_THROUGH).
 *
 * <p>일반 넷은 집계형의 뼈대를 쓴다. STRUCTURING 은 FAN 과 같고(금액 띠가 세는 거래에 있다), SAME_AMOUNT 는 FAN 의 돌아보는 쪽에 "검사
 * 거래와 비슷한 금액"이 붙고, PASS_THROUGH 는 GATHER_SCATTER 와 같되 금액 비율만 본다. LARGE_TX 는 돌아보지 않는다. 세는 거래를 통과한
 * 거래가 곧 적중이고 대상이 계좌가 아니라 거래다.
 *
 * <p>2홉형과 경로형은 바쁜 계좌가 어느 자리에도 끼지 않는다(대상 · 경유 · 출발 모두). rule_ftx 의 clean 이 "양쪽 계좌가 모두 바쁜 계좌가 아닌
 * 거래"다.
 */
public final class RuleCompiler {
  private RuleCompiler() {}

  /** SQL 조각과 그 안의 ? 에 들어갈 값. */
  public record Sql(String text, List<Object> args) {}

  /** 평가기가 있는 템플릿 */
  public static final Set<String> SUPPORTED =
      Set.of(
          "FAN_OUT",
          "FAN_IN",
          "GATHER_SCATTER",
          "SCATTER_GATHER",
          "CYCLE",
          "RANDOM",
          "LARGE_TX",
          "STRUCTURING",
          "SAME_AMOUNT",
          "PASS_THROUGH");

  /** 방향(정의의 direction)을 고르는 템플릿. OUT 이면 보낸 쪽 계좌가, IN 이면 받은 쪽 계좌가 대상이다. */
  private static final Set<String> DIRECTED = Set.of("STRUCTURING", "SAME_AMOUNT");

  /** 세는 거래 항목이지만 거래 하나만 봐서는 정할 수 없는 것. 검사 거래와 견줘야 해서 SAME_AMOUNT 의 집계에서 건다. */
  public static final String NEAR_TRIGGER_AMOUNT = "NEAR_TRIGGER_AMOUNT";

  /** 경로형: 거래를 한 단계씩 따라가 길을 만든다. 조건은 정의의 path 에 있다. */
  private static final Set<String> PATH = Set.of("CYCLE", "RANDOM");

  /** 값을 바꿔 다시 돌려 볼 수 있는 경로 값. 적중 조건 항목처럼 "이상"으로 건다. */
  public static final String MIN_HOPS = "minHops";

  private static final Map<String, String> COMPARATORS =
      Map.of("GTE", ">=", "GT", ">", "LTE", "<=", "LT", "<", "EQ", "=");

  // 적중 조건 항목 → 집계 결과의 열. 템플릿의 평가 방식마다 다르다.
  private static final Map<String, String> FAN_COLUMNS =
      Map.of(
          "DISTINCT_COUNTERPARTIES", "distinct_counterparties",
          "TX_COUNT", "tx_count",
          "SUM_USD", "sum_usd");
  private static final Map<String, String> SCATTER_GATHER_COLUMNS =
      Map.of("MID_COUNT", "mid_count");
  private static final Map<String, String> PASS_THROUGH_COLUMNS =
      Map.of("SUM_USD", "in_usd", "OUT_IN_RATIO", "out_usd * 100 / nullif(in_usd, 0)");
  private static final Map<String, String> GATHER_SCATTER_COLUMNS =
      Map.of(
          "IN_COUNTERPARTIES", "in_counterparties",
          "OUT_COUNTERPARTIES", "out_counterparties",
          "SUM_USD", "in_usd",
          "OUT_IN_RATIO", "out_usd * 100 / nullif(in_usd, 0)");

  public static boolean supported(Object template) {
    return template instanceof String key && SUPPORTED.contains(key);
  }

  /** 경로형 템플릿인가. 경로형은 {@link #walks} 로 길을 먼저 만들고 {@link #evaluate} 가 그 가운데 조건에 맞는 길을 고른다. */
  public static boolean path(Object template) {
    return template instanceof String key && PATH.contains(key);
  }

  /**
   * 검사 시점이 되는 거래에서 대상 계좌가 받는 쪽인가. 아니면 보내는 쪽이다. GATHER-SCATTER 와 PASS_THROUGH 는 가운데 계좌의 출금에서 검사한다.
   * 방향을 고르는 템플릿은 정의의 direction 을 따른다.
   */
  public static boolean subjectReceives(Map<String, Object> definition) {
    String key = String.valueOf(definition.get("template"));
    if (DIRECTED.contains(key)) return "IN".equals(definition.get("direction"));
    return Set.of("FAN_IN", "SCATTER_GATHER", "CYCLE", "RANDOM").contains(key);
  }

  /** 적중의 대상이 무엇인가. LARGE_TX 는 거래 1건(TX), 나머지는 계좌(ACCOUNT)다. */
  public static String subjectType(Object template) {
    return "LARGE_TX".equals(template) ? "TX" : "ACCOUNT";
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
   *   <li>NEAR_TRIGGER_AMOUNT: 여기서는 걸지 않는다(TRUE). 검사 거래마다 범위가 달라서 {@link #evaluate} 의 집계에서 건다
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
                and (p.occurred_at, p.tx_id) < (t.occurred_at, t.tx_id))""";
      }
      case "FX_FOLLOW" -> {
        return """
            exists (select 1 from ledger.transactions s
              where s.from_account_id = t.from_account_id and s.to_account_id = t.from_account_id
                and s.payment_currency <> s.receiving_currency and s.amount_received > 0
                and s.occurred_at >= date_trunc('minute', t.occurred_at)
                and s.occurred_at < date_trunc('minute', t.occurred_at) + interval '1 minute'
                and s.receiving_currency = t.payment_currency
                and t.amount_paid between s.amount_received * 0.8 and s.amount_received * 1.25)""";
      }
      case NEAR_TRIGGER_AMOUNT -> {
        return "true";
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
    return evaluate(definition, from, to, false);
  }

  /**
   * @param listedDays true 면 검사 날짜를 [from, to] 가운데 임시 표 rule_days 에 있는 날짜로 좁힌다. 일일 실행이 그날 분석이 새로 받은
   *     날짜만 볼 때 쓴다
   */
  public static Sql evaluate(
      Map<String, Object> definition, String from, String to, boolean listedDays) {
    String key = String.valueOf(definition.get("template"));
    if (!supported(key)) throw new IllegalArgumentException("이 템플릿의 평가기는 아직 없습니다.");
    String days = listedDays ? LISTED_DAYS : "";
    if ("LARGE_TX".equals(key))
      // 돌아보는 기간이 없다. 세는 거래를 통과한 거래 하나하나가 적중이고 그 거래가 대상이자 근거다.
      return new Sql(
          """
          insert into rule_result(subject_id, hit_date, measured, tx_ids, window_start, window_end)
          select f.tx_id, f.business_date, jsonb_build_object('TX_USD', f.amount_usd), array[f.tx_id], f.at, f.at
          from rule_ftx f
          where f.business_date between ?::date and ?::date%s
          """
              .formatted(days),
          List.of(from, to));
    Number window = RuleDefinition.number(definition.get("windowMinutes"));
    if (window == null) throw new IllegalArgumentException("기간이 없습니다.");
    var args = new ArrayList<Object>(List.of(window.intValue(), from, to));
    if (PATH.contains(key)) {
      // 길은 walks() 가 rule_walk 에 만들어 두었다. 여기서는 길이와 닫혔는지만 본다.
      Number minHops = pathValue(definition, MIN_HOPS);
      return new Sql(
          """
          with hit as (
            select subject, at, business_date, window_from, tx_ids, hops as strength,
                   jsonb_build_object('HOPS', hops) as measured
            from rule_walk where closed = ? and hops >= ?
          )
          """
              + PER_DAY,
          List.of("CYCLE".equals(key), minHops.intValue()));
    }
    boolean in = subjectReceives(definition);
    if ("SAME_AMOUNT".equals(key)) {
      // near 의 ? 둘이 적중 조건의 값들보다 앞에 온다
      Number percent = nearTriggerPercent(definition);
      args.add(percent);
      args.add(percent);
    }
    String sql =
        switch (key) {
          case "GATHER_SCATTER" ->
              gatherScatter(
                  where(definition.get("where"), GATHER_SCATTER_COLUMNS, args), days, false);
          case "PASS_THROUGH" ->
              gatherScatter(where(definition.get("where"), PASS_THROUGH_COLUMNS, args), days, true);
          case "SCATTER_GATHER" ->
              scatterGather(where(definition.get("where"), SCATTER_GATHER_COLUMNS, args), days);
          case "SAME_AMOUNT" ->
              sameAmount(in, where(definition.get("where"), FAN_COLUMNS, args), days);
          case "STRUCTURING" ->
              fan(in, where(definition.get("where"), FAN_COLUMNS, args), days, "tx_count");
          default ->
              fan(
                  in,
                  where(definition.get("where"), FAN_COLUMNS, args),
                  days,
                  "distinct_counterparties");
        };
    return new Sql(sql, args);
  }

  /** 검사 날짜를 rule_days 에 있는 날짜로 좁히는 조건. rule_ftx 의 별칭은 f 다. */
  public static final String LISTED_DAYS =
      " and exists (select 1 from rule_days d where d.business_date = f.business_date)";

  // 대상 × 날짜마다 한 줄로 줄이는 꼬리. hit 에는 subject, at, business_date, window_from, strength, measured,
  // tx_ids 가 있어야 한다.
  // 측정값은 그날 가장 크게 넘은 검사 시점의 것, 근거 거래는 그날 적중한 검사 시점들의 근거 거래를 합친 것이다.
  // 세기와 시각이 같은 검사 시점이 여럿이면(같은 분에 금액이 다른 거래) 측정값 글자 순으로 하나를 고른다. 돌릴 때마다 같은 값이 나오게 하려는 것이다.
  // 측정값을 고르는 쪽과 근거 거래를 합치는 쪽을 따로 집계해 조인하면 PostgreSQL 이 한쪽을 줄마다 다시 계산하는 계획을 고른다. 그래서 한 번에 센다.
  private static final String PER_DAY =
      """
      , flat as (
        select h.subject, h.business_date, h.window_from, h.at, x,
               first_value(h.measured) over (partition by h.subject, h.business_date
                                             order by h.strength desc, h.at desc, h.measured::text desc) as measured
        from hit h cross join lateral unnest(h.tx_ids) x
      )
      insert into rule_result(subject_id, hit_date, measured, tx_ids, window_start, window_end)
      select subject, business_date, measured, array_agg(distinct x order by x), min(window_from), max(at)
      from flat group by subject, business_date, measured
      """;

  /**
   * FAN-OUT(대상 = 송금 계좌) · FAN-IN(대상 = 수취 계좌) · STRUCTURING(방향을 고른다). 기간 안 대상 계좌의 같은 방향 거래를 센다.
   *
   * @param strength 그날의 측정값으로 남길 검사 시점을 고르는 기준 열. FAN 은 상대 계좌 수, STRUCTURING 은 거래 건수다
   */
  private static String fan(boolean in, String where, String days, String strength) {
    String subject = in ? "to_account_id" : "from_account_id";
    String other = in ? "from_account_id" : "to_account_id";
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        trig as (
          select distinct f.%1$s as subject, f.at, f.business_date
          from rule_ftx f, params p
          where f.business_date between p.date_from and p.date_to%4$s
            and not exists (select 1 from rule_busy b where b.account_id = f.%1$s)
        ), agg as (
          select g.subject, g.at, g.business_date, min(w.at) as window_from,
                 count(distinct w.%2$s) as distinct_counterparties, count(*) as tx_count,
                 sum(w.amount_usd) as sum_usd, array_agg(w.tx_id) as tx_ids
          from trig g cross join params p
          join rule_ftx w on w.%1$s = g.subject and w.at <= g.at and w.at > g.at - p.span
          group by g.subject, g.at, g.business_date
        ), hit as (
          select subject, at, business_date, window_from, tx_ids, %5$s as strength,
                 jsonb_build_object('DISTINCT_COUNTERPARTIES', distinct_counterparties,
                                    'TX_COUNT', tx_count, 'SUM_USD', sum_usd) as measured
          from agg where %3$s
        )
        """
            .formatted(subject, other, where, days, strength)
        + PER_DAY;
  }

  /**
   * SAME_AMOUNT(방향을 고른다). 검사 시점은 대상 계좌의 그 방향 거래 하나하나이고, 기간 안 같은 방향 거래 가운데 금액이 검사 거래 금액의 ±N% 안인 것만
   * 센다(검사 거래 자신 포함, 경계 포함). 금액이 다르면 같은 분이어도 따로 검사한다. 금액이 0 인 거래는 보지 않는다.
   *
   * <p>? 순서: 기간(분), 검사 시작일, 검사 끝일, N, N, 그다음 적중 조건의 값들.
   */
  private static String sameAmount(boolean in, String where, String days) {
    String subject = in ? "to_account_id" : "from_account_id";
    String other = in ? "from_account_id" : "to_account_id";
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        near as (select 1 - ?::numeric / 100 as low, 1 + ?::numeric / 100 as high),
        trig as (
          select distinct f.%1$s as subject, f.at, f.business_date, f.amount_usd
          from rule_ftx f, params p
          where f.business_date between p.date_from and p.date_to%4$s and f.amount_usd > 0
            and not exists (select 1 from rule_busy b where b.account_id = f.%1$s)
        ), agg as (
          select g.subject, g.at, g.business_date, g.amount_usd, min(w.at) as window_from,
                 count(distinct w.%2$s) as distinct_counterparties, count(*) as tx_count,
                 sum(w.amount_usd) as sum_usd, array_agg(w.tx_id) as tx_ids
          from trig g cross join params p cross join near n
          join rule_ftx w on w.%1$s = g.subject and w.at <= g.at and w.at > g.at - p.span
           and w.amount_usd > 0 and w.amount_usd between g.amount_usd * n.low and g.amount_usd * n.high
          group by g.subject, g.at, g.business_date, g.amount_usd
        ), hit as (
          select subject, at, business_date, window_from, tx_ids, tx_count as strength,
                 jsonb_build_object('DISTINCT_COUNTERPARTIES', distinct_counterparties,
                                    'TX_COUNT', tx_count, 'SUM_USD', sum_usd) as measured
          from agg where %3$s
        )
        """
            .formatted(subject, other, where, days)
        + PER_DAY;
  }

  /** SAME_AMOUNT 의 "검사 거래와 비슷한 금액 ±N%" 의 N. 세는 거래의 맨 위 그룹에 한 줄 있다. */
  private static Number nearTriggerPercent(Map<String, Object> definition) {
    Number value = filterValue(definition, NEAR_TRIGGER_AMOUNT);
    if (value == null) throw new IllegalArgumentException("검사 거래와 비슷한 금액의 범위가 없습니다.");
    return value;
  }

  /**
   * GATHER-SCATTER · PASS_THROUGH(대상 = 가운데 계좌). 검사 시점은 그 계좌의 출금이다. 기간 안 입금을 모으고, 출금은 기간 안 첫 입금
   * 시각(같은 분 포함)부터 검사 시점까지의 것만 센다. 기간 안에 입금이 없으면 적중이 아니다.
   *
   * @param passThrough true 면 PASS_THROUGH. 상대 계좌 수는 보지 않고 받은 합계와 출금 ÷ 입금만 본다. 그날의 측정값은 통과한 금액(받은
   *     합계와 내보낸 합계 가운데 작은 쪽)이 가장 큰 검사 시점의 것이다
   */
  private static String gatherScatter(String where, String days, boolean passThrough) {
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        trig as (
          select distinct f.from_account_id as subject, f.at, f.business_date
          from rule_ftx f, params p
          where f.business_date between p.date_from and p.date_to%2$s
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
                 %3$s as strength,
                 %4$s as measured
          from agg where %1$s
        )
        """
            .formatted(
                where,
                days,
                passThrough
                    ? "least(in_usd, out_usd)"
                    : "least(in_counterparties, out_counterparties)",
                passThrough
                    ? "jsonb_build_object('SUM_USD', in_usd, 'OUT_IN_RATIO', round(out_usd * 100 / nullif(in_usd, 0), 2))"
                    : """
                      jsonb_build_object('IN_COUNTERPARTIES', in_counterparties,
                                         'OUT_COUNTERPARTIES', out_counterparties, 'SUM_USD', in_usd,
                                         'OUT_IN_RATIO', round(out_usd * 100 / nullif(in_usd, 0), 2))""")
        + PER_DAY;
  }

  /**
   * SCATTER-GATHER(대상 = 도착 계좌 D). 출발 계좌 S 가 경유 계좌 여러 개로 보내고, 그 경유 계좌들이 D 로 보낸다.
   *
   * <p>검사 시점은 D 로 들어온 2단계 거래(경유 → D) 가운데, 그 경유 계좌가 기간 안에 S 에서 먼저(같은 분 포함) 받은 것이다. 그 시각을 포함해 직전 기간
   * 안에서 "S → 경유" 가 "경유 → D" 보다 먼저 있는 경유 계좌 수를 (S, D) 마다 센다. S 와 D 는 다른 계좌다. 근거 거래는 그 경유 계좌들의 경유 → D
   * 거래와, 기간 안에서 그 경유 계좌의 마지막 경유 → D 거래까지의 S → 경유 거래다.
   */
  private static String scatterGather(String where, String days) {
    return """
        with params as (select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to),
        leg as (
          -- 2단계 거래(경유 → 도착) × 출발 계좌. at1 은 그 시각까지의 마지막 1단계(출발 → 경유) 시각이다.
          select w.tx_id, w.to_account_id as dest, v.from_account_id as source, w.from_account_id as mid,
                 w.at as at2, w.business_date, max(v.at) as at1
          from rule_ftx w cross join params p
          join rule_ftx v on v.to_account_id = w.from_account_id and v.clean
           and v.at <= w.at and v.at > w.at - p.span and v.from_account_id <> w.to_account_id
          where w.clean
          group by w.tx_id, w.to_account_id, v.from_account_id, w.from_account_id, w.at, w.business_date
        ), trig as (
          select distinct f.dest, f.source, f.at2 as at, f.business_date
          from leg f, params p
          where f.business_date between p.date_from and p.date_to%2$s
        ), mids as (
          -- 검사 시점 × 경유 계좌. at2max 는 그 경유 계좌가 기간 안에서 마지막으로 D 에 보낸 시각이다.
          select g.dest, g.source, g.at, g.business_date, r.mid, max(r.at2) as at2max
          from trig g cross join params p
          join leg r on r.dest = g.dest and r.source = g.source and r.at2 <= g.at and r.at1 > g.at - p.span
          group by g.dest, g.source, g.at, g.business_date, r.mid
        ), agg as (
          select dest, source, at, business_date, mid_count
          from (select dest, source, at, business_date, count(*) as mid_count
                from mids group by dest, source, at, business_date) counted
          where %1$s
        ), ev as (
          select m.dest, m.source, m.at, r.tx_id, null::timestamptz as at1
          from mids m cross join params p
          join leg r on r.dest = m.dest and r.source = m.source and r.mid = m.mid
           and r.at2 <= m.at and r.at1 > m.at - p.span
          union all
          select m.dest, m.source, m.at, v.tx_id, v.at
          from mids m cross join params p
          join rule_ftx v on v.from_account_id = m.source and v.to_account_id = m.mid and v.clean
           and v.at <= m.at2max and v.at > m.at - p.span
        ), hit as (
          select a.dest as subject, a.at, a.business_date, e.window_from, e.tx_ids, a.mid_count as strength,
                 jsonb_build_object('MID_COUNT', a.mid_count) as measured
          from agg a
          join (select dest, source, at, min(at1) as window_from, array_agg(distinct tx_id) as tx_ids
                from ev group by dest, source, at) e
            on e.dest = a.dest and e.source = a.source and e.at = a.at
        )
        """
            .formatted(where, days)
        + PER_DAY;
  }

  /**
   * 경로형(CYCLE, RANDOM)의 길을 임시 표 rule_walk 에 만든다. 검사 시점은 길의 마지막 거래이고, 거기서 돈이 온 쪽으로 한 단계씩 거꾸로 따라간다.
   *
   * <ul>
   *   <li>시간은 과거로만 간다(같은 분 포함). 첫 거래부터 마지막 거래까지가 기간 안이다
   *   <li>이어지는 두 거래는 뒤 거래 금액 ÷ 앞 거래 금액이 stepRatioMin ~ stepRatioMax 다
   *   <li>같은 계좌를 두 번 지나지 않는다. 마지막 거래의 수취 계좌로 돌아오면 순환이고(closed) 거기서 멈춘다
   *   <li>거래 수는 maxHops 까지다. 표에는 거래 2건 이상인 길을 전부 담는다(대상 = 마지막 거래의 수취 계좌)
   * </ul>
   *
   * <p>앞의 ? 순서: 기간(분), 검사 시작일, 검사 끝일, 금액 비 하한, 금액 비 상한, maxHops. 금액 비는 실험과 같이 실수(float8)로 계산한다.
   */
  public static Sql walks(
      Map<String, Object> definition, String from, String to, boolean listedDays) {
    Number window = RuleDefinition.number(definition.get("windowMinutes"));
    if (window == null) throw new IllegalArgumentException("기간이 없습니다.");
    var args =
        new ArrayList<Object>(
            List.of(
                window.intValue(),
                from,
                to,
                pathValue(definition, "stepRatioMin").doubleValue(),
                pathValue(definition, "stepRatioMax").doubleValue(),
                pathValue(definition, "maxHops").intValue()));
    return new Sql(
        """
        create temp table rule_walk on commit drop as
        with recursive params as (
          select make_interval(mins => ?) as span, ?::date as date_from, ?::date as date_to,
                 ?::float8 as ratio_min, ?::float8 as ratio_max, ?::int as max_hops
        ), walk as (
          select f.to_account_id as subject, f.at, f.business_date,
                 f.from_account_id as node, f.at as window_from, f.amount_usd::float8 as first_usd,
                 1 as hops, array[f.tx_id] as tx_ids,
                 array[f.to_account_id, f.from_account_id] as seen, false as closed
          from rule_ftx f, params p
          where f.clean and f.business_date between p.date_from and p.date_to%s
          union all
          select k.subject, k.at, k.business_date,
                 w.from_account_id, w.at, w.amount_usd::float8,
                 k.hops + 1, w.tx_id || k.tx_ids, k.seen || w.from_account_id,
                 w.from_account_id = k.subject
          from walk k cross join params p
          join rule_ftx w on w.to_account_id = k.node and w.clean
           and w.at <= k.window_from and w.at > k.at - p.span
           and k.first_usd between w.amount_usd::float8 * p.ratio_min and w.amount_usd::float8 * p.ratio_max
          where not k.closed and k.hops < p.max_hops
            and (w.from_account_id = k.subject or w.from_account_id <> all(k.seen))
        )
        select subject, at, business_date, window_from, hops, tx_ids, closed from walk where hops >= 2
        """
            .formatted(listedDays ? LISTED_DAYS : ""),
        args);
  }

  /** 정의의 path 에 있는 값. 없으면 예외다(검증을 통과한 경로형 정의에는 있다). */
  private static Number pathValue(Map<String, Object> definition, String key) {
    Number value =
        definition.get("path") instanceof Map<?, ?> path
            ? RuleDefinition.number(path.get(key))
            : null;
    if (value == null) throw new IllegalArgumentException("경로 값 " + key + " 가 없습니다.");
    return value;
  }

  /**
   * 정의에서 맨 위 그룹의 첫 조건 가운데 metric 이 같은 것의 값만 바꾼 정의. 그런 조건이 없으면 null. metric 이 {@link #MIN_HOPS} 면
   * path 의 값을 바꾼다.
   */
  public static Map<String, Object> withMetricValue(
      Map<String, Object> definition, String metric, Number value) {
    if (MIN_HOPS.equals(metric)) {
      if (!(definition.get("path") instanceof Map<?, ?> source)) return null;
      var path = new LinkedHashMap<String, Object>();
      source.forEach((k, v) -> path.put(String.valueOf(k), v));
      path.put(MIN_HOPS, value);
      var copy = new LinkedHashMap<>(definition);
      copy.put("path", path);
      return copy;
    }
    var changed = withFirstValue(definition, "where", "metric", metric, value);
    return changed != null ? changed : withFirstValue(definition, "filter", "field", metric, value);
  }

  /** group("where" 또는 "filter")의 맨 위 조건 가운데 id 가 name 인 첫 줄의 값만 바꾼 정의. 그런 줄이 없으면 null. */
  private static Map<String, Object> withFirstValue(
      Map<String, Object> definition, String group, String id, String name, Number value) {
    var items = new ArrayList<Object>();
    boolean replaced = false;
    for (Object item : RuleDefinition.items(definition.get(group))) {
      if (!replaced && item instanceof Map<?, ?> condition && name.equals(condition.get(id))) {
        var copy = new LinkedHashMap<String, Object>();
        condition.forEach((k, v) -> copy.put(String.valueOf(k), v));
        copy.put("value", value);
        items.add(copy);
        replaced = true;
      } else items.add(item);
    }
    if (!replaced) return null;
    var changed = new LinkedHashMap<String, Object>();
    ((Map<?, ?>) definition.get(group)).forEach((k, v) -> changed.put(String.valueOf(k), v));
    changed.put("items", items);
    var copy = new LinkedHashMap<>(definition);
    copy.put(group, changed);
    return copy;
  }

  /**
   * 값을 바꿔 볼 항목의 지금 값. 적중 조건의 맨 위 첫 줄에서 찾고, 없으면 세는 거래의 맨 위 첫 줄에서 찾는다(LARGE_TX 의 건당 금액). 없으면 null.
   * metric 이 {@link #MIN_HOPS} 면 path 의 값이다.
   */
  public static Number metricValue(Map<String, Object> definition, String metric) {
    if (MIN_HOPS.equals(metric))
      return definition.get("path") instanceof Map<?, ?> path
          ? RuleDefinition.number(path.get(MIN_HOPS))
          : null;
    for (Object item : RuleDefinition.items(definition.get("where")))
      if (item instanceof Map<?, ?> condition && metric.equals(condition.get("metric")))
        return RuleDefinition.number(condition.get("value"));
    return filterValue(definition, metric);
  }

  /** 세는 거래의 맨 위 조건 가운데 field 가 같은 첫 줄의 값. 없으면 null. */
  public static Number filterValue(Map<String, Object> definition, String field) {
    for (Object item : RuleDefinition.items(definition.get("filter")))
      if (item instanceof Map<?, ?> condition && field.equals(condition.get("field")))
        return RuleDefinition.number(condition.get("value"));
    return null;
  }

  /** 그 항목의 값을 바꾸면 세는 거래가 달라지는가. 그러면 값을 바꿔 볼 때 세는 거래부터 다시 걸러야 한다. */
  public static boolean sweepsFilter(Map<String, Object> definition, String metric) {
    if (MIN_HOPS.equals(metric)) return false;
    for (Object item : RuleDefinition.items(definition.get("where")))
      if (item instanceof Map<?, ?> condition && metric.equals(condition.get("metric")))
        return false;
    return filterValue(definition, metric) != null;
  }
}
