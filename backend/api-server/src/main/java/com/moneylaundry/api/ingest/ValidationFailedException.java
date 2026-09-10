package com.moneylaundry.api.ingest;

import java.util.List;

/** 가벼운 검증·행 검증 실패 — 파일 전체를 적재하지 않는다(all-or-nothing). */
public class ValidationFailedException extends RuntimeException {

  private final List<ValidationError> errors;
  private final int missingCount;
  private final Integer rowCount;
  private final int duplicateCount;

  public ValidationFailedException(List<ValidationError> errors, int missingCount) {
    this(errors, missingCount, null, 0);
  }

  public ValidationFailedException(
      List<ValidationError> errors, int missingCount, Integer rowCount, int duplicateCount) {
    super("검증 실패 " + errors.size() + "건");
    this.rowCount = rowCount;
    this.duplicateCount = duplicateCount;
    this.errors = List.copyOf(errors);
    this.missingCount = missingCount;
  }

  public List<ValidationError> errors() {
    return errors;
  }

  public Integer rowCount() {
    return rowCount;
  }

  public int duplicateCount() {
    return duplicateCount;
  }

  public int missingCount() {
    return missingCount;
  }
}
