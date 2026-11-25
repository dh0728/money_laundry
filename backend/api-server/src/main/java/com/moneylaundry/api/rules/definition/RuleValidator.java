package com.moneylaundry.api.rules.definition;

import com.moneylaundry.api.rules.catalog.RuleCatalog;
import java.util.*;

/**
 * 저장 전 검증(검토 체크리스트). 항목은 넷이다.
 *
 * <ul>
 *   <li>형식(FORMAT): 템플릿이 쓸 수 있는 것인가, 항목·비교·기간이 허용 목록에 있나, 세는 거래와 적중 조건의 구조가 맞나. <b>이것만 통과하면 초안으로
 *       저장할 수 있다.</b>
 *   <li>조건(CONDITIONS): 값이 다 채워졌나, 범위 안인가, 꼭 있어야 하는 조건이 있나.
 *   <li>데이터(DATA): 조건이 쓰는 값이 원장에 있나.
 *   <li>실행 비용(COST): 기간이 템플릿 상한 이하인가, 경로형은 따라가는 거래 수가 상한 이하인가.
 * </ul>
 *
 * 넷을 모두 통과해야 백테스트·시험 운영·승인 요청을 할 수 있다. 경고는 막지 않는다.
 */
public final class RuleValidator {
  private RuleValidator() {}

  public record Item(String key, String label, boolean ok, String message, List<String> errors) {}

  /**
   * 검증에 쓰는 DB 사실. ledgerDays = 원장에 쌓인 거래의 날짜 수(첫 거래일부터 마지막 거래일까지, 거래가 없으면 null). overlapping = 템플릿과
   * 기간이 같은 운영 중 룰의 코드.
   */
  public record Facts(Integer ledgerDays, List<String> overlapping) {
    public static final Facts NONE = new Facts(null, List.of());
  }

  /** definition 은 형식을 통과했을 때의 canonical 정의이고, 통과하지 못하면 null 이다. */
  public record Result(
      List<Item> items,
      List<String> warnings,
      Map<String, Object> definition,
      boolean canSave,
      boolean canRun) {}

  /** "처음 거래하는 상대"가 듣기 시작하는 원장 길이(일). 이보다 짧으면 정상 거래도 첫 거래로 보인다. */
  public static final int FIRST_PAIR_MIN_DAYS = 5;

  private static final String BLOCKED = "형식을 먼저 맞춰야 확인할 수 있습니다.";

  public static Result check(RuleCatalog catalog, String templateKey, Object raw, Facts facts) {
    var check = new Check(catalog);
    var template = catalog.template(templateKey);
    if (!RuleCatalog.available(template)) check.format.add("쓸 수 없는 템플릿입니다.");
    if (!(raw instanceof Map<?, ?>)) check.format.add("룰 정의가 없습니다.");
    Map<String, Object> definition = null;
    if (check.format.isEmpty()) {
      definition = RuleDefinition.canonical(raw);
      check.definition(template, templateKey, definition);
    }
    boolean formatted = check.format.isEmpty();
    var items = new ArrayList<Item>();
    items.add(item("FORMAT", "형식", check.format, "템플릿 · 항목 · 구조가 맞습니다."));
    var warnings = new ArrayList<String>();
    if (!formatted) {
      for (String[] other :
          new String[][] {{"CONDITIONS", "조건"}, {"DATA", "데이터"}, {"COST", "실행 비용"}})
        items.add(new Item(other[0], other[1], false, BLOCKED, List.of()));
      return new Result(items, warnings, null, false, false);
    }
    items.add(item("CONDITIONS", "조건", check.conditions, "값이 모두 채워졌고 범위 안입니다."));
    items.add(new Item("DATA", "데이터", true, data(check, facts, warnings), List.of()));
    items.add(item("COST", "실행 비용", check.cost, String.join(" · ", check.costNotes)));
    for (String code : facts.overlapping()) warnings.add("운영 중인 " + code + " 와 템플릿 · 기간이 같습니다.");
    return new Result(
        items, warnings, definition, true, check.conditions.isEmpty() && check.cost.isEmpty());
  }

