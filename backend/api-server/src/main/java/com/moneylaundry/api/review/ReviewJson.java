package com.moneylaundry.api.review;

import java.util.*;
import tools.jackson.databind.ObjectMapper;

final class ReviewJson {
  private ReviewJson() {}

  static final ObjectMapper JSON = new ObjectMapper();

  @SuppressWarnings("unchecked")
  static Map<String, Object> object(Object value) {
    return value instanceof Map
        ? (Map<String, Object>) value
        : JSON.readValue(value.toString(), Map.class);
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> rows(Object value) {
    return value == null
        ? new ArrayList<>()
        : value instanceof List
            ? (List<Map<String, Object>>) value
            : JSON.readValue(value.toString(), List.class);
  }

  static long number(Object value) {
    return ((Number) value).longValue();
  }

  static String encode(Object value) {
    return JSON.writeValueAsString(value);
  }

  static List<Map<String, Object>> copy(List<Map<String, Object>> value) {
    return rows(encode(value));
  }
}
