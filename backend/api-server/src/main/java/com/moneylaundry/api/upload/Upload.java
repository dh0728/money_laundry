package com.moneylaundry.api.upload;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One received file. Analysis execution state belongs to analysis.jobs. */
@Entity
@Table(name = "uploads", schema = "ingest")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Upload {

  @Id
  @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "workId")
  @SequenceGenerator(name = "workId", sequenceName = "core.work_id", allocationSize = 1)
  @Column(name = "upload_id")
  private Long id;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private UploadStatus status;

  @Column(name = "attempt_count", nullable = false)
  private int attemptCount;

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

  public static Upload urlIssued(
      int bankId,
      String fileName,
      String fileHash,
      long sizeBytes,
      LocalDate businessDate,
      String s3Key,
      Instant issuedAt,
      Instant expiresAt) {
    Upload job = new Upload();
    job.status = UploadStatus.URL_ISSUED;
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
