package com.moneylaundry.api.rules;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.definition.RuleDefinition;
import com.moneylaundry.api.rules.engine.RuleCompiler;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Alert · Episode 에 걸린 룰 적중. 연결을 따로 저장하지 않고, 사건의 현재 거래와 적중의 근거 거래에 같은 거래가 있으면 걸린 것으로 본다. 그래서 Alert
 * 가 나중에 자라거나 합쳐져도 맞출 것이 없다.
 *
 * <p>보여 주는 적중은 운영 중일 때 만든 것(LIVE)이고, 실행과 그 분석이 끝난 것뿐이다. 시험 운영의 적중은 나오지 않는다. 지금은 중지했거나 물러난 버전이 운영 중일
 * 때 만든 적중은 그대로 나온다.
 */
@Service
public class RuleHitQuery {
  private static final String TX_USD = "TX_USD";
  private final JdbcTemplate jdbc;
  private final RuleCatalog catalog;

  public RuleHitQuery(JdbcTemplate jdbc, RuleCatalog catalog) {
    this.jdbc = jdbc;
    this.catalog = catalog;
  }

  /** 카드 한 장 = 사건 안의 Alert × 룰 버전 × 대상. 여러 날 걸렸으면 날짜를 모으고 측정값은 가장 최근 날의 것이다. */
  public List<Map<String, Object>> forCase(long caseId) {
    if (!Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from review.visible_cases where case_id=?)",
            Boolean.class,
            caseId))) throw ApiException.notFound("사건이 없습니다.");
    var cards = new LinkedHashMap<String, Map<String, Object>>();
    var matched = new LinkedHashMap<String, TreeSet<Long>>();
    var evidence = new LinkedHashMap<String, TreeSet<Long>>();
    var subjects = new LinkedHashMap<String, Long>();
    for (var row :
        jdbc.queryForList(
            """
            select m.alert_id, h.hit_id, h.version_id, h.subject_type, h.subject_id, h.hit_date::text as hit_date,
                   h.measured::text as measured, v.version_no, v.status as version_status, v.summary,
                   v.definition::text as definition, r.rule_id, r.name, r.template,
                   left(a.service_account_id::text, 8) as subject,
                   array_to_string(array_agg(distinct m.tx_id), ',') as matched,
                   (select array_to_string(array_agg(x.tx_id), ',') from rules.hit_transactions x
                    where x.hit_id = h.hit_id) as evidence
            from review.current_members m
            join rules.hit_transactions ht on ht.tx_id = m.tx_id
            join rules.hits h on h.hit_id = ht.hit_id and h.mode = 'LIVE'
            join rules.executions e on e.execution_id = h.execution_id and e.status = 'COMPLETED'
            join analysis.runs n on n.run_id = e.run_id and n.status = 'COMPLETED'
            join rules.rule_versions v on v.version_id = h.version_id
            join rules.rules r on r.rule_id = v.rule_id
            left join core.accounts a on h.subject_type = 'ACCOUNT' and a.account_id = h.subject_id
            where m.case_id = ? and m.state in ('PENDING','DECIDED')
            group by m.alert_id, h.hit_id, v.version_id, r.rule_id, a.account_id
            order by r.rule_id, v.version_no desc, a.account_id, m.alert_id, h.hit_date desc, h.subject_id
            """,
            caseId)) {
      // 대상이 거래인 룰(LARGE_TX)은 걸린 거래마다 카드를 만들지 않고 Alert × 룰 버전으로 한 장에 모은다
      boolean transaction = "TX".equals(row.get("subject_type"));
      String key =
          row.get("alert_id")
              + "|"
              + row.get("version_id")
              + "|"
              + (transaction ? "TX" : row.get("subject_id"));
      var card = cards.get(key);
      if (card == null) {
        // 날짜가 최근인 줄이 먼저 오므로 측정값은 가장 최근 날의 것이다
        card = card(row);
        cards.put(key, card);
        matched.put(key, new TreeSet<>());
        evidence.put(key, new TreeSet<>());
        subjects.put(key, ReviewJson.number(row.get("subject_id")));
      }
      if (!dates(card).contains(row.get("hit_date").toString()))
        dates(card).add(row.get("hit_date").toString());
      if (transaction) largest(card, ReviewJson.object(row.get("measured")));
      for (String tx : row.get("matched").toString().split(","))
        matched.get(key).add(Long.valueOf(tx));
      for (String tx : row.get("evidence").toString().split(","))
        evidence.get(key).add(Long.valueOf(tx));
    }
    var out = new ArrayList<Map<String, Object>>();
    for (var entry : cards.entrySet()) {
      var card = entry.getValue();
      dates(card).sort(Comparator.naturalOrder());
      card.put("matchedTxIds", new ArrayList<>(matched.get(entry.getKey())));
      card.put("evidenceTxCount", evidence.get(entry.getKey()).size());
      card.put(
          "roles",
          roles(
              String.valueOf(card.get("template")),
              subjects.get(entry.getKey()),
              evidence.get(entry.getKey())));
      out.add(card);
    }
    return out;
  }

  @SuppressWarnings("unchecked")
  private static List<String> dates(Map<String, Object> card) {
    return (List<String>) card.get("hitDates");
  }

  /** 거래 여러 건을 모은 카드의 측정값은 그 가운데 금액이 가장 큰 거래의 것이다. 조건 줄의 "실제 값"도 그 값으로 맞춘다. */
  @SuppressWarnings("unchecked")
  private static void largest(Map<String, Object> card, Map<String, Object> measured) {
    var kept = (Map<String, Object>) card.get("measured");
    if (amount(measured.get(TX_USD)) <= amount(kept.get(TX_USD))) return;
    kept.put(TX_USD, measured.get(TX_USD));
    for (var line : (List<Map<String, Object>>) card.get("conditions"))
      if (TX_USD.equals(line.get("metric"))) line.put("measured", measured.get(TX_USD));
  }

  private static double amount(Object value) {
    return value instanceof Number number ? number.doubleValue() : 0;
  }

  private Map<String, Object> card(Map<String, Object> row) {
    var definition = RuleDefinition.canonical(row.get("definition"));
    var measured = ReviewJson.object(row.get("measured"));
    var template = catalog.template(row.get("template").toString());
    String side =
        template == null ? "FROM" : RuleCatalog.side(template, definition.get("direction"));
    long ruleId = ReviewJson.number(row.get("rule_id"));
    var card = new LinkedHashMap<String, Object>();
    card.put("alertId", row.get("alert_id"));
    card.put("ruleId", ruleId);
    card.put("code", RuleService.code(ruleId));
    card.put("name", row.get("name"));
    card.put("template", row.get("template"));
    card.put("templateName", template == null ? row.get("template") : template.get("name"));
    card.put("pattern", template == null ? null : template.get("pattern"));
    card.put("versionId", row.get("version_id"));
    card.put("versionNo", row.get("version_no"));
    card.put("versionStatus", row.get("version_status"));
    card.put("summary", row.get("summary"));
    // 대상이 거래면 subject 는 없다(null). 걸린 거래는 matchedTxIds 에 있다.
    card.put("subjectType", row.get("subject_type"));
    card.put("subjectLabel", template == null ? null : template.get("subjectLabel"));
    card.put("subject", row.get("subject"));
    card.put("hitDates", new ArrayList<String>());
    card.put("windowMinutes", definition.get("windowMinutes"));
    card.put("measured", measured);
    var conditions = new ArrayList<Map<String, Object>>();
    if (RuleCompiler.path(row.get("template"))) conditions.add(hops(definition, row, measured));
    if ("TX".equals(row.get("subject_type")))
      amounts(definition.get("filter"), measured, conditions);
    conditions(definition.get("where"), side, measured, conditions);
    card.put("conditions", conditions);
    return card;
  }

  /**
   * 대상이 거래인 룰(LARGE_TX)은 적중 조건이 없고 세는 거래의 건당 금액이 곧 조건이다. "건당 금액 ≥ 10,000 USD, 실제 12,300 USD" 로 만든다.
   * 금액 말고 다른 세는 거래 조건(처음 거래하는 상대 등)은 잰 값이 없어 줄을 만들지 않는다.
   */
  private void amounts(Object group, Map<String, Object> measured, List<Map<String, Object>> out) {
    var spec = catalog.filterField(TX_USD);
    for (Object item : RuleDefinition.items(group)) {
      if (RuleDefinition.group(item)) {
        amounts(item, measured, out);
        continue;
      }
      if (!(item instanceof Map<?, ?> condition) || !TX_USD.equals(condition.get("field")))
        continue;
      var line = new LinkedHashMap<String, Object>();
      line.put("metric", TX_USD);
      line.put("label", RuleCatalog.text(spec.get("label"), ""));
      line.put("cmp", condition.get("cmp"));
      line.put("value", condition.get("value"));
      line.put("unit", spec.get("unit"));
      line.put("measured", measured.get(TX_USD));
      out.add(line);
    }
  }

  /** 경로형의 조건은 적중 조건(where)이 아니라 path.minHops 에 있다. "순환 거래 수 ≥ 3건, 실제 4건" 한 줄로 만든다. */
  private Map<String, Object> hops(
      Map<String, Object> definition, Map<String, Object> row, Map<String, Object> measured) {
    var spec = catalog.pathField(RuleCompiler.MIN_HOPS);
    var line = new LinkedHashMap<String, Object>();
    line.put("metric", RuleCompiler.MIN_HOPS);
    line.put("label", RuleCatalog.text(spec.get("label"), row.get("template").toString()));
    line.put("cmp", "GTE");
    line.put("value", ReviewJson.object(definition.get("path")).get(RuleCompiler.MIN_HOPS));
    line.put("unit", spec.get("unit"));
    line.put("measured", measured.get("HOPS"));
    return line;
  }

  /**
   * 대상 말고도 보여 줄 계좌. 따로 저장하지 않고 근거 거래에서 읽는다. 집계형 템플릿에는 없다.
   *
   * <ul>
   *   <li>SCATTER-GATHER: 대상(도착 계좌)에 보낸 계좌가 경유 계좌(MID), 경유 계좌에 보낸 계좌가 출발 계좌(SOURCE)
   *   <li>CYCLE · RANDOM: 근거 거래에 나오는 대상 아닌 계좌가 경로 계좌(PATH)
   * </ul>
   *
   * 순서는 그 계좌가 처음 보낸 거래의 시각 순이다. 경로가 하나면 경로를 따라간 순서와 같다.
   */
  private List<Map<String, Object>> roles(String template, long subject, Collection<Long> txIds) {
    boolean twoHop = "SCATTER_GATHER".equals(template);
    if (!twoHop && !RuleCompiler.path(template)) return List.of();
    var rows =
        jdbc.queryForList(
            """
            select t.from_account_id, t.to_account_id, left(a.service_account_id::text, 8) as sender
            from ledger.transactions t join core.accounts a on a.account_id = t.from_account_id
            where t.tx_id = any(?::bigint[])
            order by t.occurred_at, t.tx_id
            """,
            txIds.stream().map(String::valueOf).collect(Collectors.joining(",", "{", "}")));
    var mids = new LinkedHashSet<Long>();
    for (var row : rows)
      if (ReviewJson.number(row.get("to_account_id")) == subject)
        mids.add(ReviewJson.number(row.get("from_account_id")));
    var sources = new LinkedHashSet<String>();
    var others = new LinkedHashSet<String>();
    for (var row : rows) {
      long from = ReviewJson.number(row.get("from_account_id"));
      long to = ReviewJson.number(row.get("to_account_id"));
      String sender = row.get("sender").toString();
      if (!twoHop) {
        if (from != subject) others.add(sender);
      } else if (to == subject) others.add(sender);
      else if (mids.contains(to)) sources.add(sender);
    }
    var out = new ArrayList<Map<String, Object>>();
    for (String account : sources) out.add(role("SOURCE", "출발 계좌", account));
    for (String account : others)
      out.add(twoHop ? role("MID", "경유 계좌", account) : role("PATH", "경로 계좌", account));
    return out;
  }

  private static Map<String, Object> role(String role, String label, String account) {
    var item = new LinkedHashMap<String, Object>();
    item.put("role", role);
    item.put("label", label);
    item.put("accountId", account);
    return item;
  }

  /** 적중 조건을 한 줄씩 펴서 "조건 vs 실제 값" 으로 만든다. 그룹은 풀어서 순서대로 늘어놓는다. */
  private void conditions(
      Object group, String side, Map<String, Object> measured, List<Map<String, Object>> out) {
    for (Object item : RuleDefinition.items(group)) {
      if (RuleDefinition.group(item)) {
        conditions(item, side, measured, out);
        continue;
      }
      if (!(item instanceof Map<?, ?> condition)) continue;
      String metric = String.valueOf(condition.get("metric"));
      var spec = catalog.metric(metric);
      if (spec == null) continue;
      boolean flag = "flag".equals(spec.get("kind"));
      var line = new LinkedHashMap<String, Object>();
      line.put("metric", metric);
      line.put("label", RuleCatalog.text(spec.get(flag ? "phrase" : "label"), side));
      line.put("cmp", flag ? null : condition.get("cmp"));
      line.put("value", flag ? null : condition.get("value"));
      line.put("unit", spec.get("unit"));
      line.put("measured", measured.get(metric));
      out.add(line);
    }
  }
}
