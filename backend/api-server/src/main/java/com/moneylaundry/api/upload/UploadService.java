package com.moneylaundry.api.upload;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

@Slf4j
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
    log.info(
        "업로드 수신 uploadId={} file={} size={}", uploadId, file.getOriginalFilename(), file.getSize());
    long started = System.currentTimeMillis();
    try {
      scoreWorker.score(csv, scores);
      WorkerScores parsed = objectMapper.readValue(scores.toFile(), WorkerScores.class);
      log.info(
          "워커 완료 uploadId={} rowCount={} elapsedMs={}",
          uploadId,
          parsed.rowCount(),
          System.currentTimeMillis() - started);
      return new UploadResponse(uploadId, parsed.rowCount());
    } catch (RuntimeException e) {
      log.error("업로드 실패 uploadId={}", uploadId, e);
      throw e;
    }
  }
}
