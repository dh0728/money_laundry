package com.moneylaundry.api.storage;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.OptionalLong;

/**
 * 은행 업로드 파일 저장소 경계(API.md §1.1). 업무 로직이 닿는 지점은 이 셋뿐이다 — 로컬 폴더 구현으로 시작하고, S3가 준비되면 Presigned
 * PUT·HeadObject·GetObject 구현을 추가한다(kickoff §4.5 17차).
 */
public interface UploadStore {

  /** 은행이 파일을 올릴 대상을 발급한다. 로컬 구현은 file:// URL, S3 구현은 Presigned PUT URL. */
  UploadTarget issue(String key, Instant expiresAt);

  /** 객체가 있으면 크기, 없으면 empty. */
  OptionalLong sizeOf(String key);

  InputStream open(String key) throws IOException;
}
