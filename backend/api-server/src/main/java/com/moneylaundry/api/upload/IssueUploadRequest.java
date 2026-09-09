package com.moneylaundry.api.upload;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.time.LocalDate;

/** POST /api/v1/bank/uploads 요청(API.md §1.1). */
public record IssueUploadRequest(
    @NotBlank String fileName,
    @Positive long sizeBytes,
    @NotBlank @Pattern(regexp = "^[0-9a-f]{64}$") String sha256,
    LocalDate businessDate) {}
