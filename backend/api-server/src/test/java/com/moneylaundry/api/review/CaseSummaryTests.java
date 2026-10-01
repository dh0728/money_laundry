package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

class CaseSummaryTests {
  private Map<String, Object> member(long id, String state, Object usd) {
    var t = new HashMap<String, Object>();
    t.put("amountUsd", usd);
    return Map.of("txId", id, "reviewRole", "CONTEXT", "state", state, "transaction", t);
  }

  @Test
  void sumsStoredUsdOnceAndExcludesRemovedTransactions() {
    var first = member(1, "PENDING", "1.25");
    var summary =
        CaseSummary.summarize(
            List.of(
                first,
                first,
                member(2, "PENDING", 2.75),
                member(3, "EXCLUDED", 500),
                member(4, "TRANSFERRED", 500)));
    assertThat((BigDecimal) summary.get("totalAmountUsd")).isEqualByComparingTo("4");
    assertThat(summary.get("txCount")).isEqualTo(2);
  }

  @Test
  void missingOrInvalidUsdDoesNotProducePartialTotal() {
    for (Object usd : Arrays.asList(null, "", "bad")) {
      assertThat(
              CaseSummary.summarize(List.of(member(1, "PENDING", 5), member(2, "PENDING", usd)))
                  .get("totalAmountUsd"))
          .isNull();
    }
  }

  @Test
  void emptyAndZeroTotalsRemainZero() {
    assertThat(CaseSummary.summarize(List.of()).get("totalAmountUsd")).isEqualTo(BigDecimal.ZERO);
    assertThat(
            (BigDecimal)
                CaseSummary.summarize(List.of(member(1, "PENDING", "0"))).get("totalAmountUsd"))
        .isEqualByComparingTo("0");
  }
}
