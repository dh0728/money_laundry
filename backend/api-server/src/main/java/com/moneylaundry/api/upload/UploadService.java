package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.bank.BankReference;
import com.moneylaundry.api.bank.BankRepository;
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
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.OptionalLong;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/** 은행 수집 API 3단계(API.md §1.1): URL 발급 → (은행이 PUT) → 완료 통지 → 비동기 적재. */
@Slf4j
@Service
public class UploadService {

  private final BatchJobRepository batchJobRepository;
  private final BankRepository banks;
  private final BankReference bankReference;
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final UploadStore uploadStore;
  private final LedgerLoader ledgerLoader;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate completionTx;

  private record Completion(UploadStatusResponse response, boolean received) {}

  private final Duration urlTtl;
  private final long maxSizeBytes;

  public UploadService(
      BatchJobRepository batchJobRepository,
      BankRepository banks,
      BankReference bankReference,
      org.springframework.jdbc.core.JdbcTemplate jdbc,
      UploadStore uploadStore,
      LedgerLoader ledgerLoader,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager,
      @Value("${app.ingest.url-ttl}") Duration urlTtl,
      @Value("${app.ingest.max-size-bytes}") long maxSizeBytes) {
    this.batchJobRepository = batchJobRepository;
    this.banks = banks;
    this.bankReference = bankReference;
    this.jdbc = jdbc;
    this.uploadStore = uploadStore;
    this.ledgerLoader = ledgerLoader;
    this.objectMapper = objectMapper;
    this.completionTx = new TransactionTemplate(transactionManager);
    this.completionTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.urlTtl = urlTtl;
    this.maxSizeBytes = maxSizeBytes;
  }

  @Transactional
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
    byte[] digest = Base64.getDecoder().decode(request.checksumSha256());
    if (digest.length != 32
        || !Base64.getEncoder().encodeToString(digest).equals(request.checksumSha256())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "SHA-256 Base64 형식 오류");
    }
    String hash = HexFormat.of().formatHex(digest);
    BankReference.Entry reference = bankReference.find(bankId).orElse(null);
    jdbc.update(
        """
        INSERT INTO banks (bank_id, name, country, is_reporting)
        VALUES (?, ?, ?, true)
        ON CONFLICT (bank_id) DO UPDATE SET is_reporting = true, updated_at = now()
        """,
        bankId,
        reference == null ? null : reference.name(),
        reference == null ? null : reference.country());
    banks.lockById(bankId).orElseThrow(() -> ApiException.notFound("은행 없음"));
    Instant now = Instant.now();
    for (BatchJob previous :
        batchJobRepository.findByJobTypeAndBankIdAndFileHashOrderByIdDesc(
            JobType.INGEST, bankId, hash)) {
      if (previous.getStatus() == JobStatus.COMPLETED) {
        throw new DuplicateFileException(previous.getFileName(), previous.getReceivedAt());
      }
      if (previous.getStatus() == JobStatus.RECEIVED
          || previous.getStatus() == JobStatus.RUNNING
          || (previous.getStatus() == JobStatus.URL_ISSUED
              && previous.getUrlExpiresAt().isAfter(now))) {
        throw new ApiException(HttpStatus.CONFLICT, "UPLOAD_IN_PROGRESS", "같은 파일의 업로드가 진행 중입니다.");
      }
    }
    Instant expiresAt = now.plus(urlTtl);
    BatchJob job =
        batchJobRepository.save(
            BatchJob.ingestUrlIssued(
                bankId,
                fileName,
                hash,
                request.sizeBytes(),
                request.businessDate(),
                null,
                now,
                expiresAt));
    job.setS3Key("uploads/" + bankId + "/" + job.getId() + "/" + fileName);
    batchJobRepository.save(job);
    UploadTarget target = uploadStore.issue(job.getS3Key(), expiresAt, request.checksumSha256());
    log.info("업로드 URL 발급 uploadId={} bankId={} file={}", job.getId(), bankId, fileName);
    return new IssueUploadResponse(
        job.getId(), bankId, target.url(), target.method(), expiresAt, target.headers());
  }

  public UploadStatusResponse complete(int bankId, long uploadId) {
    BatchJob job = findIngest(uploadId, bankId);
    if (job.getStatus() != JobStatus.URL_ISSUED) {
      return toResponse(job);
    }
    requireLatestUrl(job);
    OptionalLong size = uploadStore.sizeOf(job.getS3Key());
    if (size.isEmpty()
        || size.getAsLong() != job.getSizeBytes()
        || !Base64.getEncoder()
            .encodeToString(HexFormat.of().parseHex(job.getFileHash()))
            .equals(uploadStore.checksumOf(job.getS3Key()))) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "UPLOAD_MISMATCH", "객체 없음 또는 파일 크기/체크섬 불일치");
    }
    Completion completion =
        completionTx.execute(
            status -> {
              banks.lockById(bankId).orElseThrow(() -> ApiException.notFound("은행 없음"));
              // S3 확인 중 재발급/다른 완료가 가능하므로 잠금 후 새 영속 컨텍스트에서 다시 읽는다.
              BatchJob current = findIngest(uploadId, bankId);
              if (current.getStatus() != JobStatus.URL_ISSUED) {
                return new Completion(toResponse(current), false);
              }
              requireLatestUrl(current);
              Instant receivedAt = Instant.now();
              if (batchJobRepository.markReceived(uploadId, bankId, receivedAt) != 1) {
                throw ApiException.invalidTransition("완료 통지 전이 실패");
              }
              current.setStatus(JobStatus.RECEIVED);
              current.setReceivedAt(receivedAt);
              return new Completion(toResponse(current), true);
            });
    // 수신 전이가 커밋된 뒤에만 비동기 적재를 호출한다.
    if (completion.received()) ledgerLoader.load(uploadId);
    return completion.response();
  }

  private void requireLatestUrl(BatchJob job) {
    boolean superseded =
        batchJobRepository
            .findByJobTypeAndBankIdAndFileHashOrderByIdDesc(
                JobType.INGEST, job.getBankId(), job.getFileHash())
            .stream()
            .anyMatch(newer -> newer.getId() > job.getId());
    if (superseded) {
      throw new ApiException(
          HttpStatus.CONFLICT, "UPLOAD_SUPERSEDED", "새 업로드가 발급되었습니다. 최신 업로드 번호를 사용하세요.");
    }
  }

  public UploadStatusResponse status(int bankId, long uploadId) {
    return toResponse(findIngest(uploadId, bankId));
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
        job.getBusinessDate(),
        job.getSizeBytes(),
        job.getRowCount(),
        job.getStatus() == JobStatus.COMPLETED
            ? job.getRowCount()
            : (job.getStatus() == JobStatus.VALIDATION_FAILED || job.getStatus() == JobStatus.FAILED
                ? jdbc.queryForObject(
                    "select count(*) from transactions where ingest_job_id = ?",
                    Integer.class,
                    job.getId())
                : null),
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
