package com.moneylaundry.api.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.batchjob.BatchJob;
import com.moneylaundry.api.batchjob.BatchJobRepository;
import com.moneylaundry.api.batchjob.JobStatus;
import com.moneylaundry.api.ingest.LedgerLoader;
import com.moneylaundry.api.storage.UploadStore;
import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class UploadCompletionConcurrencyTests {
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;

  @org.junit.jupiter.api.BeforeEach
  void reportingBank() {
    jdbc.update(
        "insert into banks(bank_id, is_reporting) values (70, true) on conflict do nothing");
  }

  @Autowired UploadService service;
  @Autowired BatchJobRepository repository;
  @MockitoBean UploadStore store;
  @MockitoBean LedgerLoader loader;

  @Test
  void 동시_완료_통지는_한_번만_접수하고_적재한다() throws Exception {
    Instant now = Instant.now();
    BatchJob job =
        repository.save(
            BatchJob.ingestUrlIssued(
                70,
                "concurrent.csv",
                "c".repeat(64),
                1,
                null,
                "uploads/70/concurrent.csv",
                now,
                now.plusSeconds(60)));
    when(store.checksumOf(job.getS3Key()))
        .thenReturn(
            java.util.Base64.getEncoder()
                .encodeToString(java.util.HexFormat.of().parseHex(job.getFileHash())));
    CyclicBarrier bothCheckedStatus = new CyclicBarrier(2);
    when(store.sizeOf(job.getS3Key()))
        .thenAnswer(
            invocation -> {
              bothCheckedStatus.await(10, TimeUnit.SECONDS);
              return OptionalLong.of(1);
            });

    try (var executor = Executors.newFixedThreadPool(2)) {
      var first = executor.submit(() -> complete(job.getId()));
      var second = executor.submit(() -> complete(job.getId()));
      assertThat(List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder("RECEIVED", "RECEIVED");
    }
    verify(loader, times(1)).load(job.getId());
    BatchJob received = repository.findById(job.getId()).orElseThrow();
    assertThat(received.getStatus()).isEqualTo(JobStatus.RECEIVED);
    assertThat(received.getReceivedAt()).isNotNull();
    assertThat(received.getAttemptCount()).isZero();
  }

  @Test
  void 객체확인_사이_재발급이_끝나면_이전완료는_거절한다() throws Exception {
    Instant now = Instant.now();
    String hash = "d".repeat(64);
    String checksum =
        java.util.Base64.getEncoder().encodeToString(java.util.HexFormat.of().parseHex(hash));
    BatchJob old =
        repository.save(
            BatchJob.ingestUrlIssued(
                70,
                "race-old.csv",
                hash,
                1,
                java.time.LocalDate.of(2022, 9, 1),
                "uploads/race-old",
                now.minusSeconds(100),
                now.minusSeconds(1)));
    var checking = new java.util.concurrent.CountDownLatch(1);
    var release = new java.util.concurrent.CountDownLatch(1);
    when(store.sizeOf(old.getS3Key()))
        .thenAnswer(
            invocation -> {
              checking.countDown();
              assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
              return OptionalLong.of(1);
            });
    when(store.checksumOf(old.getS3Key())).thenReturn(checksum);
    when(store.issue(
            org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.eq(checksum)))
        .thenReturn(
            new com.moneylaundry.api.storage.UploadTarget(
                "https://example.com/object", "PUT", java.util.Map.of()));
    try (var executor = Executors.newSingleThreadExecutor()) {
      var completing = executor.submit(() -> complete(old.getId()));
      assertThat(checking.await(10, TimeUnit.SECONDS)).isTrue();
      IssueUploadResponse issued;
      try {
        issued =
            service.issue(
                70,
                new IssueUploadRequest(
                    "race-new.csv", 1, checksum, java.time.LocalDate.of(2022, 9, 1)));
      } finally {
        release.countDown();
      }
      assertThat(completing.get(20, TimeUnit.SECONDS)).isEqualTo("UPLOAD_SUPERSEDED");
      verify(loader, org.mockito.Mockito.never()).load(old.getId());
      assertThat(repository.findById(issued.uploadId()).orElseThrow().getStatus())
          .isEqualTo(JobStatus.URL_ISSUED);
    }
  }

  @Test
  void 기존완료가_선행하면_동일파일_재발급은_진행중이다() {
    Instant now = Instant.now();
    String hash = "e".repeat(64);
    String checksum =
        java.util.Base64.getEncoder().encodeToString(java.util.HexFormat.of().parseHex(hash));
    BatchJob old =
        repository.save(
            BatchJob.ingestUrlIssued(
                70,
                "receive-first.csv",
                hash,
                1,
                java.time.LocalDate.of(2022, 9, 1),
                "uploads/receive-first",
                now.minusSeconds(100),
                now.minusSeconds(1)));
    when(store.sizeOf(old.getS3Key())).thenReturn(OptionalLong.of(1));
    when(store.checksumOf(old.getS3Key())).thenReturn(checksum);
    assertThat(complete(old.getId())).isEqualTo("RECEIVED");
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () ->
                service.issue(
                    70,
                    new IssueUploadRequest(
                        "too-late.csv", 1, checksum, java.time.LocalDate.of(2022, 9, 1))))
        .isInstanceOfSatisfying(
            ApiException.class, e -> assertThat(e.code()).isEqualTo("UPLOAD_IN_PROGRESS"));
    verify(loader, times(1)).load(old.getId());
  }

  private String complete(long uploadId) {
    try {
      return service.complete(70, uploadId).status().name();
    } catch (ApiException e) {
      assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT);
      return e.code();
    }
  }
}
