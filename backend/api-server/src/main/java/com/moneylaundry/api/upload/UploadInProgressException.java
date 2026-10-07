package com.moneylaundry.api.upload;

import com.moneylaundry.api.ApiException;
import org.springframework.http.HttpStatus;

public class UploadInProgressException extends ApiException {
  private final long uploadId;

  public UploadInProgressException(long uploadId) {
    super(HttpStatus.CONFLICT, "UPLOAD_IN_PROGRESS", "같은 파일의 업로드가 진행 중입니다.");
    this.uploadId = uploadId;
  }

  public long uploadId() {
    return uploadId;
  }
}
