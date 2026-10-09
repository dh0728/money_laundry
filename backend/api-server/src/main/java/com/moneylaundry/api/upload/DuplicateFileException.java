package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
import java.time.Instant;
import org.springframework.http.HttpStatus;

/** 이미 처리된 파일을 다시 올릴 때의 409 DUPLICATE_FILE. 기존 업로드 정보를 함께 돌려준다. */
public class DuplicateFileException extends ApiException {
  private final long uploadId;
  private final String fileName;
  private final Instant uploadedAt;

  public DuplicateFileException(long uploadId, String fileName, Instant uploadedAt) {
    super(HttpStatus.CONFLICT, "DUPLICATE_FILE", "이미 처리된 파일입니다.");
    this.uploadId = uploadId;
    this.fileName = fileName;
    this.uploadedAt = uploadedAt;
  }

  public long uploadId() {
    return uploadId;
  }

  public String fileName() {
    return fileName;
  }

  public Instant uploadedAt() {
    return uploadedAt;
  }
}
