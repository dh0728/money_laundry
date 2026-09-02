package com.moneylaundry.api.alert;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AlertApiTests {

  static Path tempStorage;

  @DynamicPropertySource
  static void storageDir(DynamicPropertyRegistry registry) throws IOException {
    tempStorage = Files.createTempDirectory("alert-test");
    registry.add("app.storage-dir", () -> tempStorage.toString());
  }

  @Autowired MockMvc mockMvc;

  @Test
  void 임계값_이상_점수만_높은_순으로_알림_목록에_내려주고_깨진_파일은_건너뛴다() throws Exception {
    Path scores = tempStorage.resolve("scores");
    Files.createDirectories(scores);
    Files.writeString(
        scores.resolve("u1.json"),
        """
        {"row_count":3,"scores":[
          {"tx_row":0,"anomaly_score":0.2,"type_score":0.9,"type_class":1,"rule_hits":[]},
          {"tx_row":1,"anomaly_score":0.7,"type_score":0.1,"type_class":8,"rule_hits":["R1"]},
          {"tx_row":2,"anomaly_score":0.95,"type_score":0.5,"type_class":3,"rule_hits":[]}]}
        """);
    Files.writeString(scores.resolve("broken.json"), "{\"row_count\":1,\"scores\":[{");

    mockMvc
        .perform(get("/api/alerts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].uploadId").value("u1"))
        .andExpect(jsonPath("$[0].txRow").value(2))
        .andExpect(jsonPath("$[0].anomalyScore").value(0.95))
        .andExpect(jsonPath("$[1].txRow").value(1))
        .andExpect(jsonPath("$[1].ruleHits[0]").value("R1"));
  }
}
