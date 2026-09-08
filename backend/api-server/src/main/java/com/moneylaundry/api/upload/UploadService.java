package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.batchjob.BatchJob;
import com.moneylaundry.api.batchjob.BatchJobRepository;
import com.moneylaundry.api.batchjob.JobStatus;
import com.moneylaundry.api.batchjob.JobType;
import com.moneylaundry.api.ingest.LedgerLoader;
import com.moneylaundry.api.ingest.ValidationError;
import com.moneylaundry.api.storage.UploadStore;
import com.moneylaundry.api.storage.UploadTarget;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** 은행 수집 API 3단계(API.md §1.1): URL 발급 → (은행이 PUT) → 완료 통지 → 비동기 적재. */
@Slf4j
@Service
public class UploadService {

  private final BatchJobRepository batchJobRepository;
  private final UploadStore uploadStore;
  private final LedgerLoader ledgerLoader;
  private final ObjectMapper objectMapper;
  private final Duration urlTtl;
  private final long maxSizeBytes;

  public UploadService(
      BatchJobRepository batchJobRepository,
      UploadStore uploadStore,
      LedgerLoader ledgerLoader,
      ObjectMapper objectMapper,
      @Value("${app.ingest.url-ttl}") Duration urlTtl,
      @Value("${app.ingest.max-size-bytes}") long maxSizeBytes) {
    this.batchJobRepository = batchJobRepository;
    this.uploadStore = uploadStore;
    this.ledgerLoader = ledgerLoader;
    this.objectMapper = objectMapper;
    this.urlTtl = urlTtl;
    this.maxSizeBytes = maxSizeBytes;
  }

  public IssueUploadResponse issue(int bankId, IssueUploadRequest request) {
    String fileName = request.fileName().trim();
    if (fileName.contains("/") || fileName.contains("\\") || fileName.contains("..")) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "fileName에 경로 문자를 쓸 수 없음");
    }
    if (request.sizeBytes() > maxSizeBytes) {
      throw new ApiException(
          HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "최대 " + maxSizeBytes + " bytes");
    }
    if (batchJobRepository.existsByJobTypeAndFileHashAndStatus(
        JobType.INGEST, request.sha256(), JobStatus.COMPLETED)) {
      throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_FILE", "같은 해시의 파일이 이미 적재됨");
    }
    Instant now = Instant.now();
    Instant expiresAt = now.plus(urlTtl);
    BatchJob job =
        batchJobRepository.save(
            BatchJob.ingestUrlIssued(
                bankId,
                fileName,
                request.sha256(),
                request.sizeBytes(),
                request.businessDate(),
                null,
                now,
                expiresAt));
    job.setS3Key("uploads/" + bankId + "/" + job.getId() + "/" + fileName);
    batchJobRepository.save(job);
    UploadTarget target = uploadStore.issue(job.getS3Key(), expiresAt);
    log.info("업로드 URL 발급 uploadId={} bankId={} file={}", job.getId(), bankId, fileName);
    return new IssueUploadResponse(
        job.getId(), target.url(), target.method(), expiresAt, target.headers());
  }

  public UploadStatusResponse complete(int bankId, long uploadId) {
    BatchJob job = findIngest(uploadId, bankId);
    if (job.getStatus() != JobStatus.URL_ISSUED) {
      throw ApiException.invalidTransition("완료 통지는 URL_ISSUED 상태에서만: " + job.getStatus());
    }
    OptionalLong size = uploadStore.sizeOf(job.getS3Key());
    if (size.isEmpty() || size.getAsLong() != job.getSizeBytes()) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "UPLOAD_MISMATCH",
          "객체 없음 또는 크기 불일치(선언 " + job.getSizeBytes() + ", 실제 " + size + ")");
    }
    Instant receivedAt = Instant.now();
    if (batchJobRepository.markReceived(uploadId, bankId, receivedAt) != 1) {
      throw ApiException.invalidTransition("이미 완료 통지가 접수됨: " + uploadId);
    }
    // 조건부 갱신이 커밋된 뒤 적재를 시작한다. 응답 객체를 다시 저장하지 않는다.
    job.setStatus(JobStatus.RECEIVED);
    job.setReceivedAt(receivedAt);
    ledgerLoader.load(job.getId());
    return toResponse(job);
  }

  public UploadStatusResponse status(long uploadId) {
    return toResponse(findIngest(uploadId, null));
  }

  private BatchJob findIngest(long uploadId, Integer bankId) {
    return batchJobRepository
        .findById(uploadId)
        .filter(j -> j.getJobType() == JobType.INGEST)
        .filter(j -> bankId == null || bankId.equals(j.getBankId()))
        .orElseThrow(() -> ApiException.notFound("업로드 없음: " + uploadId));
  }

  private UploadStatusResponse toResponse(BatchJob job) {
    List<ValidationError> errors =
        job.getValidationErrors() == null
            ? List.of()
            : objectMapper.readValue(job.getValidationErrors(), new TypeReference<>() {});
    return new UploadStatusResponse(
        job.getId(),
        job.getBankId(),
        job.getFileName(),
        job.getSizeBytes(),
        job.getRowCount(),
        job.getMissingCount(),
        job.getDuplicateCount(),
        job.getStatus(),
        job.getErrorCode(),
        job.getErrorMessage(),
        errors,
        job.getUrlIssuedAt(),
        job.getReceivedAt(),
        job.getStartedAt(),
        job.getFinishedAt());
  }
}
