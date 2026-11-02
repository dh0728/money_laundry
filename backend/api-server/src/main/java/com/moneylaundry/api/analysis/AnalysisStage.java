package com.moneylaundry.api.analysis;

/** 일별 분석 단계 순서. next()는 다음 단계를 돌려주며 COMPLETE가 마지막이다. */
public enum AnalysisStage {
  WAIT_INGEST,
  INTEGRATE,
  FREEZE_INPUT,
  FEATURES,
  INFERENCE,
  SCORES,
  ALERTS,
  COMPLETE;

  public AnalysisStage next() {
    return values()[ordinal() + 1];
  }
}
