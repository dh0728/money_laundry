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

  @ParameterizedTest
  @ValueSource(
      strings = {
        "123.1234567",
        "0.0000001",
        "1000000000000000000",
        "1E+1000",
        "1E-1000",
        "1E+2147483647",
        "1E-2147483647",
        "-1",
        "NaN",
        "not-a-number"
      })
  void 양쪽_금액의_저장불가_값은_행오류다(String amount) throws Exception {
    for (int column : new int[] {5, 7}) {
      var reader = amountReader(column == 5 ? amount : "1", column == 7 ? amount : "1");
      var error = assertThrows(CsvTransactionReader.RowException.class, reader::next);
      assertThat(error.error().row()).isEqualTo(2);
      assertThat(error.error().column()).isEqualTo(column == 5 ? "Amount Received" : "Amount Paid");
      assertThat(error.error().reason()).isNotBlank();
      assertThat(error.missing()).isFalse();
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "0",
        "0.0000000",
        "0E-2147483647",
        "0E+2147483647",
        "0.000001",
        "123.123456",
        "123.1234560",
        "999999999999999999.999999",
        "1E+17",
        "1E-6"
      })
  void 양쪽_금액의_저장가능_값은_정확히_보존한다(String amount) throws Exception {
    var row = amountReader(amount, amount).next();
    assertThat(row.amountReceived()).isEqualByComparingTo(amount);
    assertThat(row.amountPaid()).isEqualByComparingTo(amount);
  }

  @org.junit.jupiter.api.Test
  void 동등한_금액표기는_기존_정규화_해시를_유지한다() throws Exception {
    var base = amountReader("123.123456", "1").next();
    var same = amountReader("123.1234560", "1.0000000").next();
    assertThat(base.rowHash())
        .isEqualTo("5fd92448c2b1f6ada227f099c789d87b0e2082f087c8c7c399164db89f0cf23b");
    assertThat(same.rowHash()).isEqualTo(base.rowHash());
  }

  @ParameterizedTest
  @ValueSource(ints = {2, 4, 9})
  void 문자열_길이는_trim후_코드포인트로_검사한다(int column) throws Exception {
    int limit = column == 9 ? 30 : 100;
    for (String unit : new String[] {"A", "한", "\uD83D\uDE00"}) {
      String[] values = "2024/02/29 12:34,70,A,12,B,1,US Dollar,1,US Dollar,ACH".split(",");
      values[column] = " " + unit.repeat(limit) + " ";
      var accepted = textReader(String.join(",", values)).next();
      assertThat(
              column == 2
                  ? accepted.fromAccount()
                  : column == 4 ? accepted.toAccount() : accepted.paymentFormat())
          .isEqualTo(unit.repeat(limit));
      values[column] = unit.repeat(limit + 1);
      var reader = textReader(String.join(",", values));
      var error = assertThrows(CsvTransactionReader.RowException.class, reader::next);
      assertThat(error.error().column()).isEqualTo(column == 9 ? "Payment Format" : "Account");
      assertThat(error.error().reason()).contains(Integer.toString(limit));
      if (column != 9) assertThat(error.error().reason()).contains(column == 2 ? "송신" : "수신");
      assertThat(error.missing()).isFalse();
    }
  }

  private CsvTransactionReader textReader(String row) throws Exception {
    return new CsvTransactionReader(
        new BufferedReader(new StringReader(HEADER + row + "\n")),
        new IdentityPseudonymizer(),
        ZoneId.of("Asia/Seoul"));
  }

  private CsvTransactionReader amountReader(String received, String paid) throws Exception {
    return new CsvTransactionReader(
        new BufferedReader(
            new StringReader(
                HEADER
                    + "2024/02/29 12:34,70,A,12,B,"
                    + received
                    + ",US Dollar,"
                    + paid
                    + ",US Dollar,ACH\n")),
        new IdentityPseudonymizer(),
        ZoneId.of("Asia/Seoul"));
  }

  private CsvTransactionReader reader(String timestamp) throws Exception {
    return new CsvTransactionReader(
        new BufferedReader(
            new StringReader(HEADER + timestamp + ",70,A,12,B,1,US Dollar,1,US Dollar,ACH\n")),
        new IdentityPseudonymizer(),
        ZoneId.of("Asia/Seoul"));
  }
}
