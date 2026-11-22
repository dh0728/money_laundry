package com.moneylaundry.api.review;

import java.util.*;
import tools.jackson.databind.ObjectMapper;

/** 조사(review)와 Alert 공개(analysis.publish) 공용 JSON 변환 도우미(JSONB 값을 Map/List로). */
public final class ReviewJson {
  private ReviewJson() {}

  public static final ObjectMapper JSON = new ObjectMapper();

  @SuppressWarnings("unchecked")
  public static Map<String, Object> object(Object value) {
    return value instanceof Map
        ? (Map<String, Object>) value
        : JSON.readValue(value.toString(), Map.class);
  }

  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> rows(Object value) {
    return value == null
        ? new ArrayList<>()
        : value instanceof List
            ? (List<Map<String, Object>>) value
            : JSON.readValue(value.toString(), List.class);
  }

  public static long number(Object value) {
    return ((Number) value).longValue();
  }

  public static String encode(Object value) {
    return JSON.writeValueAsString(value);
  }

  public static List<Map<String, Object>> copy(List<Map<String, Object>> value) {
    return rows(encode(value));
  }
}
