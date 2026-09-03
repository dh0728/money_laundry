package com.moneylaundry.api.upload;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

/** W1 더미 워커 점수 JSON 형식. W2에서 API.md §2.1 형식(p_laundering, p_0..p_8)의 DB 적재로 대체되어 폐기 예정. */
public record WorkerScores(@JsonProperty("row_count") int rowCount, List<WorkerScore> scores) {

  public record WorkerScore(
      @JsonProperty("tx_row") int txRow,
      @JsonProperty("anomaly_score") double anomalyScore,
      @JsonProperty("type_score") double typeScore,
      @JsonProperty("type_class") int typeClass,
      @JsonProperty("rule_hits") List<String> ruleHits) {}
}
