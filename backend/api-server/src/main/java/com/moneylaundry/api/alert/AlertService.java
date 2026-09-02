package com.moneylaundry.api.alert;

import com.moneylaundry.api.upload.WorkerScores;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Slf4j
@Service
public class AlertService {

  private static final String SCORE_FILE_SUFFIX = ".json";

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
      for (Path file :
          files.filter(f -> f.getFileName().toString().endsWith(SCORE_FILE_SUFFIX)).toList()) {
        String name = file.getFileName().toString();
        String uploadId = name.substring(0, name.length() - SCORE_FILE_SUFFIX.length());
        try {
          for (WorkerScores.WorkerScore score :
              objectMapper.readValue(file.toFile(), WorkerScores.class).scores()) {
            if (score.anomalyScore() >= threshold) {
              alerts.add(
                  new AlertResponse(
                      uploadId,
                      score.txRow(),
                      score.anomalyScore(),
                      score.typeScore(),
                      score.typeClass(),
                      score.ruleHits()));
            }
          }
        } catch (Exception e) {
          log.warn("점수 파일을 읽지 못해 건너뜀: {}", file, e);
        }
      }
    }
    alerts.sort(Comparator.comparingDouble(AlertResponse::anomalyScore).reversed());
    return alerts;
  }
}
