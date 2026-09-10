package com.moneylaundry.api.ingest;

import java.io.BufferedReader;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * IBM AMLworld 헤더의 CSV를 한 행씩 {@link TransactionRow}로 바꾼다(API.md §1.4 컬럼 표). 헤더 "Account"가 두 번 나오므로
 * 이름이 아니라 등장 순서로 송신·수신을 가른다. 필드에 쉼표·따옴표가 없는 IBM 형식을 전제로 단순 분할한다. 시각은 시간대 표기가 없어 app.zone(서울 표준시)으로
 * 해석한다.
 */
public class CsvTransactionReader {

  /** 행 하나의 형식 오류. missing = 필수값 비어 있음(누락 카운트 대상). */
  public static class RowException extends Exception {
    private final ValidationError error;
    private final boolean missing;

    RowException(int row, String column, String reason, boolean missing) {
      super(reason);
      this.error = new ValidationError(row, column, reason);
      this.missing = missing;
    }

    public ValidationError error() {
      return error;
    }

    public boolean missing() {
      return missing;
    }
  }

  private static final String[] REQUIRED = {
    "Timestamp",
    "From Bank",
    "Account",
    "To Bank",
    "Account",
    "Amount Received",
    "Receiving Currency",
    "Amount Paid",
    "Payment Currency",
    "Payment Format"
  };
  private static final String LABEL = "Is Laundering";
  private static final BigDecimal AMOUNT_UPPER_BOUND = new BigDecimal("1E18");
  private static final DateTimeFormatter IBM_TIME =
      DateTimeFormatter.ofPattern("uuuu/MM/dd HH:mm[:ss]").withResolverStyle(ResolverStyle.STRICT);
  private static final DateTimeFormatter ISO_TIME =
      DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm[:ss]")
          .withResolverStyle(ResolverStyle.STRICT);

  private final BufferedReader reader;
  private final Pseudonymizer pseudonymizer;
  private final ZoneId zone;
  private final int[] index = new int[REQUIRED.length];
  private final int labelIndex;
  private final int width;
  private int fileRow = 1;

  public CsvTransactionReader(BufferedReader reader, Pseudonymizer pseudonymizer, ZoneId zone)
      throws IOException, ValidationFailedException {
    this.reader = reader;
    this.pseudonymizer = pseudonymizer;
    this.zone = zone;
    String header = reader.readLine();
    if (header == null || header.isBlank()) {
      throw new ValidationFailedException(List.of(new ValidationError(1, "", "빈 파일 또는 헤더 없음")), 0);
    }
    if (header.startsWith("\uFEFF")) {
      header = header.substring(1);
    }
    String[] cols = header.split(",", -1);
    for (int i = 0; i < cols.length; i++) {
      cols[i] = cols[i].trim();
    }
    List<ValidationError> errors = new ArrayList<>();
    int accountSeen = 0;
    for (int r = 0; r < REQUIRED.length; r++) {
      int found = -1;
      int skip = REQUIRED[r].equals("Account") ? accountSeen++ : 0;
      for (int c = 0; c < cols.length; c++) {
        if (cols[c].equals(REQUIRED[r]) && skip-- == 0) {
          found = c;
          break;
        }
      }
      if (found < 0) {
        errors.add(new ValidationError(1, REQUIRED[r], "헤더 누락"));
      }
      index[r] = found;
    }
    if (!errors.isEmpty()) {
      throw new ValidationFailedException(errors, 0);
    }
    int label = -1;
    for (int c = 0; c < cols.length; c++) {
      if (cols[c].equals(LABEL)) {
        label = c;
      }
    }
    this.labelIndex = label;
    this.width = cols.length;
  }

  public boolean hasLabelColumn() {
    return labelIndex >= 0;
  }

