package com.moneylaundry.api.ingest.upload;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.time.LocalDate;

/** POST /api/v1/ledger-uploads 요청(API.md §1.1). 거래 기준일 하나의 원장 파일. */
public record IssueUploadRequest(
    @NotBlank String fileName,
    @Positive long sizeBytes,
    @NotBlank @Pattern(regexp = "^[A-Za-z0-9+/]{43}=$") String checksumSha256,
    @NotNull LocalDate businessDate) {}
