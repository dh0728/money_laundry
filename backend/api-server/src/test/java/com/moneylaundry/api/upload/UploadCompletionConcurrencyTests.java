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

@SpringBootTest(properties = "app.bank.api-keys=70:concurrent-test-key")
@Import(TestcontainersConfiguration.class)
class UploadCompletionConcurrencyTests {
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
          .containsExactlyInAnyOrder("RECEIVED", "INVALID_TRANSITION");
    }
    verify(loader, times(1)).load(job.getId());
    BatchJob received = repository.findById(job.getId()).orElseThrow();
    assertThat(received.getStatus()).isEqualTo(JobStatus.RECEIVED);
    assertThat(received.getReceivedAt()).isNotNull();
    assertThat(received.getAttemptCount()).isZero();
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
