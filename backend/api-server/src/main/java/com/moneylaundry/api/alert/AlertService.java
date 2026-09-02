package com.moneylaundry.api.alert;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class AlertService {

  private final ObjectMapper objectMapper;
  private final Path scoresDir;
  private final double threshold;

  public AlertService(
      ObjectMapper objectMapper,
      @Value("${app.storage-dir}") String storageDir,
      @Value("${app.alert.threshold}") double threshold) {
    this.objectMapper = objectMapper;
    this.scoresDir = Path.of(storageDir).resolve("scores");
    this.threshold = threshold;
  }

  public List<AlertResponse> list() throws IOException {
    if (!Files.isDirectory(scoresDir)) {
      return List.of();
    }
    List<AlertResponse> alerts = new ArrayList<>();
    try (Stream<Path> files = Files.list(scoresDir)) {
      for (Path file : files.filter(f -> f.toString().endsWith(".json")).toList()) {
        String uploadId = file.getFileName().toString().replace(".json", "");
        for (JsonNode score : objectMapper.readTree(file.toFile()).path("scores")) {
          double anomalyScore = score.path("anomaly_score").asDouble();
          if (anomalyScore >= threshold) {
            alerts.add(
                new AlertResponse(
                    uploadId,
                    score.path("tx_row").asInt(),
                    anomalyScore,
                    score.path("type_score").asDouble(),
                    score.path("type_class").asInt(),
                    score.path("rule_hits").valueStream().map(JsonNode::asString).toList()));
          }
        }
      }
    }
    alerts.sort(Comparator.comparingDouble(AlertResponse::anomalyScore).reversed());
    return alerts;
  }
}
