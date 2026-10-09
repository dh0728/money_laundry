package com.moneylaundry.api.upload;

import java.time.Instant;
import java.util.Map;

/** POST /api/v1/bank/uploads 응답(API.md §1.1). uploadRequired=false면 같은 제출이 이미 접수돼 다시 올리지 않는다. */
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
