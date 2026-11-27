package com.moneylaundry.api.ingest.upload;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.ingest.load.LedgerLoader;
import com.moneylaundry.api.ingest.load.ValidationError;
import com.moneylaundry.api.ingest.storage.UploadStore;
import com.moneylaundry.api.ingest.storage.UploadTarget;
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

/** 원장 파일 수집 3단계(API.md §1.1): URL 발급 → (관리자가 PUT) → 완료 통지 → 비동기 적재. 거래 기준일마다 원장 파일 하나가 적재된다. */
@Slf4j
@Service
public class UploadService {

  private final UploadRepository uploadRepository;
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final UploadStore uploadStore;
  private final LedgerLoader ledgerLoader;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate completionTx;

  private record Completion(UploadStatusResponse response, boolean received) {}

  // URL expiry runs on the real clock; issue/receipt times are business time.
  private final java.time.Clock clock;
  private final com.moneylaundry.api.common.BusinessTime businessTime;
  private final Duration urlTtl;
  private final long maxSizeBytes;

  @Value("${app.zone}")
  private String zone = "Asia/Seoul";

  @Value("${app.ingest.cutoff}")
  private java.time.LocalTime cutoff = java.time.LocalTime.of(3, 0);

  public UploadService(
      UploadRepository uploadRepository,
      org.springframework.jdbc.core.JdbcTemplate jdbc,
      UploadStore uploadStore,
      LedgerLoader ledgerLoader,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager,
      java.time.Clock clock,
      com.moneylaundry.api.common.BusinessTime businessTime,
      @Value("${app.ingest.url-ttl}") Duration urlTtl,
      @Value("${app.ingest.max-size-bytes}") long maxSizeBytes) {
    this.clock = clock;
    this.businessTime = businessTime;
    this.uploadRepository = uploadRepository;
    this.jdbc = jdbc;
    this.uploadStore = uploadStore;
    this.ledgerLoader = ledgerLoader;
    this.objectMapper = objectMapper;
    this.completionTx = new TransactionTemplate(transactionManager);
    this.completionTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.urlTtl = urlTtl;
    this.maxSizeBytes = maxSizeBytes;
  }

  private void receiptLock() {
    jdbc.query(
        "select pg_advisory_xact_lock(?)",
        ps -> ps.setLong(1, com.moneylaundry.api.analysis.AnalysisService.RECEIPT_LOCK),
        rs -> {});
  }

