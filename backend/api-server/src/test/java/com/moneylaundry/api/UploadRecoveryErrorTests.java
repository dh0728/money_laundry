package com.moneylaundry.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.moneylaundry.api.upload.DuplicateFileException;
import com.moneylaundry.api.upload.UploadInProgressException;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class UploadRecoveryErrorTests {
  @Test
  void duplicate_preserves_contract_and_provides_existing_upload_id() {
    var at = Instant.parse("2023-09-04T00:00:00Z");
    var result = new ApiExceptionHandler().api(new DuplicateFileException(670, "bank.csv", at));
    assertThat(result.getStatus()).isEqualTo(409);
    assertThat(result.getProperties())
        .containsEntry("code", "DUPLICATE_FILE")
        .containsEntry("uploadId", 670L)
        .containsEntry("fileName", "bank.csv")
        .containsEntry("uploadedAt", at);
  }

  @Test
  void in_progress_provides_existing_upload_id_without_signed_url() {
    var result = new ApiExceptionHandler().api(new UploadInProgressException(670));
    assertThat(result.getStatus()).isEqualTo(409);
    assertThat(result.getProperties())
        .containsEntry("code", "UPLOAD_IN_PROGRESS")
        .containsEntry("uploadId", 670L)
        .doesNotContainKeys("url", "headers", "checksumSha256");
  }
}
