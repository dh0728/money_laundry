package com.moneylaundry.api.upload;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/** ingest.uploads 저장소: 해시 중복 조회, 수신 전이(URL_ISSUED→RECEIVED), 도착 현황용 최신 업로드 조회. */
public interface UploadRepository extends JpaRepository<Upload, Long> {
  List<Upload> findByBankIdAndFileHashOrderByIdDesc(int bankId, String fileHash);

  @Modifying
  @Transactional
  @Query(
      value =
          "update ingest.uploads set status='RECEIVED',received_at=:receivedAt where upload_id=:uploadId and bank_id=:bankId and status='URL_ISSUED'",
      nativeQuery = true)
  int markReceived(long uploadId, int bankId, Instant receivedAt);

  @Query(
      value =
          "select * from ingest.uploads where bank_id=:bankId and coalesce(received_at,created_at)>:windowStartExclusive and coalesce(received_at,created_at)<=:windowEndInclusive order by coalesce(received_at,created_at) desc limit 1",
      nativeQuery = true)
  Optional<Upload> latestArrival(
      int bankId, Instant windowStartExclusive, Instant windowEndInclusive);
}
