package com.moneylaundry.api.upload;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** 워커 점수 JSON의 단일 계약. 필드 확정은 [API 계약]에서, W2 모델 래핑 시 여기만 고친다. */
public record WorkerScores(@JsonProperty("row_count") int rowCount, List<WorkerScore> scores) {

  public record WorkerScore(
      @JsonProperty("tx_row") int txRow,
      @JsonProperty("anomaly_score") double anomalyScore,
      @JsonProperty("type_score") double typeScore,
      @JsonProperty("type_class") int typeClass,
      @JsonProperty("rule_hits") List<String> ruleHits) {}
}
