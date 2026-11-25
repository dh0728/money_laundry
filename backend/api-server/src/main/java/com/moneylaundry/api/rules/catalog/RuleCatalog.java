package com.moneylaundry.api.rules.catalog;

import com.moneylaundry.api.review.ReviewJson;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.stereotype.Component;

/**
 * 룰 템플릿 카탈로그(resources/rules/catalog.json). 템플릿마다 쓸 수 있는 항목·단위·허용 범위·기본값이 들어 있고, 검증·문장 변환·화면 드롭다운이
 * 전부 이 파일 하나를 본다. 내용의 기준 문서는 `룰-템플릿-정의.md` 다.
 */
@Component
public class RuleCatalog {
  public static final int SCHEMA = 2;
  private final Map<String, Object> root;
  private final Map<String, Map<String, Object>> templates = new LinkedHashMap<>();

  public RuleCatalog() {
    this(read());
  }

  private RuleCatalog(Map<String, Object> root) {
    this.root = root;
    for (var template : ReviewJson.rows(root.get("templates")))
      templates.put(template.get("key").toString(), template);
  }

  public static RuleCatalog of(Map<String, Object> root) {
    return new RuleCatalog(root);
  }

  private static Map<String, Object> read() {
    try (var in = RuleCatalog.class.getResourceAsStream("/rules/catalog.json")) {
      if (in == null) throw new IllegalStateException("rules/catalog.json 이 없습니다.");
      return ReviewJson.object(new String(in.readAllBytes(), StandardCharsets.UTF_8));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** GET /rule-templates 응답. */
  public Map<String, Object> view() {
    return root;
  }

  /** 템플릿. 없는 키면 null. */
  public Map<String, Object> template(String key) {
    return key == null ? null : templates.get(key);
  }

  public static boolean available(Map<String, Object> template) {
    return template != null && Boolean.TRUE.equals(template.get("available"));
  }

  public Map<String, Object> filterField(String key) {
    return entry("filterFields", key);
  }

  public Map<String, Object> metric(String key) {
    return entry("metrics", key);
  }

  public Map<String, Object> pathField(String key) {
    return entry("path", key);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> entry(String section, String key) {
    return key == null ? null : (Map<String, Object>) ReviewJson.object(root.get(section)).get(key);
  }

  @SuppressWarnings("unchecked")
  public List<Object> list(String key) {
    return (List<Object>) root.get(key);
  }

  public static List<String> strings(Object value) {
    var out = new ArrayList<String>();
    if (value instanceof List<?> list) for (Object item : list) out.add(String.valueOf(item));
    return out;
  }

  public boolean window(long minutes) {
    for (Object value : list("windows")) if (((Number) value).longValue() == minutes) return true;
    return false;
  }

  public int limit(String key) {
    return ((Number) ReviewJson.object(root.get("limits")).get(key)).intValue();
  }

  /** THEN 선택지. 없는 키면 null. */
  public Map<String, Object> then(String key) {
    for (var option : ReviewJson.rows(root.get("then")))
      if (option.get("key").equals(key)) return option;
    return null;
  }

  public String directionLabel(Object key) {
    for (var option : ReviewJson.rows(root.get("directions")))
      if (option.get("key").equals(key)) return option.get("label").toString();
    return null;
  }

  /**
   * 대상 계좌가 거래의 어느 쪽인가. 방향을 고르는 템플릿은 정의의 direction(OUT = 보낸 쪽, IN = 받은 쪽)을 따르고, 그 밖에는 템플릿에 적힌 값을 쓴다.
   * 항목 문구("수취 계좌 수" / "송금 계좌 수")가 이 값으로 갈린다.
   */
  public static String side(Map<String, Object> template, Object direction) {
    if (Boolean.TRUE.equals(template.get("directionSelectable")))
      return "IN".equals(direction) ? "TO" : "FROM";
    return template.get("side") == null ? "FROM" : template.get("side").toString();
  }

  /** label·short 가 문자열이면 그대로, {FROM, TO} 나 {CYCLE, RANDOM} 처럼 갈리면 key 에 맞는 것. */
  public static String text(Object value, String key) {
    if (value instanceof Map<?, ?> map) {
      Object found = map.get(key);
      return found == null ? map.values().iterator().next().toString() : found.toString();
    }
    return value == null ? "" : value.toString();
  }

  /** 템플릿을 처음 골랐을 때의 정의(schema, template + defaults). 호출마다 새 사본을 준다. */
  public Map<String, Object> defaults(String key) {
    var template = template(key);
    if (!available(template)) return null;
    var definition = new LinkedHashMap<String, Object>();
    definition.put("schema", SCHEMA);
    definition.put("template", key);
    definition.putAll(ReviewJson.object(ReviewJson.encode(template.get("defaults"))));
    return definition;
  }
}
