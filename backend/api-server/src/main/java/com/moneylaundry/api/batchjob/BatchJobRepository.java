package com.moneylaundry.api.batchjob;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public interface BatchJobRepository extends JpaRepository<BatchJob, Long> {

  boolean existsByJobTypeAndFileHashAndStatus(JobType jobType, String fileHash, JobStatus status);

  @Modifying
  @Transactional
  @Query(
      value =
          """
          update batch_jobs set status = 'RECEIVED', received_at = :receivedAt
          where job_id = :uploadId and bank_id = :bankId
            and job_type = 'INGEST' and status = 'URL_ISSUED'
          """,
      nativeQuery = true)
  int markReceived(long uploadId, int bankId, Instant receivedAt);

  Optional<BatchJob>
      findFirstByJobTypeAndBankIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtDesc(
          JobType jobType, int bankId, Instant windowStartExclusive, Instant windowEndInclusive);
}
