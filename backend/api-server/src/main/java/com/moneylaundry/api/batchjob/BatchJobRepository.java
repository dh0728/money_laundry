package com.moneylaundry.api.batchjob;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BatchJobRepository extends JpaRepository<BatchJob, Long> {

  boolean existsByJobTypeAndFileHashAndStatus(JobType jobType, String fileHash, JobStatus status);

  Optional<BatchJob>
      findFirstByJobTypeAndBankIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtDesc(
          JobType jobType, int bankId, Instant windowStartExclusive, Instant windowEndInclusive);
}
