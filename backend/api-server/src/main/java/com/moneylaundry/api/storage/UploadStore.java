package com.moneylaundry.api.storage;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.OptionalLong;

/**
 * 은행 업로드 파일 저장소 경계(API.md §1.1). 업로드 대상 발급·크기/체크섬 확인·읽기와 시연 파일 정리만 노출한다. 구현은 로컬
 * 폴더(LocalFolderUploadStore)와 S3(S3UploadStore)다.
 */
public interface UploadStore {

  /** 은행이 파일을 올릴 대상을 발급한다. 로컬 구현은 file:// URL, S3 구현은 Presigned PUT URL. */
  UploadTarget issue(String key, Instant expiresAt, String checksumSha256);

  String checksumOf(String key);

  /** 객체가 있으면 크기, 없으면 empty. */
  OptionalLong sizeOf(String key);

  InputStream open(String key) throws IOException;

  /** Stable identity checked again before retrying recorded demo cleanup. */
  default String resetScope() {
    throw new UnsupportedOperationException("Demo cleanup unavailable");
  }

  /** Delete an exact key or one bounded page of a recorded request prefix. */
  default boolean removeDemoFiles(String key, boolean prefix) {
    throw new UnsupportedOperationException("Demo cleanup unavailable");
  }
}
