package com.moneylaundry.api.analysis;

public enum AnalysisStage {
  WAIT_INGEST,
  FEATURES,
  INFERENCE,
  SCORES,
  ALERTS,
  COMPLETE;

  public AnalysisStage next() {
    return values()[ordinal() + 1];
  }
}