  /** 다음 행. 파일 끝이면 null. 빈 줄은 건너뛴다. */
  public TransactionRow next() throws IOException, RowException {
    String line;
    do {
      line = reader.readLine();
      if (line == null) {
        return null;
      }
      fileRow++;
    } while (line.isBlank());
    String[] cols = line.split(",", -1);
    if (cols.length != width) {
      throw new RowException(fileRow, "", "열 수 불일치(" + cols.length + "/" + width + ")", false);
    }
    int row = fileRow;
    Instant occurredAt = parseTime(row, "Timestamp", required(row, cols, 0), zone);
    int fromBank = parseBank(row, "From Bank", required(row, cols, 1));
    String fromAccount = pseudonymizer.pseudonymize(fromBank, account(row, cols, 2));
    int toBank = parseBank(row, "To Bank", required(row, cols, 3));
    String toAccount = pseudonymizer.pseudonymize(toBank, account(row, cols, 4));
    BigDecimal amountReceived = parseAmount(row, "Amount Received", required(row, cols, 5));
    String receivingCurrency = parseCurrency(row, "Receiving Currency", required(row, cols, 6));
    BigDecimal amountPaid = parseAmount(row, "Amount Paid", required(row, cols, 7));
    String paymentCurrency = parseCurrency(row, "Payment Currency", required(row, cols, 8));
    String paymentFormat = bounded(row, "Payment Format", required(row, cols, 9), 30);
    Boolean isLaundering = labelIndex < 0 ? null : parseLabel(row, cols[labelIndex]);
    String hash =
        sha256(
            String.join(
                "|",
                occurredAt.toString(),
                Integer.toString(fromBank),
                fromAccount,
                Integer.toString(toBank),
                toAccount,
                amountReceived.stripTrailingZeros().toPlainString(),
                receivingCurrency,
                amountPaid.stripTrailingZeros().toPlainString(),
                paymentCurrency,
                paymentFormat));
    return new TransactionRow(
        row,
        occurredAt,
        fromBank,
        fromAccount,
        toBank,
        toAccount,
        amountReceived,
        receivingCurrency,
        amountPaid,
        paymentCurrency,
        paymentFormat,
        isLaundering,
        hash);
  }

  private String account(int row, String[] cols, int r) throws RowException {
    String value = required(row, cols, r);
    if (value.contains("|")) {
      throw new RowException(row, REQUIRED[r], (r == 2 ? "송신" : "수신") + " 계좌번호에 | 사용 불가", false);
    }
    if (value.codePointCount(0, value.length()) > 100) {
      throw new RowException(row, REQUIRED[r], (r == 2 ? "송신" : "수신") + " 계좌번호 최대 100자 초과", false);
    }
    return value;
  }

  private String bounded(int row, String column, String value, int limit) throws RowException {
    if (value.codePointCount(0, value.length()) > limit) {
      throw new RowException(row, column, "최대 " + limit + "자 초과", false);
    }
    return value;
  }

  private String required(int row, String[] cols, int r) throws RowException {
    String value = cols[index[r]].trim();
    if (value.isEmpty()) {
      throw new RowException(row, REQUIRED[r], "필수값 없음", true);
    }
    return value;
  }

  private static Instant parseTime(int row, String column, String value, ZoneId zone)
      throws RowException {
    for (DateTimeFormatter formatter : new DateTimeFormatter[] {IBM_TIME, ISO_TIME}) {
      try {
        return LocalDateTime.parse(value, formatter).atZone(zone).toInstant();
      } catch (DateTimeParseException ignored) {
        // 다음 형식 시도
      }
    }
    throw new RowException(row, column, "시각 형식 오류: " + value, false);
  }

  private static int parseBank(int row, String column, String value) throws RowException {
    try {
      return Integer.parseInt(value);
    } catch (NumberFormatException e) {
      throw new RowException(row, column, "은행 코드는 정수: " + value, false);
    }
  }

  private static BigDecimal parseAmount(int row, String column, String value) throws RowException {
    try {
      BigDecimal amount = new BigDecimal(value);
      if (amount.signum() < 0) {
        throw new RowException(row, column, "금액은 0 이상: " + value, false);
      }
      if (amount.compareTo(AMOUNT_UPPER_BOUND) >= 0) {
        throw new RowException(row, column, "금액 정수부는 최대 18자리", false);
      }
      BigDecimal normalized = amount.stripTrailingZeros();
      if (normalized.scale() > 6) {
        throw new RowException(row, column, "금액 소수부는 끝자리 0을 제외하고 최대 6자리", false);
      }
      return normalized;
    } catch (NumberFormatException e) {
      throw new RowException(row, column, "금액 형식 오류: " + value, false);
    }
  }

  private static String parseCurrency(int row, String column, String value) throws RowException {
    return Currencies.toIso(value)
        .orElseThrow(() -> new RowException(row, column, "매핑표에 없는 통화: " + value, false));
  }

  private static Boolean parseLabel(int row, String value) throws RowException {
    String v = value.trim();
    if (v.isEmpty()) {
      return null;
    }
    if (v.equals("0") || v.equals("1")) {
      return v.equals("1");
    }
    throw new RowException(row, LABEL, "라벨은 0 또는 1: " + v, false);
  }

  private static String sha256(String text) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
