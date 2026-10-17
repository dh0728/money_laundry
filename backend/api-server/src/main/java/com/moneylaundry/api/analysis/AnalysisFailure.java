package com.moneylaundry.api.analysis;

/** 분석 단계 실패. Kind로 재시도 간격(CONNECTION 30초·2분, COMPUTATION 1분·5분)과 즉시 조치 필요(PERMANENT)를 구분한다. */
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
