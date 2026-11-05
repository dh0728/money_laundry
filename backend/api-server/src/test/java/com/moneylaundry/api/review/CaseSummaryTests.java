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

  private Map<String, Object> seed(long id, Object... probabilities) {
    var scores = new HashMap<String, Object>();
    for (int i = 0; i < probabilities.length; i += 2)
      scores.put((String) probabilities[i], probabilities[i + 1]);
    var t = new HashMap<String, Object>();
    t.put("amountUsd", "1");
    t.put("role", "SEED");
    t.put("scores", scores);
    return Map.of("txId", id, "reviewRole", "CONTEXT", "state", "PENDING", "transaction", t);
  }

  @Test
  void primaryTypeMultipliesSeedProbabilitiesInsteadOfCountingTopVotes() {
    var summary =
        CaseSummary.summarize(
            List.of(
                seed(1, "p_1", .5, "p_5", .4, "p_0", .1),
                seed(2, "p_1", .5, "p_5", .4, "p_0", .1),
                seed(3, "p_5", .9, "p_0", .1)));
    assertThat(summary.get("primaryType")).isEqualTo("Cycle");
    assertThat((double) summary.get("typeShare")).isEqualTo(1.0 / 3);
  }

  @Test
  void nonPatternTopSeedsAndBipartiteStackProbabilitiesAreLeftOut() {
    var summary =
        CaseSummary.summarize(
            List.of(
                seed(1, "p_7", .9, "p_1", .06, "p_0", .04),
                seed(2, "p_8", .9, "p_0", .06, "p_6", .04),
                seed(3, "p_0", .9, "p_6", .1)));
    assertThat(summary.get("primaryType")).isEqualTo("Fan-out");
    assertThat((double) summary.get("typeShare")).isEqualTo(1.0 / 3);
    assertThat(CaseSummary.summarize(List.of(seed(1, "p_0", .9, "p_6", .1))).get("primaryType"))
        .isEqualTo("패턴 미특정");
  }

  @Test
  void exactlyEqualProductsAreMixed() {
    var summary =
        CaseSummary.summarize(
            List.of(seed(1, "p_1", .6, "p_2", .4), seed(2, "p_2", .6, "p_1", .4)));
    assertThat(summary.get("primaryType")).isEqualTo("혼합");
    assertThat((double) summary.get("typeShare")).isZero();
  }
}
