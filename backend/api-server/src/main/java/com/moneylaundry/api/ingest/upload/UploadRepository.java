package com.moneylaundry.api.ingest.upload;

import java.time.Instant;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/** ingest.uploads 저장소: 해시 중복 조회와 수신 전이(URL_ISSUED→RECEIVED). */
public interface UploadRepository extends JpaRepository<Upload, Long> {
  List<Upload> findByFileHashOrderByIdDesc(String fileHash);

  @Modifying
  @Transactional
  @Query(
      value =
          "update ingest.uploads set status='RECEIVED',received_at=:receivedAt where upload_id=:uploadId and status='URL_ISSUED'",
      nativeQuery = true)
  int markReceived(long uploadId, Instant receivedAt);
}
