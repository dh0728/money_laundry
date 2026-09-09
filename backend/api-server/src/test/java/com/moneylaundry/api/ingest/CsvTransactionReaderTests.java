package com.moneylaundry.api.ingest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.BufferedReader;
import java.io.StringReader;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class CsvTransactionReaderTests {
  private static final String HEADER =
      "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
          + "Amount Paid,Payment Currency,Payment Format\n";

  @ParameterizedTest
  @ValueSource(
      strings = {
        "2026/02/30 00:00", "2026-02-30T00:00:00",
        "2026/02/29 12:00:00", "2026-02-29T12:00",
        "2026/09/08 24:00", "2026-09-08T24:00:00"
      })
  void 존재하지_않는_날짜와_시각은_거부한다(String timestamp) throws Exception {
    CsvTransactionReader reader = reader(timestamp);
    var error = assertThrows(CsvTransactionReader.RowException.class, reader::next);
    assertThat(error.error().column()).isEqualTo("Timestamp");
    assertThat(error.missing()).isFalse();
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "2024/02/29 12:34", "2024/02/29 12:34:00",
        "2024-02-29T12:34", "2024-02-29T12:34:00"
      })
  void 윤년과_초_생략을_지원하고_서울_시간으로_해석한다(String timestamp) throws Exception {
    assertThat(reader(timestamp).next().occurredAt())
        .isEqualTo(Instant.parse("2024-02-29T03:34:00Z"));
  }

  private CsvTransactionReader reader(String timestamp) throws Exception {
    return new CsvTransactionReader(
        new BufferedReader(
            new StringReader(HEADER + timestamp + ",70,A,12,B,1,US Dollar,1,US Dollar,ACH\n")),
        new IdentityPseudonymizer(),
        ZoneId.of("Asia/Seoul"));
  }
}
