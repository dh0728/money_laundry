package com.moneylaundry.api.ai;

import static org.assertj.core.api.Assertions.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 자금 경로 사실: 경유 계좌, 큰 송금·수취 상대, 첫 유입에서 첫 유출까지 걸린 시간. */
class CasePathTests {
  static CaseFacts.Move move(long from, long to, int usd, String at) {
    return new CaseFacts.Move(from, to, BigDecimal.valueOf(usd), Instant.parse(at));
  }

  static final Map<Long, String> CODES =
      Map.of(
          1L,
          "001-0001",
          2L,
          "002-0001",
          3L,
          "003-0001",
          9L,
          "020-0009",
          7L,
          "081-0007",
          8L,
          "011-0008");

  @Test
  void hub_with_largest_through_flow_is_written_with_its_main_sources_and_targets() {
    var moves =
        List.of(
            move(1, 9, 12000, "2023-09-02T13:10:00Z"),
            move(2, 9, 8500, "2023-09-02T14:45:00Z"),
            move(3, 9, 1000, "2023-09-02T15:00:00Z"),
            move(9, 7, 30000, "2023-09-03T07:50:00Z"),
            move(9, 8, 24500, "2023-09-03T17:10:00Z"));
    assertThat(CaseFacts.pathLines(moves, CODES))
        .containsExactly(
            "자금 경로: 001-0001 12,000 USD, 002-0001 8,500 USD → 020-0009 → 081-0007 30,000 USD, 011-0008 24,500 USD."
                + " 경유 계좌 020-0009 유입 21,500 USD, 유출 54,500 USD, 첫 유입 후 18시간 뒤 첫 유출");
  }

  @Test
  void no_line_without_an_account_that_both_receives_and_sends() {
    var moves =
        List.of(move(1, 9, 100, "2023-09-02T13:10:00Z"), move(2, 9, 100, "2023-09-02T14:10:00Z"));
    assertThat(CaseFacts.pathLines(moves, CODES)).isEmpty();
  }

  @Test
  void outflow_before_inflow_is_said_so() {
    var moves =
        List.of(move(9, 7, 500, "2023-09-02T10:00:00Z"), move(1, 9, 500, "2023-09-02T12:00:00Z"));
    assertThat(CaseFacts.pathLines(moves, CODES).getFirst()).endsWith("유출이 유입보다 먼저 시작");
  }
}
