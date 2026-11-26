package com.moneylaundry.api.ingest.upload;

import java.time.Instant;
import java.util.Map;

/** POST /api/v1/ledger-uploads 응답(API.md §1.1). */
public record IssueUploadResponse(
    long uploadId, String url, String method, Instant expiresAt, Map<String, String> headers) {}
