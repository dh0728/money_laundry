package com.moneylaundry.api.upload;

import com.moneylaundry.api.bank.BankApiKeyInterceptor;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** /api/v1/bank/** 는 은행(API 키), /api/uploads/** 는 처리현황 조회(API.md §1.1·§1.2). */
@RestController
public class UploadController {

  private final UploadService uploadService;

  public UploadController(UploadService uploadService) {
    this.uploadService = uploadService;
  }

  @PostMapping("/api/v1/bank/uploads")
  @ResponseStatus(HttpStatus.CREATED)
  public IssueUploadResponse issue(
      @RequestAttribute(BankApiKeyInterceptor.BANK_ID) int bankId,
      @Valid @RequestBody IssueUploadRequest request) {
    return uploadService.issue(bankId, request);
  }

  @PostMapping("/api/v1/bank/uploads/{uploadId}/complete")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public UploadStatusResponse complete(
      @RequestAttribute(BankApiKeyInterceptor.BANK_ID) int bankId, @PathVariable long uploadId) {
    return uploadService.complete(bankId, uploadId);
  }

  @GetMapping("/api/v1/bank/uploads/{uploadId}")
  public UploadStatusResponse bankStatus(
      @RequestAttribute(BankApiKeyInterceptor.BANK_ID) int bankId, @PathVariable long uploadId) {
    return uploadService.status(bankId, uploadId);
  }

  @GetMapping("/api/uploads/{uploadId}")
  public UploadStatusResponse status(@PathVariable long uploadId) {
    return uploadService.status(uploadId);
  }
}
