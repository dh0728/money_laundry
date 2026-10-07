package com.moneylaundry.api.upload;

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

  @Test
  void upload_receipt_is_persisted_without_an_analysis_job() {
    long jobsBefore = jdbc.queryForObject("select count(*) from analysis.jobs", Long.class);
    jdbc.update("insert into core.banks(bank_id) values(901)");
    Instant now = Instant.parse("2023-09-02T00:00:00Z");
    var upload =
        uploads.saveAndFlush(
            Upload.urlIssued(
                901,
                "report.csv",
                "a".repeat(64),
                100,
                LocalDate.parse("2023-09-01"),
                "test/report.csv",
                now,
                now.plusSeconds(900)));
    assertThat(uploads.markReceived(upload.getId(), 901, now.plusSeconds(10))).isEqualTo(1);
    assertThat(uploads.markReceived(upload.getId(), 901, now.plusSeconds(20))).isZero();
    var stored = uploads.findById(upload.getId()).orElseThrow();
    assertThat(stored.getStatus()).isEqualTo(UploadStatus.RECEIVED);
    assertThat(stored.getReceivedAt()).isEqualTo(now.plusSeconds(10));
    assertThat(uploads.findByBankIdAndFileHashOrderByIdDesc(901, "a".repeat(64))).hasSize(1);
    assertThat(uploads.latestArrival(901, now, now.plusSeconds(60))).isPresent();
    assertThat(jdbc.queryForObject("select count(*) from analysis.jobs", Long.class))
        .isEqualTo(jobsBefore);
  }

  @org.junit.jupiter.api.AfterEach
  void cleanup() {
    jdbc.update("delete from ingest.uploads where bank_id=901");
    jdbc.update("delete from core.banks where bank_id=901");
  }
}
