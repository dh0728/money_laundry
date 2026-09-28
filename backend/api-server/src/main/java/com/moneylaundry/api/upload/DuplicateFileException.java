package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
import java.time.Instant;
import org.springframework.http.HttpStatus;

public class DuplicateFileException extends ApiException {
  private final String fileName;
  private final Instant uploadedAt;

  public DuplicateFileException(String fileName, Instant uploadedAt) {
    super(HttpStatus.CONFLICT, "DUPLICATE_FILE", "이미 처리된 파일입니다.");
    this.fileName = fileName;
    this.uploadedAt = uploadedAt;
  }

  public String fileName() {
    return fileName;
  }

  public Instant uploadedAt() {
    return uploadedAt;
  }
}
