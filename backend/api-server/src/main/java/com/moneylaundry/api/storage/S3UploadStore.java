package com.moneylaundry.api.storage;

import java.io.InputStream;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.OptionalLong;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.ChecksumMode;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;

public class S3UploadStore implements UploadStore {
  private final S3Client client;
  private final S3Presigner presigner;
  private final String bucket;
  private final String prefix;

  public S3UploadStore(S3Client client, S3Presigner presigner, String bucket, String prefix) {
    this.client = client;
    this.presigner = presigner;
    this.bucket = bucket;
    this.prefix = prefix.isEmpty() || prefix.endsWith("/") ? prefix : prefix + "/";
  }

  @Override
  public UploadTarget issue(String key, Instant expiresAt, String checksumSha256) {
    PutObjectRequest put =
        PutObjectRequest.builder()
            .bucket(bucket)
            .key(prefix + key)
            .contentType("text/csv")
            .checksumSHA256(checksumSha256)
            .build();
    PresignedPutObjectRequest signed =
        presigner.presignPutObject(
            b ->
                b.signatureDuration(Duration.between(Instant.now(), expiresAt))
                    .putObjectRequest(put));
    Map<String, String> headers = new HashMap<>();
    signed
        .signedHeaders()
        .forEach(
            (name, values) -> {
              if (!name.equalsIgnoreCase("host")) headers.put(name, String.join(",", values));
            });
    return new UploadTarget(signed.url().toString(), "PUT", headers);
  }

  private HeadObjectResponse head(String key) {
    return client.headObject(
        b -> b.bucket(bucket).key(prefix + key).checksumMode(ChecksumMode.ENABLED));
  }

  @Override
  public OptionalLong sizeOf(String key) {
    try {
      return OptionalLong.of(head(key).contentLength());
    } catch (S3Exception e) {
      if (e.statusCode() == 404) return OptionalLong.empty();
      throw e;
    }
  }

  @Override
  public String checksumOf(String key) {
    return head(key).checksumSHA256();
  }

  @Override
  public InputStream open(String key) {
    return client.getObject(b -> b.bucket(bucket).key(prefix + key));
  }
}
