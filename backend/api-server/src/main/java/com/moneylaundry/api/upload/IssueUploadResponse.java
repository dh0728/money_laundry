package com.moneylaundry.api.upload;

import java.time.Instant;
import java.util.Map;

public record IssueUploadResponse(
    long uploadId,
    int bankId,
    String url,
    String method,
    Instant expiresAt,
    Map<String, String> headers,
    boolean uploadRequired) {
  public IssueUploadResponse(
      long uploadId,
      int bankId,
      String url,
      String method,
      Instant expiresAt,
      Map<String, String> headers) {
    this(uploadId, bankId, url, method, expiresAt, headers, true);
  }
}
