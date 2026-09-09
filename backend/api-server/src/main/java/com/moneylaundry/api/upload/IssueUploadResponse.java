package com.moneylaundry.api.upload;

import java.time.Instant;
import java.util.Map;

public record IssueUploadResponse(
    long uploadId,
    int bankId,
    String url,
    String method,
    Instant expiresAt,
    Map<String, String> headers) {}
