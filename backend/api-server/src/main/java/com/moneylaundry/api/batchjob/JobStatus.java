package com.moneylaundry.api.batchjob;

/** API.md §1.3 상태 표. INGEST와 ANALYSIS가 하나의 enum을 나눠 쓴다(테이블이 하나). */
public enum JobStatus {
  // INGEST
  URL_ISSUED,
  RECEIVED,
  VALIDATION_FAILED,
  EXPIRED,
  // ANALYSIS
  SCHEDULED,
  QUEUED,
  RETRY_WAIT,
  // 공통
  RUNNING,
  COMPLETED,
  FAILED
}
