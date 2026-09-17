package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
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
  private final org.springframework.jdbc.core.JdbcTemplate jdbc;
  private final UploadStore uploadStore;
  private final LedgerLoader ledgerLoader;
  private final ObjectMapper objectMapper;
  private final TransactionTemplate completionTx;

  private record Completion(UploadStatusResponse response, boolean received) {}

  private final java.time.Clock clock;
  private final Duration urlTtl;
  private final long maxSizeBytes;
  @Value("${app.zone}") private String zone="Asia/Seoul";
  @Value("${app.ingest.cutoff}") private java.time.LocalTime cutoff=java.time.LocalTime.of(3,0);

  public UploadService(
      BatchJobRepository batchJobRepository,
      BankRepository banks,
      org.springframework.jdbc.core.JdbcTemplate jdbc,
      UploadStore uploadStore,
      LedgerLoader ledgerLoader,
      ObjectMapper objectMapper,
      PlatformTransactionManager transactionManager,
      java.time.Clock clock,
      @Value("${app.ingest.url-ttl}") Duration urlTtl,
      @Value("${app.ingest.max-size-bytes}") long maxSizeBytes) {
    this.clock = clock;
    this.batchJobRepository = batchJobRepository;
    this.banks = banks;
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
    requireReporting(bankId, request.businessDate());
    banks.lockById(bankId).orElseThrow(() -> ApiException.notFound("은행 없음"));
    Instant now = clock.instant();
    if ((request.correctionRequestId()==null)!=(request.correctionSubmissionId()==null)) throw com.moneylaundry.api.analysis.AnalysisService.invalid();
    if(request.correctionRequestId()!=null) {
      var corrections=jdbc.queryForList("select * from correction_requests where correction_id=? and bank_id=? for update",request.correctionRequestId(),bankId);
      if(corrections.isEmpty())throw ApiException.notFound("정정 요청 없음");
      var correction=corrections.getFirst();
      if(!request.businessDate().equals(((java.sql.Date)correction.get("business_date")).toLocalDate()))throw com.moneylaundry.api.analysis.AnalysisService.invalid();
      var prior=jdbc.queryForList("select upload_id from correction_uploads where correction_id=? and submission_id=?",Long.class,request.correctionRequestId(),request.correctionSubmissionId());
      if(!prior.isEmpty()) {
        BatchJob previous=findIngest(prior.getFirst(),bankId);
        if(!previous.getFileHash().equals(hash)||!previous.getSizeBytes().equals(request.sizeBytes())||!previous.getFileName().equals(fileName))throw new ApiException(HttpStatus.CONFLICT,"CORRECTION_SUBMISSION_MISMATCH","같은 제출 식별자의 파일이 다릅니다.");
        if(previous.getStatus()!=JobStatus.URL_ISSUED)return new IssueUploadResponse(previous.getId(),bankId,null,null,null,java.util.Map.of(),false);
        if(!previous.getUrlExpiresAt().isAfter(now))throw new ApiException(HttpStatus.CONFLICT,"UPLOAD_URL_EXPIRED","URL이 만료되었습니다. 새 제출 식별자로 제출하세요.");
        UploadTarget priorTarget=uploadStore.issue(previous.getS3Key(),previous.getUrlExpiresAt(),request.checksumSha256());
        return new IssueUploadResponse(previous.getId(),bankId,priorTarget.url(),priorTarget.method(),previous.getUrlExpiresAt(),priorTarget.headers());
      }
      if("RESOLVED".equals(correction.get("status")))throw new ApiException(HttpStatus.CONFLICT,"CORRECTION_RESOLVED","이미 해결된 정정 요청입니다.");
    }
    for (BatchJob previous :
        batchJobRepository.findByJobTypeAndBankIdAndFileHashOrderByIdDesc(
            JobType.INGEST, bankId, hash)) {
      if(request.correctionRequestId()!=null) continue;
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
    if(request.correctionRequestId()!=null) jdbc.update("insert into correction_uploads(upload_id,correction_id,submission_id) values(?,?,?)",job.getId(),request.correctionRequestId(),request.correctionSubmissionId());
    job.setS3Key("uploads/" + bankId + "/" + job.getId() + "/" + fileName);
    batchJobRepository.save(job);
    UploadTarget target = uploadStore.issue(job.getS3Key(), expiresAt, request.checksumSha256());
    log.info("업로드 URL 발급 uploadId={} bankId={} file={}", job.getId(), bankId, fileName);
    return new IssueUploadResponse(
        job.getId(), bankId, target.url(), target.method(), expiresAt, target.headers());
  }

  public UploadStatusResponse complete(int bankId, long uploadId) {
    BatchJob job = findIngest(uploadId, bankId);
    requireReporting(bankId, job.getBusinessDate());
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
              requireReporting(bankId, current.getBusinessDate());
              if (current.getStatus() != JobStatus.URL_ISSUED) {
                return new Completion(toResponse(current), false);
              }
              requireLatestUrl(current);
              jdbc.query(
                  "select pg_advisory_xact_lock(?)",
                  ps -> ps.setLong(1, com.moneylaundry.api.analysis.AnalysisService.RECEIPT_LOCK),
                  rs -> {});
              Instant receivedAt = clock.instant();
              if (batchJobRepository.markReceived(uploadId, bankId, receivedAt) != 1) {
                throw ApiException.invalidTransition("완료 통지 전이 실패");
              }
              jdbc.update("update correction_requests c set status='REPLACEMENT_RECEIVED',revision=revision+1 from correction_uploads u where u.correction_id=c.correction_id and u.upload_id=?",uploadId);
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
            .anyMatch(newer -> newer.getId() > job.getId() && sameUploadContext(newer.getId(),job.getId()));
    if (superseded) {
      throw new ApiException(
          HttpStatus.CONFLICT, "UPLOAD_SUPERSEDED", "새 업로드가 발급되었습니다. 최신 업로드 번호를 사용하세요.");
    }
  }

  private java.time.LocalDate nextDate(Instant received) {
    if(received==null)return null;
    var local=received.atZone(java.time.ZoneId.of(zone));
    return local.toLocalTime().isAfter(cutoff)?local.toLocalDate().plusDays(1):local.toLocalDate();
  }
  private boolean sameUploadContext(long first,long second) {
    var a=jdbc.queryForList("select correction_id from correction_uploads where upload_id=?",Long.class,first);
    var b=jdbc.queryForList("select correction_id from correction_uploads where upload_id=?",Long.class,second);
    return a.isEmpty() && b.isEmpty();
  }

  public UploadStatusResponse status(int bankId, long uploadId) {
    BatchJob job = findIngest(uploadId, bankId);
    requireReporting(bankId, job.getBusinessDate());
    return toResponse(job);
  }

  private void requireReporting(int bankId, java.time.LocalDate date) {
    Boolean allowed =
        jdbc.queryForObject(
            "select exists(select 1 from banks b join bank_reporting_periods p using(bank_id) where"
                + " bank_id=? and b.is_reporting and p.effective_from_date<=? and"
                + " (p.effective_to_date is null or p.effective_to_date>=?))",
            Boolean.class,
            bankId,
            date,
            date);
    if (!Boolean.TRUE.equals(allowed))
      throw new ApiException(
          HttpStatus.FORBIDDEN, "REPORTING_NOT_REGISTERED", "사전 등록된 보고 은행/기준일만 수집합니다.");
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
    if (errors.isEmpty())
      errors =
          jdbc.query(
              "select r.source_row,r.error_code from private.bank_reports r join report_versions v"
                  + " using(version_id) where v.upload_id=? and r.error_code is not null order by"
                  + " r.source_row limit 100",
              (rs, n) -> new ValidationError(rs.getInt(1), "", rs.getString(2)),
              job.getId());
    var versions=jdbc.queryForList("select version_id from report_versions where upload_id=?",Long.class,job.getId());
    var corrections=jdbc.queryForList("select c.correction_id,rv.upload_id from correction_requests c left join report_versions rv on rv.version_id=c.replacement_version_id where (c.version_id in (select version_id from report_versions where upload_id=?) or c.correction_id in (select correction_id from correction_uploads where upload_id=?)) and c.status<>'RESOLVED' order by c.correction_id desc",job.getId(),job.getId());
    return new UploadStatusResponse(
        job.getId(),
        job.getBankId(),
        job.getFileName(),
        job.getBusinessDate(),
        job.getSizeBytes(),
        job.getRowCount(),
        jdbc.queryForObject(
            "select count(*) from transaction_reports tr join private.bank_reports r"
                + " using(report_id) join report_versions v using(version_id) where v.upload_id=?",
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
        jdbc
            .query(
                "select stage_status from report_versions where upload_id=?",
                (rs, n) -> rs.getString(1),
                job.getId())
            .stream()
            .findFirst()
            .orElse(null),versions.isEmpty()?null:versions.getFirst(),!corrections.isEmpty(),corrections.isEmpty()?null:(Long)corrections.getFirst().get("correction_id"),corrections.isEmpty()?null:(Long)corrections.getFirst().get("upload_id"),nextDate(job.getReceivedAt()));
  }
}
