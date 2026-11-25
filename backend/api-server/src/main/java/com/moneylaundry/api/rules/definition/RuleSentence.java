package com.moneylaundry.api.rules.definition;

import com.moneylaundry.api.rules.catalog.RuleCatalog;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.*;

/**
 * 룰 정의를 사람이 읽는 글로 바꾼다. 문장은 룰 만들기 화면의 "이렇게 읽힙니다", 한 줄 요약은 룰 목록의 조건 칸에 쓴다. 형식 검증을 통과한 정의(canonical)를
 * 받는다. 값이 빈 조건은 "?" 로 적는다.
 */
public final class RuleSentence {
  private RuleSentence() {}

  private static final Map<String, String> CMP =
      Map.of("GTE", "이상", "GT", "초과", "LTE", "이하", "LT", "미만", "EQ", "");
  private static final Map<String, String> THEN =
      Map.of("ATTACH_EVIDENCE", "Alert에 근거로 표시합니다", "CREATE_ALERT", "Alert를 생성합니다");

  /** "처음 거래하는 상대이고 건당 금액이 1,000 USD 이상인 거래만 세어, 한 송금 계좌에서 7일 안에 … 이면 Alert에 근거로 표시합니다." */
  public static String sentence(RuleCatalog catalog, Map<String, Object> definition) {
    var template = catalog.template(String.valueOf(definition.get("template")));
    if (template == null) return "";
    String key = template.get("key").toString();
    String side = RuleCatalog.side(template, definition.get("direction"));
    String direction = catalog.directionLabel(definition.get("direction"));
    String filter = filterText(catalog, definition.get("filter"), false);
    String then = THEN.getOrDefault(String.valueOf(definition.get("then")), "?");
    if ("TX".equals(template.get("subject")))
      return (filter.isEmpty() ? "거래가" : filter + "인 거래가") + " 들어오면 " + then + ".";
    String counted =
        filter.isEmpty()
            ? (direction == null ? "모든 거래를 세어, " : direction + "을 모두 세어, ")
            : (direction == null ? "" : direction + " 가운데 ") + filter + "인 거래만 세어, ";
    String window = window(definition.get("windowMinutes")) + " 안에 ";
    if ("PATH".equals(template.get("evaluator"))) {
      var path = object(definition.get("path"));
      String chain =
          "금액 비 "
              + number(path.get("stepRatioMin"))
              + " ~ "
              + number(path.get("stepRatioMax"))
              + "로 이어진 거래";
      String hops =
          number(path.get("minHops")) + "건 이상(" + number(path.get("maxHops")) + "건까지 따라감)";
      return counted
          + window
          + chain
          + ("CYCLE".equals(key) ? " " + hops + "이 출발 계좌로 돌아오면 " : "가 " + hops + "이면 ")
          + then
          + ".";
    }
    String where = whereText(catalog, definition.get("where"), side, false, false);
    return counted
        + "한 "
        + template.get("subjectLabel")
        + "에서 "
        + window
        + (where.isEmpty() ? "(적중 조건 없음)" : where)
        + "이면 "
        + then
        + ".";
  }

  /** "첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일" */
  public static String summary(RuleCatalog catalog, Map<String, Object> definition) {
    var template = catalog.template(String.valueOf(definition.get("template")));
    if (template == null) return "";
    String side = RuleCatalog.side(template, definition.get("direction"));
    var parts = new ArrayList<String>();
    String direction = catalog.directionLabel(definition.get("direction"));
    if (direction != null) parts.add(direction);
    for (Object item : RuleDefinition.items(definition.get("filter")))
      parts.add(
          RuleDefinition.group(item)
              ? filterText(catalog, item, true)
              : filterCondition(catalog, object(item), true));
    if ("PATH".equals(template.get("evaluator"))) {
      var path = object(definition.get("path"));
      parts.add(
          RuleCatalog.text(
                      catalog.pathField("minHops").get("label"), template.get("key").toString())
                  .replace(" 수", "")
              + " "
              + number(path.get("minHops"))
              + "건 이상");
      parts.add(
          "금액 비 " + number(path.get("stepRatioMin")) + " ~ " + number(path.get("stepRatioMax")));
    }
    var where = object(definition.get("where"));
    if ("ANY".equals(where.get("op"))) {
      String any = whereText(catalog, where, side, true, false);
      if (!any.isEmpty()) parts.add(any);
    } else
      for (Object item : RuleDefinition.items(where))
        parts.add(
            RuleDefinition.group(item)
                ? whereText(catalog, item, side, true, true)
                : whereCondition(catalog, object(item), side, true));
    if (definition.get("windowMinutes") != null) parts.add(window(definition.get("windowMinutes")));
    parts.removeIf(String::isEmpty);
    return String.join(" · ", parts);
  }

