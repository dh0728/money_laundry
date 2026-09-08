package com.moneylaundry.api.ingest;

import java.util.List;

/** 가벼운 검증·행 검증 실패 — 파일 전체를 적재하지 않는다(all-or-nothing). */
public class ValidationFailedException extends RuntimeException {

  private final List<ValidationError> errors;
  private final int missingCount;

  public ValidationFailedException(List<ValidationError> errors, int missingCount) {
    super("검증 실패 " + errors.size() + "건");
    this.errors = List.copyOf(errors);
    this.missingCount = missingCount;
  }

  public List<ValidationError> errors() {
    return errors;
  }

  public int missingCount() {
    return missingCount;
  }
}
