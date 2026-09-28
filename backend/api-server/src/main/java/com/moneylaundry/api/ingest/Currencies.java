package com.moneylaundry.api.ingest;

import java.util.Map;
import java.util.Optional;

/** IBM AMLworld 통화명 15종 → ISO 4217 코드(API.md §1.4 고정 매핑표). 표에 없는 값은 행 검증 오류. */
public final class Currencies {

  private static final Map<String, String> ISO =
      Map.ofEntries(
          Map.entry("Australian Dollar", "AUD"),
          Map.entry("Bitcoin", "BTC"),
          Map.entry("Brazil Real", "BRL"),
          Map.entry("Canadian Dollar", "CAD"),
          Map.entry("Euro", "EUR"),
          Map.entry("Mexican Peso", "MXN"),
          Map.entry("Ruble", "RUB"),
          Map.entry("Rupee", "INR"),
          Map.entry("Saudi Riyal", "SAR"),
          Map.entry("Shekel", "ILS"),
          Map.entry("Swiss Franc", "CHF"),
          Map.entry("UK Pound", "GBP"),
          Map.entry("US Dollar", "USD"),
          Map.entry("Yen", "JPY"),
          Map.entry("Yuan", "CNY"));

  private Currencies() {}

  public static Optional<String> toIso(String name) {
    return Optional.ofNullable(ISO.get(name.trim()));
  }
}
