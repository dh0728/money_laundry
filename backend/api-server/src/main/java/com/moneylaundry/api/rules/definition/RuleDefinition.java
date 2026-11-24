package com.moneylaundry.api.rules.definition;

import com.moneylaundry.api.review.ReviewJson;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

/**
 * 룰 정의 JSON(rules.rule_versions.definition)의 모양을 한 가지로 맞춘다. 같은 조건이면 항상 같은 문자열이 되어야
 * 지문(definition_digest)으로 "이 백테스트가 지금 조건으로 돌린 것인가"를 확인할 수 있다.
 *
 * <pre>
 * { schema, template, direction?, windowMinutes?, filter, path?, where, then }
 *   filter : { op: ALL, items: [ {field, cmp?, value?} | { op: ANY, items: [ {field, cmp?, value?} ] } ] }
 *   where  : { op: ALL|ANY, items: [ {metric, cmp?, value?} | { op, items: [ {metric, cmp?, value?} ] } ] }
 *   path   : { minHops, maxHops, stepRatioMin, stepRatioMax }
 * </pre>
 */
public final class RuleDefinition {
  private RuleDefinition() {}

  /** 정의 맨 위에 올 수 있는 키. 이 순서로 저장한다. */
  public static final List<String> KEYS =
      List.of(
          "schema", "template", "direction", "windowMinutes", "filter", "path", "where", "then");

  private static final List<String> ORDER =
      List.of(
          "schema",
          "template",
          "direction",
          "windowMinutes",
          "filter",
          "path",
          "where",
          "then",
          "op",
          "field",
          "metric",
          "cmp",
          "value",
          "items",
          "minHops",
          "maxHops",
          "stepRatioMin",
          "stepRatioMax");

  /** 키 순서를 고정하고, 값이 null 인 키를 빼고, 숫자를 정수는 Long · 소수는 Double 로 맞춘 사본. */
  public static Map<String, Object> canonical(Object definition) {
    return map(ReviewJson.object(definition));
  }

  private static Map<String, Object> map(Map<?, ?> source) {
    var keys = new ArrayList<String>();
    for (Object key : source.keySet()) keys.add(String.valueOf(key));
    keys.sort(
        Comparator.comparingInt((String key) -> ORDER.contains(key) ? ORDER.indexOf(key) : 999)
            .thenComparing(Comparator.naturalOrder()));
    var out = new LinkedHashMap<String, Object>();
    for (String key : keys) {
      Object value = value(source.get(key));
      if (value != null) out.put(key, value);
    }
    return out;
  }

  private static Object value(Object value) {
    if (value instanceof Map<?, ?> map) return map(map);
    if (value instanceof List<?> list) {
      var out = new ArrayList<Object>();
      for (Object item : list) out.add(value(item));
      return out;
    }
    if (value instanceof Number) {
      Number number = number(value);
      return number == null ? value.toString() : number;
    }
    return value;
  }

  /** 숫자면 정수는 Long, 소수는 Double. 숫자가 아니거나 NaN · 무한대면 null. */
  public static Number number(Object value) {
    if (!(value instanceof Number raw)) return null;
    BigDecimal decimal;
    try {
      decimal = new BigDecimal(raw.toString());
    } catch (NumberFormatException e) {
      return null;
    }
    if (decimal.stripTrailingZeros().scale() <= 0) {
      try {
        return decimal.longValueExact();
      } catch (ArithmeticException e) {
        return decimal.doubleValue();
      }
    }
    return decimal.doubleValue();
  }

  /** canonical 로 맞춘 정의의 SHA-256(16진수 64자). */
  public static String digest(Map<String, Object> canonical) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(ReviewJson.encode(canonical).getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  @SuppressWarnings("unchecked")
  public static List<Object> items(Object group) {
    return group instanceof Map<?, ?> map && map.get("items") instanceof List<?> list
        ? (List<Object>) list
        : List.of();
  }

  /** 그룹({op, items})인가. 조건은 field 나 metric 을 가진다. */
  public static boolean group(Object item) {
    return item instanceof Map<?, ?> map && map.containsKey("op");
  }
}