  private static Item item(String key, String label, List<String> errors, String passed) {
    return new Item(
        key, label, errors.isEmpty(), errors.isEmpty() ? passed : errors.getFirst(), errors);
  }

  private static String data(Check check, Facts facts, List<String> warnings) {
    if (facts.ledgerDays() == null) {
      warnings.add("원장에 거래가 없습니다. 거래가 들어온 뒤에 돌려 볼 수 있습니다.");
      return "원장에 거래가 없습니다.";
    }
    if (check.firstPair && facts.ledgerDays() < FIRST_PAIR_MIN_DAYS)
      warnings.add(
          "원장에 쌓인 기간이 "
              + facts.ledgerDays()
              + "일입니다. '처음 거래하는 상대'는 "
              + FIRST_PAIR_MIN_DAYS
              + "일 이상 쌓인 뒤에야 가르는 힘이 생깁니다.");
    return "원장 " + facts.ledgerDays() + "일치로 계산할 수 있습니다.";
  }

  private static final class Check {
    final RuleCatalog catalog;
    final List<String> format = new ArrayList<>();
    final List<String> conditions = new ArrayList<>();
    final List<String> cost = new ArrayList<>();
    final List<String> costNotes = new ArrayList<>();
    boolean firstPair;
    String side = "FROM";

    Check(RuleCatalog catalog) {
      this.catalog = catalog;
    }

    void definition(Map<String, Object> template, String templateKey, Map<String, Object> d) {
      for (String key : d.keySet())
        if (!RuleDefinition.KEYS.contains(key)) format.add("알 수 없는 항목입니다: " + key);
      if (!Long.valueOf(RuleCatalog.SCHEMA).equals(RuleDefinition.number(d.get("schema"))))
        format.add("정의 형식 버전(schema)은 " + RuleCatalog.SCHEMA + " 여야 합니다.");
      if (!templateKey.equals(d.get("template"))) format.add("정의의 템플릿이 룰의 템플릿과 다릅니다.");

      Object direction = d.get("direction");
      if (Boolean.TRUE.equals(template.get("directionSelectable"))) {
        if (catalog.directionLabel(direction) == null) format.add("방향(입금 · 출금)을 골라야 합니다.");
      } else if (direction != null) format.add("이 템플릿은 방향을 고르지 않습니다.");
      side = RuleCatalog.side(template, direction);

      window(template, d.get("windowMinutes"));
      filter(template, d.get("filter"));
      path(template, templateKey, d.get("path"));
      where(template, d.get("where"));
      then(template, d.get("then"));
    }

    // ---- 기간 ----

    void window(Map<String, Object> template, Object value) {
      if (!Boolean.TRUE.equals(template.get("windowRequired"))) {
        if (value != null) format.add("이 템플릿은 기간을 쓰지 않습니다.");
        costNotes.add("기간 없이 거래 1건씩 봅니다.");
        return;
      }
      Number minutes = RuleDefinition.number(value);
      if (!(minutes instanceof Long) || !catalog.window(minutes.longValue())) {
        format.add("기간을 목록에서 골라야 합니다.");
        return;
      }
      long max = ((Number) template.get("maxWindowMinutes")).longValue();
      if (minutes.longValue() > max)
        cost.add("이 템플릿의 기간은 " + RuleSentence.window(max) + "까지 고를 수 있습니다.");
      costNotes.add(
          "기간 " + RuleSentence.window(minutes) + " (이 템플릿의 상한 " + RuleSentence.window(max) + ")");
    }

    // ---- 세는 거래 ----

