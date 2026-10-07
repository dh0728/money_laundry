package com.moneylaundry.api.storage;

/** Only upload objects and individual inference request directories may be cleaned. */
public final class DemoObjectKey {
  private DemoObjectKey() {}

  public static void check(String key, boolean prefix) {
    if (key == null || key.contains("..") || key.contains("\\") || key.contains(":"))
      throw new IllegalArgumentException("Invalid cleanup key");
    String expression =
        prefix
            ? "(?:requests|results)/[0-9]+/(?:BINARY|TYPE)/[0-9a-f-]{36}/"
            : "uploads/[0-9]+/[0-9]+/[^/]+";
    if (!key.matches(expression)) throw new IllegalArgumentException("Invalid cleanup key");
  }
}
