package com.moneylaundry.api.analysis;

public class AnalysisFailure extends RuntimeException {
  public enum Kind {
    CONNECTION,
    COMPUTATION,
    PERMANENT
  }

  private final String code;
  private final Kind kind;

  public AnalysisFailure(String code, Kind kind) {
    super("분석 단계 처리 실패");
    this.code = code;
    this.kind = kind;
  }

  public String code() {
    return code;
  }

  public Kind kind() {
    return kind;
  }
}