    void filter(Map<String, Object> template, Object value) {
      if (!shaped(value) || !"ALL".equals(((Map<?, ?>) value).get("op"))) {
        format.add("세는 거래(filter)는 ALL 그룹 하나여야 합니다.");
        return;
      }
      var allowed = RuleCatalog.strings(template.get("filterFields"));
      var seen = new HashSet<String>();
      var top = new ArrayList<Map<String, Object>>();
      int count = 0;
      int groups = 0;
      for (Object item : RuleDefinition.items(value)) {
        if (RuleDefinition.group(item)) {
          groups++;
          if (!shaped(item) || !"ANY".equals(((Map<?, ?>) item).get("op"))) {
            format.add("세는 거래 안의 그룹은 ANY 그룹이어야 합니다.");
            continue;
          }
          var inner = RuleDefinition.items(item);
          if (inner.isEmpty()) conditions.add("세는 거래의 ANY 그룹이 비어 있습니다.");
          for (Object condition : inner) {
            count++;
            if (RuleDefinition.group(condition) || !(condition instanceof Map<?, ?>))
              format.add("세는 거래의 ANY 그룹 안에는 조건만 둘 수 있습니다.");
            else filterCondition(allowed, object(condition), true, seen);
          }
        } else if (item instanceof Map<?, ?>) {
          count++;
          if (filterCondition(allowed, object(item), false, seen)) top.add(object(item));
        } else format.add("세는 거래의 조건 모양이 잘못됐습니다.");
      }
      if (groups > 1) format.add("세는 거래에는 ANY 그룹을 하나만 둘 수 있습니다.");
      int limit = catalog.limit("filterConditions");
      if (count > limit) format.add("세는 거래의 조건은 " + limit + "개까지 둘 수 있습니다.");
      for (String required : RuleCatalog.strings(template.get("requiredFilterFields")))
        if (top.stream().noneMatch(condition -> required.equals(condition.get("field"))))
          conditions.add("세는 거래에 '" + catalog.filterField(required).get("label") + "' 조건이 필요합니다.");
      band(top);
    }

    /** 조건 하나를 확인한다. 쓸 수 있는 항목이면 true. */
    boolean filterCondition(
        List<String> allowed, Map<String, Object> condition, boolean inAny, Set<String> seen) {
      String field = String.valueOf(condition.get("field"));
      var spec = allowed.contains(field) ? catalog.filterField(field) : null;
      if (spec == null) {
        format.add("이 템플릿의 세는 거래에 쓸 수 없는 항목입니다: " + field);
        return false;
      }
      String label = quoted(spec.get("label"));
      unknownKeys(condition, Set.of("field", "cmp", "value"), label);
      if (inAny && Boolean.FALSE.equals(spec.get("anyGroup")))
        format.add(label + " 조건은 ANY 그룹 안에 둘 수 없습니다.");
      if ("FIRST_PAIR".equals(field)) firstPair = true;
      var comparators = RuleCatalog.strings(spec.get("comparators"));
      boolean once = "flag".equals(spec.get("kind")) || comparators.size() == 1;
      if (once && !seen.add(field)) conditions.add(label + " 조건이 두 번 들어 있습니다.");
      if ("flag".equals(spec.get("kind"))) {
        if (condition.containsKey("cmp") || condition.containsKey("value"))
          format.add(label + " 조건은 비교와 값을 갖지 않습니다.");
      } else {
        if (!comparators.contains(String.valueOf(condition.get("cmp"))))
          format.add(label + " 조건의 비교가 허용 목록에 없습니다.");
        value(label, spec, condition.get("value"));
      }
      return true;
    }

    /** 맨 위 ALL 에 건 건당 금액의 하한과 상한이 겹치는 구간을 남기는지 본다. */
    void band(List<Map<String, Object>> top) {
      Double low = null;
      Double high = null;
      boolean lowOpen = false;
      boolean highOpen = false;
      for (var condition : top) {
        Number value = RuleDefinition.number(condition.get("value"));
        if (!"TX_USD".equals(condition.get("field")) || value == null) continue;
        double amount = value.doubleValue();
        String cmp = String.valueOf(condition.get("cmp"));
        if (cmp.equals("GTE") || cmp.equals("GT")) {
          if (low == null || amount > low || (amount == low && cmp.equals("GT"))) {
            low = amount;
            lowOpen = cmp.equals("GT");
          }
        } else if (cmp.equals("LTE") || cmp.equals("LT")) {
          if (high == null || amount < high || (amount == high && cmp.equals("LT"))) {
            high = amount;
            highOpen = cmp.equals("LT");
          }
        }
      }
      if (low != null
          && high != null
          && (low > high || (low.equals(high) && (lowOpen || highOpen))))
        conditions.add("건당 금액의 하한이 상한보다 작아야 합니다.");
    }

