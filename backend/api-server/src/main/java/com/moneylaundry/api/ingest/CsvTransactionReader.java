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

/** 이름 기반 16개 필수 필드와 선택 평가 라벨을 읽는 엄격한 CSV 리더. */
public class CsvTransactionReader {

  /** 행 하나의 형식 오류. missing = 필수값 비어 있음(누락 카운트 대상). */
  public static class RowException extends Exception {
    private final ValidationError error;
    private final boolean missing;
    private final boolean fatal;

    RowException(int row, String column, String reason, boolean missing) {
      this(row, column, reason, missing, false);
    }

    RowException(int row, String column, String reason, boolean missing, boolean fatal) {
      super(reason);
      this.fatal = fatal;
      this.error = new ValidationError(row, column, reason);
      this.missing = missing;
    }

    public ValidationError error() {
      return error;
    }

    public boolean fatal() {
      return fatal;
    }

    public boolean missing() {
      return missing;
    }
  }

  private static final String[] REQUIRED = {
    "Timestamp",
    "From Bank",
    "From Account",
    "To Bank",
    "To Account",
    "Amount Received",
    "Receiving Currency",
    "Amount Paid",
    "Payment Currency",
    "Payment Format",
    "From Bank Name",
    "To Bank Name",
    "From Entity ID",
    "From Entity Name",
    "To Entity ID",
    "To Entity Name"
  };
  private static final String LABEL = "Is Laundering";
  private static final BigDecimal AMOUNT_UPPER_BOUND = new BigDecimal("1E18");
  private static final DateTimeFormatter IBM_TIME =
      DateTimeFormatter.ofPattern("uuuu/MM/dd HH:mm[:ss]").withResolverStyle(ResolverStyle.STRICT);
  private static final DateTimeFormatter ISO_TIME =
      DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm[:ss]")
          .withResolverStyle(ResolverStyle.STRICT);

  private final BufferedReader reader;
  private final ZoneId zone;
  private final int[] index = new int[REQUIRED.length];
  private final int labelIndex;
  private final int width;
  private int fileRow = 1;
  private int recordStart = 1;

  public CsvTransactionReader(BufferedReader reader, ZoneId zone)
      throws IOException, ValidationFailedException {
    this.reader = reader;
    this.zone = zone;
    reader.mark(1);
    if (reader.read() != '\uFEFF') reader.reset();
    String[] cols;
    try {
      cols = readRecord();
    } catch (RowException e) {
      throw new ValidationFailedException(List.of(e.error()), 0);
    }
    if (cols == null)
      throw new ValidationFailedException(List.of(new ValidationError(1, "", "헤더 없음")), 0);
    for (int i = 0; i < cols.length; i++) cols[i] = cols[i].trim();
    List<ValidationError> errors = new ArrayList<>();
    java.util.Set<String> headers = new java.util.HashSet<>();
    for (String col : cols) if (!headers.add(col)) errors.add(new ValidationError(1, "", "중복 헤더"));
    for (int r = 0; r < REQUIRED.length; r++) {
      int found = -1;

      for (int c = 0; c < cols.length; c++) {
        if (cols[c].equals(REQUIRED[r])) {
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
    String[] cols = readRecord();
    while (cols != null && cols.length == 1 && cols[0].isBlank()) cols = readRecord();
    if (cols == null) return null;
    int row = recordStart;
    if (cols.length != width) throw new RowException(row, "", "열 수 불일치", false);
    Instant occurredAt = parseTime(row, "Timestamp", required(row, cols, 0), zone);
    int fromBank = parseBank(row, "From Bank", required(row, cols, 1));
    String fromAccount = account(row, cols, 2);
    int toBank = parseBank(row, "To Bank", required(row, cols, 3));
    String toAccount = account(row, cols, 4);
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
        hash,
        name(row, cols, 10, 100),
        name(row, cols, 11, 100),
        bounded(row, REQUIRED[12], required(row, cols, 12), 100),
        name(row, cols, 13, 200),
        bounded(row, REQUIRED[14], required(row, cols, 14), 100),
        name(row, cols, 15, 200));
  }

  private String name(int row, String[] cols, int index, int max) throws RowException {
    return bounded(
        row,
        REQUIRED[index],
        java.text.Normalizer.normalize(required(row, cols, index), java.text.Normalizer.Form.NFC),
        max);
  }

  // Logical CSV records retain the first physical line, including quoted multiline fields.
  private String[] readRecord() throws IOException, RowException {
    recordStart = fileRow;
    List<String> fields = new ArrayList<>();
    StringBuilder field = new StringBuilder();
    boolean quoted = false, closed = false, any = false;
    while (true) {
      int value = reader.read();
      if (value == -1) {
        if (quoted) throw new RowException(recordStart, "", "닫히지 않은 CSV 따옴표", false, true);
        if (!any) return null;
        fields.add(field.toString());
        return fields.toArray(String[]::new);
      }
      any = true;
      char c = (char) value;
      if (quoted) {
        if (c == '"') {
          reader.mark(1);
          if (reader.read() == '"') field.append('"');
          else {
            reader.reset();
            quoted = false;
            closed = true;
          }
        } else {
          field.append(c);
          if (c == '\r') {
            fileRow++;
            reader.mark(1);
            int next = reader.read();
            if (next == '\n') field.append('\n');
            else reader.reset();
          } else if (c == '\n') fileRow++;
        }
      } else if (c == ',' || c == '\n' || c == '\r') {
        fields.add(field.toString());
        field.setLength(0);
        closed = false;
        if (c != ',') {
          if (c == '\r') {
            reader.mark(1);
            if (reader.read() != '\n') reader.reset();
          }
          fileRow++;
          return fields.toArray(String[]::new);
        }
      } else if (c == '"' && field.isEmpty() && !closed) quoted = true;
      else if (c == '"' || closed)
        throw new RowException(recordStart, "", "CSV 따옴표 형식 오류", false, true);
      else field.append(c);
    }
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
    throw new RowException(row, column, "시각 형식 오류", false);
  }

  private static int parseBank(int row, String column, String value) throws RowException {
    try {
      int bank = Integer.parseInt(value);
      if (bank < 0) throw new NumberFormatException();
      return bank;
    } catch (NumberFormatException e) {
      throw new RowException(row, column, "은행 코드는 0 이상의 정수", false);
    }
  }

  private static BigDecimal parseAmount(int row, String column, String value) throws RowException {
    try {
      BigDecimal amount = new BigDecimal(value);
      if (amount.signum() < 0) {
        throw new RowException(row, column, "금액은 0 이상", false);
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
      throw new RowException(row, column, "금액 형식 오류", false);
    }
  }

  private static String parseCurrency(int row, String column, String value) throws RowException {
    return Currencies.toIso(value)
        .orElseThrow(() -> new RowException(row, column, "매핑표에 없는 통화", false));
  }

  private static Boolean parseLabel(int row, String value) throws RowException {
    String v = value.trim();
    if (v.isEmpty()) {
      return null;
    }
    if (v.equals("0") || v.equals("1")) {
      return v.equals("1");
    }
    throw new RowException(row, LABEL, "라벨은 0 또는 1", false);
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
