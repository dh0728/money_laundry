package com.moneylaundry.api.rules;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.definition.RuleDefinition;
import com.moneylaundry.api.rules.definition.RuleSentence;
import com.moneylaundry.api.rules.definition.RuleValidator;
import java.util.*;
import org.junit.jupiter.api.Test;

/** 템플릿 카탈로그, 룰 정의의 지문, 저장 전 검증, 문장 변환. DB 없이 돈다. */
class RuleDefinitionTests {
  static final List<String> TEMPLATES =
      List.of(
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
  static final RuleValidator.Facts LEDGER = new RuleValidator.Facts(16, List.of());
  final RuleCatalog catalog = new RuleCatalog();

  RuleValidator.Result check(String template, Object definition) {
    return RuleValidator.check(catalog, template, definition, LEDGER);
  }

  static RuleValidator.Item item(RuleValidator.Result result, String key) {
    return result.items().stream().filter(item -> item.key().equals(key)).findFirst().orElseThrow();
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> group(Map<String, Object> definition, String key) {
    return (Map<String, Object>) definition.get(key);
  }

  @SuppressWarnings("unchecked")
  static List<Object> items(Map<String, Object> group) {
    return (List<Object>) group.get("items");
  }

  /** kind 는 field(세는 거래) 또는 metric(적중 조건). cmp 가 null 이면 "이면" 꼴 조건이다. */
  static Map<String, Object> condition(String kind, String key, String cmp, Object value) {
    var condition = new LinkedHashMap<String, Object>();
    condition.put(kind, key);
    if (cmp != null) condition.put("cmp", cmp);
    if (value != null) condition.put("value", value);
    return condition;
  }

  static Map<String, Object> any(Object... conditions) {
    var group = new LinkedHashMap<String, Object>();
    group.put("op", "ANY");
    group.put("items", new ArrayList<>(List.of(conditions)));
    return group;
  }

  /** 형식에서 걸려 저장할 수 없다. */
  void rejected(String template, Map<String, Object> definition, String message) {
    var result = check(template, definition);
    assertThat(result.canSave()).as(message).isFalse();
    assertThat(result.definition()).isNull();
    assertThat(String.join("\n", item(result, "FORMAT").errors())).contains(message);
  }

  /** 저장은 되지만 백테스트·시험 운영·승인 요청은 못 한다. */
  void incomplete(String template, Map<String, Object> definition, String key, String message) {
    var result = check(template, definition);
    assertThat(result.canSave()).as(message).isTrue();
    assertThat(result.canRun()).as(message).isFalse();
    assertThat(String.join("\n", item(result, key).errors())).contains(message);
  }

  @Test
  void catalog_offers_six_pattern_and_four_general_templates_with_runnable_defaults() {
    var available = new ArrayList<String>();
    for (var template : ReviewJson.rows(catalog.view().get("templates")))
      if (RuleCatalog.available(template)) available.add(template.get("key").toString());
    assertThat(available).isEqualTo(TEMPLATES);
    for (String key : TEMPLATES) {
      var result = check(key, catalog.defaults(key));
      assertThat(result.canSave()).as(key).isTrue();
      assertThat(result.canRun()).as(key).isTrue();
      assertThat(result.warnings()).as(key).isEmpty();
      assertThat(result.items()).hasSize(4);
      assertThat(RuleSentence.sentence(catalog, result.definition())).as(key).isNotEmpty();
      assertThat(RuleSentence.summary(catalog, result.definition())).as(key).isNotEmpty();
      assertThat(RuleDefinition.digest(result.definition())).matches("[0-9a-f]{64}");
      assertThat(result.definition().get("then")).isEqualTo("ATTACH_EVIDENCE");
    }
    // 이후 제공 템플릿과 없는 템플릿은 기본값이 없고 저장할 수 없다.
    assertThat(catalog.defaults("DORMANT_ACTIVATION")).isNull();
    assertThat(check("DORMANT_ACTIVATION", catalog.defaults("FAN_IN")).canSave()).isFalse();
    assertThat(check("NO_SUCH", catalog.defaults("FAN_IN")).canSave()).isFalse();
    assertThat(check("FAN_IN", null).canSave()).isFalse();
  }

  @Test
  void defaults_match_the_template_definition_document() {
    assertThat(ReviewJson.encode(RuleDefinition.canonical(catalog.defaults("FAN_IN"))))
        .isEqualTo(
            "{\"schema\":2,\"template\":\"FAN_IN\",\"windowMinutes\":10080,"
                + "\"filter\":{\"op\":\"ALL\",\"items\":[{\"field\":\"FIRST_PAIR\"},{\"field\":\"FX_FOLLOW\"}]},"
                + "\"where\":{\"op\":\"ALL\",\"items\":[{\"metric\":\"DISTINCT_COUNTERPARTIES\",\"cmp\":\"GTE\",\"value\":3}]},"
                + "\"then\":\"ATTACH_EVIDENCE\"}");
    var summaries = new LinkedHashMap<String, String>();
    for (String key : TEMPLATES)
      summaries.put(
          key, RuleSentence.summary(catalog, RuleDefinition.canonical(catalog.defaults(key))));
    assertThat(summaries.get("FAN_OUT")).isEqualTo("첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일");
    assertThat(summaries.get("FAN_IN")).isEqualTo("첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일");
    assertThat(summaries.get("GATHER_SCATTER"))
        .isEqualTo("첫 거래 상대 · 건당 5,000 USD 이상 · 송금 계좌 2개 이상 · 첫 입금 뒤 수취 계좌 2개 이상 · 7일");
    assertThat(summaries.get("SCATTER_GATHER")).isEqualTo("건당 1,000 USD 이상 · 경유 계좌 4개 이상 · 7일");
    assertThat(summaries.get("CYCLE")).isEqualTo("순환 거래 3건 이상 · 금액 비 0.8 ~ 1.25 · 7일");
    assertThat(summaries.get("RANDOM"))
        .isEqualTo("건당 1,000 USD 이상 · 첫 거래 상대 또는 환전 직후 · 경로 거래 3건 이상 · 금액 비 0.8 ~ 1.25 · 3일");
    assertThat(summaries.get("LARGE_TX")).isEqualTo("첫 거래 상대 · 건당 10,000 USD 이상");
    assertThat(summaries.get("STRUCTURING"))
        .isEqualTo("출금 · 첫 거래 상대 · 건당 5,000 USD 이상 · 건당 10,000 USD 미만 · 거래 2건 이상 · 7일");
    assertThat(summaries.get("SAME_AMOUNT"))
        .isEqualTo("출금 · 첫 거래 상대 · 건당 1,000 USD 이상 · 검사 거래 금액 ±5% · 거래 2건 이상 · 3일");
    assertThat(summaries.get("PASS_THROUGH"))
        .isEqualTo("첫 거래 상대 · 건당 1,000 USD 이상 · 출금 ÷ 입금 80% 이상 · 출금 ÷ 입금 125% 이하 · 3일");
  }

  @Test
  void sentence_reads_counted_transactions_then_the_hit_condition() {
    assertThat(
            RuleSentence.sentence(catalog, RuleDefinition.canonical(catalog.defaults("FAN_OUT"))))
        .isEqualTo(
            "처음 거래하는 상대이고 건당 금액이 1,000 USD 이상인 거래만 세어, 한 송금 계좌에서 7일 안에 서로 다른 수취 계좌 수가 6개 이상이면 Alert에 근거로 표시합니다.");
    assertThat(RuleSentence.sentence(catalog, RuleDefinition.canonical(catalog.defaults("RANDOM"))))
        .isEqualTo(
            "건당 금액이 1,000 USD 이상이고 (처음 거래하는 상대 또는 환전 직후 송금)인 거래만 세어, 3일 안에 금액 비 0.8 ~ 1.25로 이어진 거래가 3건 이상(12건까지 따라감)이면 Alert에 근거로 표시합니다.");
    assertThat(RuleSentence.sentence(catalog, RuleDefinition.canonical(catalog.defaults("CYCLE"))))
        .isEqualTo(
            "모든 거래를 세어, 7일 안에 금액 비 0.8 ~ 1.25로 이어진 거래 3건 이상(12건까지 따라감)이 출발 계좌로 돌아오면 Alert에 근거로 표시합니다.");
    assertThat(
            RuleSentence.sentence(catalog, RuleDefinition.canonical(catalog.defaults("LARGE_TX"))))
        .isEqualTo("처음 거래하는 상대이고 건당 금액이 10,000 USD 이상인 거래가 들어오면 Alert에 근거로 표시합니다.");
    assertThat(
            RuleSentence.sentence(
                catalog, RuleDefinition.canonical(catalog.defaults("SAME_AMOUNT"))))
        .isEqualTo(
            "출금 가운데 처음 거래하는 상대이고 건당 금액이 1,000 USD 이상이고 금액이 검사 거래 금액의 ±5% 안인 거래만 세어, 한 계좌에서 3일 안에 거래 건수가 2건 이상이면 Alert에 근거로 표시합니다.");
    // 방향을 입금으로 바꾸면 상대 계좌의 이름이 바뀐다. 값이 빈 조건은 ? 로 읽힌다.
    var structuring = catalog.defaults("STRUCTURING");
    structuring.put("direction", "IN");
    items(group(structuring, "where"))
        .add(
            any(
                condition("metric", "DISTINCT_COUNTERPARTIES", "GT", null),
                condition("metric", "SUM_USD", "EQ", 12500.5)));
    assertThat(RuleSentence.sentence(catalog, RuleDefinition.canonical(structuring)))
        .isEqualTo(
            "입금 가운데 처음 거래하는 상대이고 건당 금액이 5,000 USD 이상이고 건당 금액이 10,000 USD 미만인 거래만 세어, 한 계좌에서 7일 안에 거래 건수가 2건 이상이고 (서로 다른 송금 계좌 수가 ?개 초과이거나 받은 총액이 12,500.5 USD)이면 Alert에 근거로 표시합니다.");
  }

  @Test
  void digest_is_the_same_for_the_same_conditions_however_they_are_written() {
    var written =
        ReviewJson.object(
            """
            {"then":"ATTACH_EVIDENCE","where":{"items":[{"value":3.0,"cmp":"GTE","metric":"DISTINCT_COUNTERPARTIES"}],"op":"ALL"},
             "filter":{"items":[{"field":"FIRST_PAIR","cmp":null},{"field":"FX_FOLLOW"}],"op":"ALL"},
             "windowMinutes":10080.0,"template":"FAN_IN","schema":2,"direction":null,"path":null}
            """);
    var result = check("FAN_IN", written);
    assertThat(result.canRun()).isTrue();
    String digest = RuleDefinition.digest(result.definition());
    assertThat(digest)
        .isEqualTo(RuleDefinition.digest(RuleDefinition.canonical(catalog.defaults("FAN_IN"))));
    // 저장했다가 다시 읽어도(JSONB 는 키 순서를 바꾼다) 같은 지문이다.
    assertThat(RuleDefinition.digest(RuleDefinition.canonical(ReviewJson.encode(written))))
        .isEqualTo(digest);
    var changed = catalog.defaults("FAN_IN");
    group(changed, "where")
        .put("items", List.of(condition("metric", "DISTINCT_COUNTERPARTIES", "GTE", 4)));
    assertThat(RuleDefinition.digest(RuleDefinition.canonical(changed))).isNotEqualTo(digest);
  }

  @Test
  void definition_outside_the_catalog_cannot_be_saved() {
    var definition = catalog.defaults("FAN_IN");
    items(group(definition, "where")).add(condition("metric", "OUT_IN_RATIO", "GTE", 80));
    rejected("FAN_IN", definition, "적중 조건에 쓸 수 없는 항목입니다: OUT_IN_RATIO");
    // 실험에서 써 보지 않은 항목은 카탈로그에 없다.
    for (String excluded : List.of("RETAIN_RATIO", "SUBJECT_AGE_DAYS", "CROSS_BORDER_COUNT")) {
      definition = catalog.defaults("FAN_OUT");
      items(group(definition, "where")).add(condition("metric", excluded, "GTE", 1));
      rejected("FAN_OUT", definition, excluded);
    }
    definition = catalog.defaults("CYCLE");
    items(group(definition, "where")).add(condition("metric", "SUM_USD", "GTE", 1000));
    rejected("CYCLE", definition, "이 템플릿은 적중 조건을 두지 않습니다.");

    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "filter")).add(condition("field", "NEAR_TRIGGER_AMOUNT", "WITHIN", 5));
    rejected("FAN_OUT", definition, "세는 거래에 쓸 수 없는 항목입니다: NEAR_TRIGGER_AMOUNT");
    definition = catalog.defaults("SAME_AMOUNT");
    items(group(definition, "filter"))
        .add(any(condition("field", "NEAR_TRIGGER_AMOUNT", "WITHIN", 5)));
    rejected("SAME_AMOUNT", definition, "ANY 그룹 안에 둘 수 없습니다.");
    definition = catalog.defaults("RANDOM");
    items(group(definition, "filter")).add(any(condition("field", "FIRST_PAIR", null, null)));
    rejected("RANDOM", definition, "ANY 그룹을 하나만 둘 수 있습니다.");
    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "filter")).add(any(any(condition("field", "FIRST_PAIR", null, null))));
    rejected("FAN_OUT", definition, "ANY 그룹 안에는 조건만 둘 수 있습니다.");
    definition = catalog.defaults("FAN_OUT");
    group(definition, "filter").put("op", "ANY");
    rejected("FAN_OUT", definition, "세는 거래(filter)는 ALL 그룹 하나여야 합니다.");
    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "filter")).add(condition("field", "TX_USD", "WITHIN", 5));
    rejected("FAN_OUT", definition, "'건당 금액' 조건의 비교가 허용 목록에 없습니다.");
    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "filter")).add(condition("field", "FIRST_PAIR", "GTE", 1));
    rejected("FAN_OUT", definition, "'처음 거래하는 상대' 조건은 비교와 값을 갖지 않습니다.");

    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "where")).add(any(any(condition("metric", "TX_COUNT", "GTE", 2))));
    rejected("FAN_OUT", definition, "그룹은 2단계까지 둘 수 있습니다.");
    definition = catalog.defaults("FAN_OUT");
    for (int i = 0; i < 10; i++)
      items(group(definition, "where")).add(condition("metric", "TX_COUNT", "GTE", 2 + i));
    rejected("FAN_OUT", definition, "적중 조건은 10개까지 둘 수 있습니다.");
    definition = catalog.defaults("FAN_OUT");
    items(group(definition, "where")).add(condition("metric", "TX_COUNT", "GTE", "many"));
    rejected("FAN_OUT", definition, "'거래 건수' 값이 숫자가 아닙니다.");

    definition = catalog.defaults("FAN_OUT");
    definition.put("windowMinutes", 90);
    rejected("FAN_OUT", definition, "기간을 목록에서 골라야 합니다.");
    definition = catalog.defaults("LARGE_TX");
    definition.put("windowMinutes", 1440);
    rejected("LARGE_TX", definition, "이 템플릿은 기간을 쓰지 않습니다.");
    definition = catalog.defaults("STRUCTURING");
    definition.remove("direction");
    rejected("STRUCTURING", definition, "방향(입금 · 출금)을 골라야 합니다.");
    definition = catalog.defaults("FAN_IN");
    definition.put("direction", "IN");
    rejected("FAN_IN", definition, "이 템플릿은 방향을 고르지 않습니다.");
    definition = catalog.defaults("FAN_IN");
    definition.put("path", group(catalog.defaults("CYCLE"), "path"));
    rejected("FAN_IN", definition, "이 템플릿은 경로 값(path)을 쓰지 않습니다.");
    definition = catalog.defaults("CYCLE");
    group(definition, "path").remove("stepRatioMax");
    rejected("CYCLE", definition, "금액 비 범위를 채워야 합니다.");
    definition = catalog.defaults("FAN_IN");
    definition.put("schema", 1);
    rejected("FAN_IN", definition, "schema");
    definition = catalog.defaults("FAN_IN");
    definition.put("sql", "select 1");
    rejected("FAN_IN", definition, "알 수 없는 항목입니다: sql");
    rejected("FAN_OUT", catalog.defaults("FAN_IN"), "정의의 템플릿이 룰의 템플릿과 다릅니다.");

    // Alert 생성은 아직 고를 수 없다.
    definition = catalog.defaults("FAN_IN");
    definition.put("then", "CREATE_ALERT");
    rejected("FAN_IN", definition, "'Alert 생성' 은 아직 고를 수 없습니다.");
    definition = catalog.defaults("FAN_IN");
    definition.put("then", "DELETE_ACCOUNT");
    rejected("FAN_IN", definition, "THEN 을 골라야 합니다.");
  }

  @Test
  void unfinished_draft_is_saved_but_cannot_run() {
    var definition = catalog.defaults("FAN_OUT");
    group(definition, "where")
        .put(
            "items",
            new ArrayList<>(List.of(condition("metric", "DISTINCT_COUNTERPARTIES", "GTE", null))));
    incomplete("FAN_OUT", definition, "CONDITIONS", "'서로 다른 수취 계좌 수' 값이 비어 있습니다.");
    assertThat(item(check("FAN_OUT", definition), "COST").ok()).isTrue();
    group(definition, "where")
        .put(
            "items",
            new ArrayList<>(List.of(condition("metric", "DISTINCT_COUNTERPARTIES", "GTE", 0))));
    incomplete("FAN_OUT", definition, "CONDITIONS", "'서로 다른 수취 계좌 수' 값은 1 이상 1,000 이하여야 합니다.");
    group(definition, "where")
        .put(
            "items",
            new ArrayList<>(List.of(condition("metric", "DISTINCT_COUNTERPARTIES", "GTE", 2.5))));
    incomplete("FAN_OUT", definition, "CONDITIONS", "값은 정수여야 합니다.");
    group(definition, "where").put("items", new ArrayList<>());
    incomplete("FAN_OUT", definition, "CONDITIONS", "적중 조건이 1개 이상 필요합니다.");
    group(definition, "where").put("items", new ArrayList<>(List.of(any())));
    incomplete("FAN_OUT", definition, "CONDITIONS", "적중 조건에 빈 그룹이 있습니다.");

    definition = catalog.defaults("FAN_IN");
    items(group(definition, "filter")).add(condition("field", "FIRST_PAIR", null, null));
    incomplete("FAN_IN", definition, "CONDITIONS", "'처음 거래하는 상대' 조건이 두 번 들어 있습니다.");
    definition = catalog.defaults("LARGE_TX");
    group(definition, "filter")
        .put("items", new ArrayList<>(List.of(condition("field", "FIRST_PAIR", null, null))));
    incomplete("LARGE_TX", definition, "CONDITIONS", "세는 거래에 '건당 금액' 조건이 필요합니다.");
    definition = catalog.defaults("SAME_AMOUNT");
    items(group(definition, "filter")).removeLast();
    incomplete("SAME_AMOUNT", definition, "CONDITIONS", "세는 거래에 '검사 거래와 비슷한 금액' 조건이 필요합니다.");
    definition = catalog.defaults("STRUCTURING");
    items(group(definition, "filter")).add(condition("field", "TX_USD", "LTE", 5000));
    assertThat(check("STRUCTURING", definition).canRun()).isTrue(); // 5,000 이상 5,000 이하는 남는 구간이 있다
    items(group(definition, "filter")).add(condition("field", "TX_USD", "LT", 5000));
    incomplete("STRUCTURING", definition, "CONDITIONS", "건당 금액의 하한이 상한보다 작아야 합니다.");

    definition = catalog.defaults("CYCLE");
    group(definition, "path").put("minHops", 13);
    incomplete("CYCLE", definition, "CONDITIONS", "'순환 거래 수' 값은 따라가는 최대 거래 수 이하여야 합니다.");
    group(definition, "path").put("minHops", 1);
    incomplete("CYCLE", definition, "CONDITIONS", "'순환 거래 수' 값은 2 이상이어야 합니다.");
    group(definition, "path").remove("minHops");
    incomplete("CYCLE", definition, "CONDITIONS", "'순환 거래 수' 값이 비어 있습니다.");
    definition = catalog.defaults("RANDOM");
    group(definition, "path").put("stepRatioMin", 1.25);
    incomplete("RANDOM", definition, "CONDITIONS", "금액 비의 하한이 상한보다 작아야 합니다.");
    group(definition, "path").put("stepRatioMin", 0.4);
    incomplete("RANDOM", definition, "CONDITIONS", "값은 0.5 이상 2 이하여야 합니다.");
    // CYCLE 은 순환 거래 수를 2 로 내려 왕복 송금을 잡을 수 있다.
    definition = catalog.defaults("CYCLE");
    group(definition, "path").put("minHops", 2);
    assertThat(check("CYCLE", definition).canRun()).isTrue();
  }

  @Test
  void window_and_path_length_are_capped_by_the_template() {
    var definition = catalog.defaults("FAN_IN");
    definition.put("windowMinutes", 43200);
    assertThat(check("FAN_IN", definition).canRun()).isTrue();
    assertThat(item(check("FAN_IN", definition), "COST").message())
        .isEqualTo("기간 30일 (이 템플릿의 상한 30일)");
    for (String key : List.of("SCATTER_GATHER", "CYCLE", "RANDOM")) {
      definition = catalog.defaults(key);
      definition.put("windowMinutes", 20160);
      assertThat(check(key, definition).canRun()).as(key).isTrue();
      definition.put("windowMinutes", 43200);
      incomplete(key, definition, "COST", "이 템플릿의 기간은 14일까지 고를 수 있습니다.");
    }
    definition = catalog.defaults("CYCLE");
    group(definition, "path").put("maxHops", 20);
    incomplete("CYCLE", definition, "COST", "따라가는 최대 거래 수는 12건까지입니다.");
    assertThat(item(check("CYCLE", catalog.defaults("CYCLE")), "COST").message())
        .isEqualTo("기간 7일 (이 템플릿의 상한 14일) · 거래 12건까지 따라갑니다.");
    assertThat(item(check("LARGE_TX", catalog.defaults("LARGE_TX")), "COST").message())
        .isEqualTo("기간 없이 거래 1건씩 봅니다.");
  }

  @Test
  void warnings_do_not_block() {
    var young = new RuleValidator.Facts(3, List.of("RULE-002"));
    var result = RuleValidator.check(catalog, "FAN_OUT", catalog.defaults("FAN_OUT"), young);
    assertThat(result.canRun()).isTrue();
    assertThat(result.warnings()).hasSize(2);
    assertThat(result.warnings().get(0)).contains("원장에 쌓인 기간이 3일입니다.");
    assertThat(result.warnings().get(1)).isEqualTo("운영 중인 RULE-002 와 템플릿 · 기간이 같습니다.");
    // 처음 거래하는 상대를 쓰지 않는 룰은 원장이 짧아도 경고하지 않는다.
    assertThat(
            RuleValidator.check(
                    catalog,
                    "SCATTER_GATHER",
                    catalog.defaults("SCATTER_GATHER"),
                    new RuleValidator.Facts(3, List.of()))
                .warnings())
        .isEmpty();
    result =
        RuleValidator.check(
            catalog, "FAN_OUT", catalog.defaults("FAN_OUT"), RuleValidator.Facts.NONE);
    assertThat(result.canRun()).isTrue();
    assertThat(item(result, "DATA").message()).isEqualTo("원장에 거래가 없습니다.");
    assertThat(result.warnings()).hasSize(1);
  }
}