    // ---- 경로 값 ----

    void path(Map<String, Object> template, String templateKey, Object value) {
      if (!"PATH".equals(template.get("evaluator"))) {
        if (value != null) format.add("이 템플릿은 경로 값(path)을 쓰지 않습니다.");
        return;
      }
      if (!(value instanceof Map<?, ?>)) {
        format.add("경로 값(path)이 없습니다.");
        return;
      }
      var path = object(value);
      unknownKeys(path, Set.of("minHops", "maxHops", "stepRatioMin", "stepRatioMax"), "경로 값");
      if (!path.containsKey("stepRatioMin") || !path.containsKey("stepRatioMax"))
        format.add("이어지는 두 거래의 금액 비 범위를 채워야 합니다.");
      Number ratioMin = pathValue(templateKey, path, "stepRatioMin");
      Number ratioMax = pathValue(templateKey, path, "stepRatioMax");
      if (ratioMin != null && ratioMax != null && ratioMin.doubleValue() >= ratioMax.doubleValue())
        conditions.add("금액 비의 하한이 상한보다 작아야 합니다.");
      Number minHops = pathValue(templateKey, path, "minHops");
      Number maxHops = pathValue(templateKey, path, "maxHops");
      long cap = ((Number) catalog.pathField("maxHops").get("max")).longValue();
      if (maxHops instanceof Long && maxHops.longValue() > cap)
        cost.add("따라가는 최대 거래 수는 " + cap + "건까지입니다.");
      if (minHops instanceof Long && maxHops instanceof Long) {
        if (minHops.longValue() > maxHops.longValue())
          conditions.add(
              quoted(RuleCatalog.text(catalog.pathField("minHops").get("label"), templateKey))
                  + " 값은 따라가는 최대 거래 수 이하여야 합니다.");
        costNotes.add("거래 " + maxHops + "건까지 따라갑니다.");
      }
    }

    /** 경로 값 하나. 상한을 넘는 maxHops 는 실행 비용에서 따로 본다. */
    Number pathValue(String templateKey, Map<String, Object> path, String key) {
      var spec = new LinkedHashMap<>(catalog.pathField(key));
      if (key.equals("maxHops")) spec.remove("max");
      return value(quoted(RuleCatalog.text(spec.get("label"), templateKey)), spec, path.get(key));
    }

    // ---- 적중 조건 ----

    void where(Map<String, Object> template, Object value) {
      if (!shaped(value) || !operator(value)) {
        format.add("적중 조건(where)은 ALL 또는 ANY 그룹이어야 합니다.");
        return;
      }
      var allowed = RuleCatalog.strings(template.get("metrics"));
      int count = 0;
      for (Object item : RuleDefinition.items(value)) {
        if (RuleDefinition.group(item)) {
          if (!shaped(item) || !operator(item)) {
            format.add("적중 조건 안의 그룹은 ALL 또는 ANY 그룹이어야 합니다.");
            continue;
          }
          var inner = RuleDefinition.items(item);
          if (inner.isEmpty()) conditions.add("적중 조건에 빈 그룹이 있습니다.");
          for (Object condition : inner) {
            count++;
            if (RuleDefinition.group(condition))
              format.add("적중 조건의 그룹은 " + catalog.limit("whereDepth") + "단계까지 둘 수 있습니다.");
            else if (condition instanceof Map<?, ?>) whereCondition(allowed, object(condition));
            else format.add("적중 조건의 모양이 잘못됐습니다.");
          }
        } else if (item instanceof Map<?, ?>) {
          count++;
          whereCondition(allowed, object(item));
        } else format.add("적중 조건의 모양이 잘못됐습니다.");
      }
      int limit = catalog.limit("whereConditions");
      if (count > limit) format.add("적중 조건은 " + limit + "개까지 둘 수 있습니다.");
      if (count < ((Number) template.get("whereMin")).intValue())
        conditions.add("적중 조건이 1개 이상 필요합니다.");
    }