  private void requireNotLoaded(java.time.LocalDate date) {
    if (Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from ingest.uploads where business_date=? and status='COMPLETED')",
            Boolean.class,
            date)))
      throw new ApiException(
          HttpStatus.CONFLICT, "DATE_ALREADY_LOADED", "이 거래 기준일의 원장은 이미 적재되었습니다.");
  }

  @Transactional
  public IssueUploadResponse issue(IssueUploadRequest request) {
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
    receiptLock();
    Instant now = clock.instant();
    for (Upload previous : uploadRepository.findByFileHashOrderByIdDesc(hash)) {
      if (previous.getStatus() == UploadStatus.COMPLETED) {
        throw new DuplicateFileException(
            previous.getId(), previous.getFileName(), previous.getReceivedAt());
      }
      // A retry after a lost issue response gets the same upload back, so its PUT still happens.
      if (previous.getStatus() == UploadStatus.URL_ISSUED
          && previous.getUrlExpiresAt().isAfter(now)
          && previous.getFileName().equals(fileName)
          && previous.getBusinessDate().equals(request.businessDate())
          && previous.getSizeBytes().equals(request.sizeBytes())) {
        UploadTarget priorTarget =
            uploadStore.issue(
                previous.getS3Key(), previous.getUrlExpiresAt(), request.checksumSha256());
        log.info("업로드 URL 재발급 uploadId={} file={}", previous.getId(), fileName);
        return new IssueUploadResponse(
            previous.getId(),
            priorTarget.url(),
            priorTarget.method(),
            previous.getUrlExpiresAt(),
            priorTarget.headers());
      }
      if (previous.getStatus() == UploadStatus.RECEIVED
          || previous.getStatus() == UploadStatus.RUNNING
          || (previous.getStatus() == UploadStatus.URL_ISSUED
              && previous.getUrlExpiresAt().isAfter(now))) {
        throw new UploadInProgressException(previous.getId());
      }
    }
    requireNotLoaded(request.businessDate());
    Instant expiresAt = now.plus(urlTtl);
    Upload job =
        uploadRepository.save(
            Upload.urlIssued(
                fileName,
                hash,
                request.sizeBytes(),
                request.businessDate(),
                null,
                businessTime.now(),
                expiresAt));
    job.setS3Key("uploads/ledger/" + job.getId() + "/" + fileName);
    uploadRepository.save(job);
    UploadTarget target = uploadStore.issue(job.getS3Key(), expiresAt, request.checksumSha256());
    log.info("업로드 URL 발급 uploadId={} file={}", job.getId(), fileName);
    return new IssueUploadResponse(
        job.getId(), target.url(), target.method(), expiresAt, target.headers());
  }

  public UploadStatusResponse complete(long uploadId) {
    Upload job = findIngest(uploadId);
    if (job.getStatus() != UploadStatus.URL_ISSUED) {
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
              receiptLock();
              // S3 확인 중 재발급/다른 완료가 가능하므로 잠금 후 새 영속 컨텍스트에서 다시 읽는다.
              Upload current = findIngest(uploadId);
              if (current.getStatus() != UploadStatus.URL_ISSUED) {
                return new Completion(toResponse(current), false);
              }
              requireLatestUrl(current);
              requireNotLoaded(current.getBusinessDate());
              // Compared with the business-time analysis cutoff (receipts).
              Instant receivedAt = businessTime.now();
              if (uploadRepository.markReceived(uploadId, receivedAt) != 1) {
                throw ApiException.invalidTransition("완료 통지 전이 실패");
              }
              current.setStatus(UploadStatus.RECEIVED);
              current.setReceivedAt(receivedAt);
              return new Completion(toResponse(current), true);
            });
    // 수신 전이가 커밋된 뒤에만 비동기 적재를 호출한다.
    if (completion.received()) ledgerLoader.load(uploadId);
    return completion.response();
  }

  private void requireLatestUrl(Upload job) {
    boolean superseded =
        uploadRepository.findByFileHashOrderByIdDesc(job.getFileHash()).stream()
            .anyMatch(newer -> newer.getId() > job.getId());
    if (superseded) {
      throw new ApiException(
          HttpStatus.CONFLICT, "UPLOAD_SUPERSEDED", "새 업로드가 발급되었습니다. 최신 업로드 번호를 사용하세요.");
    }
  }

  private java.time.LocalDate nextDate(Instant received) {
    if (received == null) return null;
    var local = received.atZone(java.time.ZoneId.of(zone));
    return local.toLocalTime().isAfter(cutoff)
        ? local.toLocalDate().plusDays(1)
        : local.toLocalDate();
  }

  public UploadStatusResponse status(long uploadId) {
    return toResponse(findIngest(uploadId));
  }

  private Upload findIngest(long uploadId) {
    return uploadRepository
        .findById(uploadId)
        .orElseThrow(() -> ApiException.notFound("업로드 없음: " + uploadId));
  }

  private UploadStatusResponse toResponse(Upload job) {
    List<ValidationError> errors =
        job.getValidationErrors() == null
            ? List.of()
            : objectMapper.readValue(job.getValidationErrors(), new TypeReference<>() {});
    return new UploadStatusResponse(
        job.getId(),
        job.getFileName(),
        job.getBusinessDate(),
        job.getSizeBytes(),
        job.getRowCount(),
        jdbc.queryForObject(
            "select count(*) from ledger.transactions where upload_id=?",
            Integer.class,
            job.getId()),
        job.getMissingCount(),
        job.getDuplicateCount(),
        job.getStatus(),
        job.getErrorCode(),
        job.getErrorMessage(),
        errors,
        job.getUrlIssuedAt(),
        job.getReceivedAt(),
        job.getStartedAt(),
        job.getFinishedAt(),
        nextDate(job.getReceivedAt()));
  }
}
