package com.moneylaundry.api.upload;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

@Service
public class UploadService {

  private final ScoreWorker scoreWorker;
  private final ObjectMapper objectMapper;
  private final Path storageDir;

  public UploadService(
      ScoreWorker scoreWorker,
      ObjectMapper objectMapper,
      @Value("${app.storage-dir}") String storageDir) {
    this.scoreWorker = scoreWorker;
    this.objectMapper = objectMapper;
    this.storageDir = Path.of(storageDir);
  }

  public UploadResponse process(MultipartFile file) throws IOException {
    String uploadId = UUID.randomUUID().toString();
    Path csv = storageDir.resolve("uploads").resolve(uploadId + ".csv").toAbsolutePath();
    Path scores = storageDir.resolve("scores").resolve(uploadId + ".json").toAbsolutePath();
    Files.createDirectories(csv.getParent());
    Files.createDirectories(scores.getParent());
    file.transferTo(csv);
    scoreWorker.score(csv, scores);
    int rowCount = objectMapper.readTree(scores.toFile()).path("row_count").asInt();
    return new UploadResponse(uploadId, rowCount);
  }
}
