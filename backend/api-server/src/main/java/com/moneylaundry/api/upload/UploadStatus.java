package com.moneylaundry.api.upload;

/** 업로드 처리 상태(API.md §1.2). EXPIRED는 계약·스키마에만 있고 현재 전이하는 코드는 없다. */
public enum UploadStatus {
  URL_ISSUED,
  RECEIVED,
  RUNNING,
  COMPLETED,
  VALIDATION_FAILED,
  FAILED,
  EXPIRED
}
