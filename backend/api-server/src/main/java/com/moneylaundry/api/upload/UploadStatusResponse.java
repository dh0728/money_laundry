package com.moneylaundry.api.upload;

import com.moneylaundry.api.batchjob.JobStatus;
import com.moneylaundry.api.ingest.ValidationError;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** GET /api/uploads/{uploadId} 응답(API.md §1.2). 완료 통지 202 응답도 이 모양의 앞부분만 쓴다. */
public record UploadStatusResponse(
    long uploadId,
    int bankId,
    String fileName,
    LocalDate businessDate,
    Long sizeBytes,
    Integer rowCount,
    Integer insertedCount,
    Integer missingCount,
    Integer duplicateCount,
    JobStatus status,
    String errorCode,
    String errorMessage,
    List<ValidationError> errors,
    Instant urlIssuedAt,
    Instant receivedAt,
    Instant startedAt,
    Instant finishedAt) {}
