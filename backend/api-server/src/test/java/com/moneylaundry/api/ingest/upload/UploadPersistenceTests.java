package com.moneylaundry.api.ingest.upload;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class UploadPersistenceTests {
  @Autowired UploadRepository uploads;
  @Autowired JdbcTemplate jdbc;
  @MockitoBean AnalysisScheduler scheduler;
  final String hash = "9".repeat(64);

  @Test
  void upload_receipt_is_persisted_without_an_analysis_job() {
    long jobsBefore = jdbc.queryForObject("select count(*) from analysis.jobs", Long.class);
    Instant now = Instant.parse("2023-09-02T00:00:00Z");
    var upload =
        uploads.saveAndFlush(
            Upload.urlIssued(
                "ledger_2023-09-01.csv",
                hash,
                100,
                LocalDate.parse("2023-09-01"),
                "test/ledger.csv",
                now,
                now.plusSeconds(900)));
    assertThat(uploads.markReceived(upload.getId(), now.plusSeconds(10))).isEqualTo(1);
    assertThat(uploads.markReceived(upload.getId(), now.plusSeconds(20))).isZero();
    var stored = uploads.findById(upload.getId()).orElseThrow();
    assertThat(stored.getStatus()).isEqualTo(UploadStatus.RECEIVED);
    assertThat(stored.getReceivedAt()).isEqualTo(now.plusSeconds(10));
    assertThat(uploads.findByFileHashOrderByIdDesc(hash)).hasSize(1);
    assertThat(jdbc.queryForObject("select count(*) from analysis.jobs", Long.class))
        .isEqualTo(jobsBefore);
  }

  @org.junit.jupiter.api.AfterEach
  void cleanup() {
    jdbc.update("delete from ingest.uploads where file_hash=?", hash);
  }
}