  // ---- 세는 거래 ----

  private static String filterText(RuleCatalog catalog, Object group, boolean brief) {
    var texts = new ArrayList<String>();
    for (Object item : RuleDefinition.items(group)) {
      String text =
          RuleDefinition.group(item)
              ? filterText(catalog, item, brief)
              : filterCondition(catalog, object(item), brief);
      if (text.isEmpty()) continue;
      texts.add(RuleDefinition.group(item) && !brief ? "(" + text + ")" : text);
    }
    boolean any = "ANY".equals(object(group).get("op"));
    return String.join(any ? " 또는 " : brief ? " · " : "이고 ", texts);
  }

  private static String filterCondition(
      RuleCatalog catalog, Map<String, Object> condition, boolean brief) {
    var spec = catalog.filterField(String.valueOf(condition.get("field")));
    if (spec == null) return "";
    String name = spec.get(brief ? "short" : "label").toString();
    if ("flag".equals(spec.get("kind"))) return name;
    String value = amount(condition.get("value"), spec.get("unit"));
    if ("WITHIN".equals(condition.get("cmp")))
      return brief ? name + " ±" + value : "금액이 검사 거래 금액의 ±" + value + " 안";
    return (brief ? name + " " : name + josa(name, "이", "가") + " ")
        + value
        + compare(condition.get("cmp"));
  }

  // ---- 적중 조건 ----

  private static String whereText(
      RuleCatalog catalog, Object group, String side, boolean brief, boolean nested) {
    var texts = new ArrayList<String>();
    for (Object item : RuleDefinition.items(group)) {
      String text =
          RuleDefinition.group(item)
              ? whereText(catalog, item, side, brief, true)
              : whereCondition(catalog, object(item), side, brief);
      if (!text.isEmpty()) texts.add(text);
    }
    boolean any = "ANY".equals(object(group).get("op"));
    String joined = String.join(brief ? (any ? " 또는 " : " · ") : any ? "이거나 " : "이고 ", texts);
    return nested && texts.size() > 1 ? "(" + joined + ")" : joined;
  }

  private static String whereCondition(
      RuleCatalog catalog, Map<String, Object> condition, String side, boolean brief) {
    var spec = catalog.metric(String.valueOf(condition.get("metric")));
    if (spec == null) return "";
    if ("flag".equals(spec.get("kind")))
      return RuleCatalog.text(spec.get(brief ? "short" : "phrase"), side);
    String name = RuleCatalog.text(spec.get(brief ? "short" : "label"), side);
    return (brief ? name + " " : name + josa(name, "이", "가") + " ")
        + amount(condition.get("value"), spec.get("unit"))
        + compare(condition.get("cmp"));
  }

  // ---- 낱말 ----

  private static String compare(Object cmp) {
    String word = CMP.getOrDefault(String.valueOf(cmp), "");
    return word.isEmpty() ? "" : " " + word;
  }

  /** "1,000 USD", "6개", "80%". 값이 없으면 "?". */
  private static String amount(Object value, Object unit) {
    String text = number(value);
    if (unit == null) return text;
    return "USD".equals(unit) ? text + " USD" : text + unit;
  }

  /** 천 단위 쉼표, 소수는 필요한 자리까지. 숫자가 아니면 "?". */
  public static String number(Object value) {
    Number number = RuleDefinition.number(value);
    if (number == null) return "?";
    if (number instanceof Long) return String.format(Locale.ROOT, "%,d", number.longValue());
    return new DecimalFormat("#,##0.########", DecimalFormatSymbols.getInstance(Locale.ROOT))
        .format(number.doubleValue());
  }

  /** 분을 "1시간", "24시간", "3일" 처럼 읽는다. 하루보다 길고 일로 떨어지면 일, 시간으로 떨어지면 시간. */
  public static String window(Object minutes) {
    Number number = RuleDefinition.number(minutes);
    if (!(number instanceof Long)) return "?";
    long value = number.longValue();
    if (value > 1440 && value % 1440 == 0) return value / 1440 + "일";
    if (value % 60 == 0) return value / 60 + "시간";
    return value + "분";
  }

  /** 받침이 있으면 withFinal, 없으면 withoutFinal. 마지막 한글 글자로 정한다("계좌(돈이 돌아온 계좌)" → 좌). */
  public static String josa(String word, String withFinal, String withoutFinal) {
    for (int i = word.length() - 1; i >= 0; i--) {
      char letter = word.charAt(i);
      if (letter >= 0xAC00 && letter <= 0xD7A3)
        return (letter - 0xAC00) % 28 == 0 ? withoutFinal : withFinal;
    }
    return withoutFinal;
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> object(Object value) {
    return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
  }
}
