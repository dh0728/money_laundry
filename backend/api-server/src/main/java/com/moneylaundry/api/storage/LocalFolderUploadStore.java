package com.moneylaundry.api.storage;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.OptionalLong;

/**
 * local/default 환경의 백엔드 테스트용 폴더 저장소. url은 file:// 경로이며 현재 은행 목업은 파일 복사를 지원하지 않는다. 로컬 폴더에는 서명이 없으므로
 * 만료 시각을 저장하지 않는다.
 */
public class LocalFolderUploadStore implements UploadStore {

  private final Path root;

  public LocalFolderUploadStore(String storageDir) {
    this.root = Path.of(storageDir).toAbsolutePath();
  }

  @Override
  public UploadTarget issue(String key, Instant expiresAt, String checksumSha256) {
    Path target = resolve(key);
    try {
      Files.createDirectories(target.getParent());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
    return new UploadTarget(target.toUri().toString(), "PUT", Map.of("Content-Type", "text/csv"));
  }

  @Override
  public OptionalLong sizeOf(String key) {
    Path target = resolve(key);
    if (!Files.isRegularFile(target)) {
      return OptionalLong.empty();
    }
    try {
      return OptionalLong.of(Files.size(target));
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Override
  public String checksumOf(String key) {
    try (InputStream stream = open(key)) {
      java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
      try (var checked = new java.security.DigestInputStream(stream, digest)) {
        checked.transferTo(java.io.OutputStream.nullOutputStream());
      }
      return java.util.Base64.getEncoder().encodeToString(digest.digest());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  @Override
  public InputStream open(String key) throws IOException {
    return Files.newInputStream(resolve(key));
  }

  private Path resolve(String key) {
    return root.resolve(key).normalize();
  }

  @Override
  public String resetScope() {
    return "local:" + root.normalize();
  }

  @Override
  public boolean removeDemoFiles(String key, boolean directory) {
    DemoObjectKey.check(key, directory);
    Path target = resolve(key);
    try {
      Path realRoot = root.toRealPath();
      if (!Files.exists(target)) return true;
      if (!target.toRealPath().startsWith(realRoot)) throw new IOException("Invalid cleanup path");
      if (!directory) {
        Files.deleteIfExists(target);
        return true;
      }
      try (var paths = Files.walk(target)) {
        for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
          if (!path.toRealPath().startsWith(realRoot))
            throw new IOException("Invalid cleanup path");
          Files.deleteIfExists(path);
        }
      }
      return true;
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }
}