    void whereCondition(List<String> allowed, Map<String, Object> condition) {
      String metric = String.valueOf(condition.get("metric"));
      var spec = allowed.contains(metric) ? catalog.metric(metric) : null;
      if (spec == null) {
        format.add(
            allowed.isEmpty() ? "이 템플릿은 적중 조건을 두지 않습니다." : "이 템플릿의 적중 조건에 쓸 수 없는 항목입니다: " + metric);
        return;
      }
      String label = quoted(RuleCatalog.text(spec.get("label"), side));
      unknownKeys(condition, Set.of("metric", "cmp", "value"), label);
      if ("flag".equals(spec.get("kind"))) {
        if (condition.containsKey("cmp") || condition.containsKey("value"))
          format.add(label + " 조건은 비교와 값을 갖지 않습니다.");
        return;
      }
      if (!RuleCatalog.strings(catalog.list("comparators"))
          .contains(String.valueOf(condition.get("cmp"))))
        format.add(label + " 조건의 비교가 허용 목록에 없습니다.");
      value(label, spec, condition.get("value"));
    }

    // ---- THEN ----

    void then(Map<String, Object> template, Object value) {
      var option = value instanceof String key ? catalog.then(key) : null;
      if (option == null) format.add("THEN 을 골라야 합니다.");
      else if (!Boolean.TRUE.equals(option.get("enabled")))
        format.add(quoted(option.get("label")) + " 은 아직 고를 수 없습니다.");
      else if ("CREATE_ALERT".equals(value)
          && !Boolean.TRUE.equals(object(template.get("alert")).get("allowed")))
        format.add("이 템플릿은 Alert 생성을 고를 수 없습니다.");
    }

    // ---- 공통 ----

    /** 숫자 값 하나. 비어 있으면 조건, 숫자가 아니면 형식, 정수가 아니거나 범위 밖이면 조건에 적는다. 쓸 수 있는 숫자면 돌려준다. */
    Number value(String label, Map<String, Object> spec, Object value) {
      if (value == null) {
        conditions.add(label + " 값이 비어 있습니다.");
        return null;
      }
      Number number = RuleDefinition.number(value);
      if (number == null) {
        format.add(label + " 값이 숫자가 아닙니다.");
        return null;
      }
      if ("int".equals(spec.get("type")) && !(number instanceof Long)) {
        conditions.add(label + " 값은 정수여야 합니다.");
        return null;
      }
      Number min = RuleDefinition.number(spec.get("min"));
      Number max = RuleDefinition.number(spec.get("max"));
      if ((min != null && number.doubleValue() < min.doubleValue())
          || (max != null && number.doubleValue() > max.doubleValue())) {
        conditions.add(
            label
                + " 값은 "
                + (min == null ? "" : RuleSentence.number(min) + " 이상")
                + (min != null && max != null ? " " : "")
                + (max == null ? "이어야 합니다." : RuleSentence.number(max) + " 이하여야 합니다."));
        return null;
      }
      return number;
    }

    void unknownKeys(Map<String, Object> map, Set<String> known, String label) {
      for (String key : map.keySet())
        if (!known.contains(key)) format.add(label + " 에 알 수 없는 항목이 있습니다: " + key);
    }

    /** {op, items} 두 키만 가진 그룹인가. */
    static boolean shaped(Object value) {
      return value instanceof Map<?, ?> map
          && map.size() == 2
          && map.get("op") instanceof String
          && map.get("items") instanceof List<?>;
    }

    static boolean operator(Object group) {
      Object op = ((Map<?, ?>) group).get("op");
      return "ALL".equals(op) || "ANY".equals(op);
    }

    static String quoted(Object label) {
      return "'" + label + "'";
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> object(Object value) {
      return value instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }
  }
}
