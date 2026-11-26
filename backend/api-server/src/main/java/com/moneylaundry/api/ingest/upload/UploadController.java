package com.moneylaundry.api.ingest.upload;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 원장 파일 수집 API(API.md §1.1·§1.2): URL 발급·완료 통지·처리현황 조회. 발급·완료는 관리자만. */
@RestController
public class UploadController {

  private final UploadService uploadService;

  public UploadController(UploadService uploadService) {
    this.uploadService = uploadService;
  }

  @PostMapping("/api/v1/ledger-uploads")
  @ResponseStatus(HttpStatus.CREATED)
  public IssueUploadResponse issue(@Valid @RequestBody IssueUploadRequest request) {
    return uploadService.issue(request);
  }

  @PostMapping("/api/v1/ledger-uploads/{uploadId}/complete")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public UploadStatusResponse complete(@PathVariable long uploadId) {
    return uploadService.complete(uploadId);
  }

  @GetMapping("/api/v1/ledger-uploads/{uploadId}")
  public UploadStatusResponse status(@PathVariable long uploadId) {
    return uploadService.status(uploadId);
  }
}
