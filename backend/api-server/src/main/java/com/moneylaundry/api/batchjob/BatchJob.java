package com.moneylaundry.api.batchjob;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** batch_jobs 한 행(V1). INGEST 전용·ANALYSIS 전용 컬럼은 상대 타입에서 null. */
@Entity
@Table(name = "batch_jobs")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BatchJob {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  @Column(name = "job_id")
  private Long id;

  @Enumerated(EnumType.STRING)
  @Column(name = "job_type", nullable = false)
  private JobType jobType;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private JobStatus status;

  @Column(name = "attempt_count", nullable = false)
  private int attemptCount;

  @Column(name = "claimed_at")
  private Instant claimedAt;

  @Column(name = "heartbeat_at")
  private Instant heartbeatAt;

  @Column(name = "started_at")
  private Instant startedAt;

  @Column(name = "finished_at")
  private Instant finishedAt;

  @Column(name = "error_code")
  private String errorCode;

  @Column(name = "error_message")
  private String errorMessage;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  // INGEST 전용
  @Column(name = "bank_id")
  private Integer bankId;

  @Column(name = "business_date")
  private LocalDate businessDate;

  @Column(name = "file_name")
  private String fileName;

  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "file_hash")
  private String fileHash;

  @Column(name = "size_bytes")
  private Long sizeBytes;

  @Column(name = "s3_key")
  private String s3Key;

  @Column(name = "url_issued_at")
  private Instant urlIssuedAt;

  @Column(name = "url_expires_at")
  private Instant urlExpiresAt;

  @Column(name = "received_at")
  private Instant receivedAt;

  @Column(name = "row_count")
  private Integer rowCount;

  @Column(name = "missing_count")
  private Integer missingCount;

  @Column(name = "duplicate_count")
  private Integer duplicateCount;

  /** API.md §1.2 errors[] 를 JSON 문자열로 보관. */
  @JdbcTypeCode(SqlTypes.JSON)
  @Column(name = "validation_errors")
  private String validationErrors;

  // ANALYSIS 전용
  @Column(name = "analysis_date")
  private LocalDate analysisDate;

  @Column(name = "threshold_value")
  private Double thresholdValue;

  @Column(name = "model_version_binary")
  private String modelVersionBinary;

  @Column(name = "model_version_type")
  private String modelVersionType;

  @Column(name = "feature_version_binary")
  private String featureVersionBinary;

  @Column(name = "feature_version_type")
  private String featureVersionType;

  @Column(name = "suspicious_tx_count")
  private Integer suspiciousTxCount;

  @Column(name = "alert_count")
  private Integer alertCount;

  public static BatchJob ingestUrlIssued(
      int bankId,
      String fileName,
      String fileHash,
      long sizeBytes,
      LocalDate businessDate,
      String s3Key,
      Instant issuedAt,
      Instant expiresAt) {
    BatchJob job = new BatchJob();
    job.jobType = JobType.INGEST;
    job.status = JobStatus.URL_ISSUED;
    job.createdAt = issuedAt;
    job.bankId = bankId;
    job.fileName = fileName;
    job.fileHash = fileHash;
    job.sizeBytes = sizeBytes;
    job.businessDate = businessDate;
    job.s3Key = s3Key;
    job.urlIssuedAt = issuedAt;
    job.urlExpiresAt = expiresAt;
    return job;
  }
}
