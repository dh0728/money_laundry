package com.moneylaundry.api.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.file.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class DemoStorageCleanupTests {
  @Test
  void s3_exact_object_is_environment_scoped_and_has_no_version_id() {
    var client = mock(S3Client.class);
    when(client.deleteObject(any(Consumer.class)))
        .thenAnswer(
            call -> {
              var builder = DeleteObjectRequest.builder();
              ((Consumer<DeleteObjectRequest.Builder>) call.getArgument(0)).accept(builder);
              var request = builder.build();
              assertThat(request.bucket()).isEqualTo("test");
              assertThat(request.key()).isEqualTo("dev/db-v3/uploads/12/8/test.csv");
              assertThat(request.versionId()).isNull();
              return DeleteObjectResponse.builder().build();
            });
    var store = new S3UploadStore(client, mock(S3Presigner.class), "test", "dev/db-v3/");
    assertThat(store.removeDemoFiles("uploads/12/8/test.csv", false)).isTrue();
    verify(client).deleteObject(any(Consumer.class));
  }

  @Test
  void request_prefix_is_bounded_and_partial_s3_error_is_not_success() {
    var client = mock(S3Client.class);
    String prefix = "requests/8/BINARY/00000000-0000-0000-0000-000000000001/";
    when(client.listObjectsV2(any(Consumer.class)))
        .thenAnswer(
            call -> {
              var builder = ListObjectsV2Request.builder();
              ((Consumer<ListObjectsV2Request.Builder>) call.getArgument(0)).accept(builder);
              assertThat(builder.build().prefix()).isEqualTo("dev/" + prefix);
              assertThat(builder.build().maxKeys()).isEqualTo(100);
              return ListObjectsV2Response.builder()
                  .contents(
                      S3Object.builder().key("dev/" + prefix + "files/targets.parquet").build())
                  .build();
            });
    when(client.deleteObjects(any(Consumer.class)))
        .thenReturn(
            DeleteObjectsResponse.builder()
                .errors(S3Error.builder().code("AccessDenied").build())
                .build());
    var store = new S3UploadStore(client, mock(S3Presigner.class), "test", "dev/");
    assertThatThrownBy(() -> store.removeDemoFiles(prefix, true))
        .isInstanceOf(IllegalStateException.class);
    when(client.deleteObjects(any(Consumer.class)))
        .thenReturn(DeleteObjectsResponse.builder().build());
    assertThat(store.removeDemoFiles(prefix, true)).isFalse();
    when(client.listObjectsV2(any(Consumer.class)))
        .thenReturn(ListObjectsV2Response.builder().build());
    assertThat(store.removeDemoFiles(prefix, true)).isTrue();
  }

  @Test
  void broad_or_traversing_paths_never_reach_s3() {
    var client = mock(S3Client.class);
    var store = new S3UploadStore(client, mock(S3Presigner.class), "test", "dev/");
    for (String key :
        new String[] {
          "", "requests/", "uploads/12/1/../../secret", "/uploads/12/1/a", "uploads/12/1/a/b"
        })
      assertThatThrownBy(() -> store.removeDemoFiles(key, false))
          .isInstanceOf(IllegalArgumentException.class);
    verifyNoInteractions(client);
  }

  @Test
  void local_cleanup_preserves_unrelated_files_and_handles_missing(@TempDir Path root)
      throws Exception {
    var store = new LocalFolderUploadStore(root.toString());
    Path file = root.resolve("uploads/12/1/test.csv");
    Files.createDirectories(file.getParent());
    Files.writeString(file, "test");
    Files.writeString(root.resolve("keep.csv"), "keep");
    assertThat(store.removeDemoFiles("uploads/12/1/test.csv", false)).isTrue();
    assertThat(store.removeDemoFiles("uploads/12/1/test.csv", false)).isTrue();
    assertThat(Files.exists(root.resolve("keep.csv"))).isTrue();
  }
}
