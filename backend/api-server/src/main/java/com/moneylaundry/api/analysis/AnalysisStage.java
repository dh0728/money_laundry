package com.moneylaundry.api.analysis;

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
