package com.moneylaundry.api.demo;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

@JsonTest
class DemoTriggerJsonTests {
  @Autowired tools.jackson.databind.ObjectMapper mapper;

  @Test
  void normal_request_without_backfill_is_not_rejected_and_is_not_a_backfill() {
    var normal =
        mapper.readValue("{\"businessDate\":\"2023-09-07\"}", DemoAnalysisController.Trigger.class);
    assertThat(normal.isBackfill()).isFalse();
    var backfill =
        mapper.readValue(
            "{\"businessDate\":\"2023-09-01\",\"backfill\":true}",
            DemoAnalysisController.Trigger.class);
    assertThat(backfill.isBackfill()).isTrue();
  }
}
