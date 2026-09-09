package com.moneylaundry.api.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.Instant;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class S3UploadStoreTests {
  @Test
  void 오프라인_서명은_환경접두어와_체크섬을_포함하고_Host는_반환하지_않는다() {
    try (S3Presigner presigner =
        S3Presigner.builder()
            .region(Region.AP_NORTHEAST_2)
            .credentialsProvider(
                StaticCredentialsProvider.create(
                    AwsBasicCredentials.create("test-access", "test-secret")))
            .build()) {
      String checksum = Base64.getEncoder().encodeToString(new byte[32]);
      S3UploadStore store =
          new S3UploadStore(mock(S3Client.class), presigner, "example-test-bucket", "dev/");
      UploadTarget target =
          store.issue("uploads/70/1/test.csv", Instant.now().plusSeconds(900), checksum);
      assertThat(target.url()).contains("/dev/uploads/70/1/test.csv").contains("X-Amz-Signature=");
      assertThat(target.headers())
          .containsEntry("x-amz-checksum-sha256", checksum)
          .containsEntry("content-type", "text/csv");
      assertThat(target.headers().keySet()).noneMatch(k -> k.equalsIgnoreCase("host"));
    }
  }

  @Test
  void HEAD는_체크섬모드를_요청하고_403을_없음으로_바꾸지_않는다() {
    S3Client client = mock(S3Client.class);
    when(client.headObject(any(java.util.function.Consumer.class)))
        .thenAnswer(
            invocation -> {
              var builder = HeadObjectRequest.builder();
              ((java.util.function.Consumer<HeadObjectRequest.Builder>) invocation.getArgument(0))
                  .accept(builder);
              var request = builder.build();
              assertThat(request.checksumMode()).isEqualTo(ChecksumMode.ENABLED);
              assertThat(request.key()).isEqualTo("prod/uploads/file.csv");
              throw S3Exception.builder().statusCode(403).build();
            });
    S3UploadStore store = new S3UploadStore(client, mock(S3Presigner.class), "bucket", "prod/");
    assertThatThrownBy(() -> store.sizeOf("uploads/file.csv")).isInstanceOf(S3Exception.class);
  }

  @Test
  void HEAD_404만_파일없음이다() {
    S3Client client = mock(S3Client.class);
    when(client.headObject(any(java.util.function.Consumer.class)))
        .thenThrow(S3Exception.builder().statusCode(404).build());
    assertThat(
            new S3UploadStore(client, mock(S3Presigner.class), "bucket", "dev/").sizeOf("missing"))
        .isEmpty();
  }
}
