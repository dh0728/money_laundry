package com.moneylaundry.api.batchjob;

import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public interface BatchJobRepository extends JpaRepository<BatchJob, Long> {

  java.util.List<BatchJob> findByJobTypeAndBankIdAndFileHashOrderByIdDesc(
      JobType jobType, int bankId, String fileHash);

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

  @Query(
      value =
          """
      select * from batch_jobs where job_type=:#{#jobType.name()} and bank_id=:bankId
      and coalesce(received_at,created_at)>:windowStartExclusive
      and coalesce(received_at,created_at)<=:windowEndInclusive
      order by coalesce(received_at,created_at) desc limit 1
      """,
      nativeQuery = true)
  Optional<BatchJob>
      findFirstByJobTypeAndBankIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtDesc(
          JobType jobType, int bankId, Instant windowStartExclusive, Instant windowEndInclusive);
}
