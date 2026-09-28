package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;

import java.math.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class MoneyMetricsTests {
  final Instant start = Instant.parse("2023-09-01T00:00:00Z");

  MoneyMetrics.Transfer t(long id, int minute, String from, String to, int amount) {
    return new MoneyMetrics.Transfer(
        id,
        start.plusSeconds(minute * 60L),
        from,
        to,
        BigDecimal.valueOf(amount),
        "USD",
        BigDecimal.valueOf(amount),
        "USD");
  }

  Map<String, Object> calc(List<MoneyMetrics.Transfer> items, Set<String> s, int end, int delay) {
    return MoneyMetrics.calculate(
        items, s, start, start.plusSeconds(end * 60L), Duration.ofMinutes(delay));
  }

  @Test
  void external_internal_duplicate_and_positive_net_concentration() {
    var a = t(1, 0, "outside", "A", 100);
    var b = t(2, 10, "A", "B", 80);
    var data = calc(List.of(a, b, a, t(3, 20, "B", "outside", 10)), Set.of("A", "B"), 180, 60);
    var ext = rows(data.get("external")).getFirst();
    assertThat(ext.get("in")).isEqualTo(BigDecimal.valueOf(100));
    assertThat(ext.get("net")).isEqualTo(BigDecimal.valueOf(90));
    var accounts = rows(data.get("accounts"));
    assertThat((Double) accounts.get(0).get("concentrationPercent"))
        .isCloseTo(100.0 * 20 / 90, within(0.000001));
    assertThat(accounts.get(0).get("rapidOutflowPercent")).isEqualTo(80.0);
  }

  @Test
  void fifo_consumes_old_funds_once_and_does_not_turn_prior_outgoing_into_matches() {
    var data =
        calc(
            List.of(
                t(1, 0, "A", "X", 50),
                t(2, 1, "X", "A", 100),
                t(3, 100, "X", "A", 100),
                t(4, 110, "A", "X", 120),
                t(5, 115, "A", "X", 100)),
            Set.of("A"),
            300,
            60);
    var a = rows(data.get("accounts")).getFirst();
    assertThat(a.get("matchedIn")).isEqualTo(BigDecimal.valueOf(100));
    assertThat(a.get("rapidOutflowPercent")).isEqualTo(50.0);
    assertThat(a.get("concentrationPercent")).isNull();
  }

  @Test
  void excludes_right_censored_credits_and_equal_timestamp_and_self_transfers() {
    var data =
        calc(
            List.of(
                t(1, 0, "X", "A", 100),
                t(2, 0, "A", "X", 100),
                t(3, 50, "X", "A", 100),
                t(4, 55, "A", "X", 150),
                t(5, 10, "A", "A", 900)),
            Set.of("A"),
            100,
            60);
    var a = rows(data.get("accounts")).getFirst();
    assertThat(a.get("eligibleIn")).isEqualTo(BigDecimal.valueOf(100));
    assertThat(a.get("excludedIn")).isEqualTo(BigDecimal.valueOf(100));
    assertThat(a.get("matchedIn")).isEqualTo(BigDecimal.valueOf(100));
    assertThat(a.get("rapidOutflowPercent")).isEqualTo(100.0);
  }

  @Test
  void currencies_are_not_offset_and_zero_denominators_are_null() {
    var incoming = t(1, 0, "X", "A", 100);
    var outgoing =
        new MoneyMetrics.Transfer(
            2,
            start.plusSeconds(60),
            "A",
            "X",
            BigDecimal.valueOf(100),
            "EUR",
            BigDecimal.valueOf(100),
            "EUR");
    var a = rows(calc(List.of(incoming, outgoing), Set.of("A"), 100, 60).get("accounts"));
    assertThat(a).hasSize(2);
    assertThat(a.get(0).get("rapidOutflowPercent")).isNull();
    assertThat(a.get(1).get("rapidOutflowPercent")).isEqualTo(0.0);
  }

  @Test
  void delay_boundary_is_included_but_observation_end_is_excluded() {
    var a =
        rows(calc(
                    List.of(t(1, 0, "X", "A", 100), t(2, 60, "A", "X", 80), t(3, 61, "A", "X", 20)),
                    Set.of("A"),
                    61,
                    60)
                .get("accounts"))
            .getFirst();
    assertThat(a.get("matchedIn")).isEqualTo(BigDecimal.valueOf(80));
  }
}
