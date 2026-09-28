package com.moneylaundry.api.storage;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.config.UploadStorageConfig;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class UploadStorageConfigTests {
  private final ApplicationContextRunner runner =
      new ApplicationContextRunner()
          .withUserConfiguration(UploadStorageConfig.class)
          .withPropertyValues(
              "app.s3.bucket=",
              "app.s3.prefix=",
              "app.s3.region=ap-northeast-2",
              "app.storage-dir=storage");

  @Test
  void 운영환경은_S3설정누락시_시작하지_않는다() {
    runner.withPropertyValues("spring.profiles.active=prod").run(c -> assertThat(c).hasFailed());
  }

  @Test
  void 로컬만_폴더저장소를_사용한다() {
    runner.run(
        c -> assertThat(c.getBean(UploadStore.class)).isInstanceOf(LocalFolderUploadStore.class));
  }

  @Test
  void S3환경접두어가_없으면_시작하지_않는다() {
    runner.withPropertyValues("app.s3.bucket=example-bucket").run(c -> assertThat(c).hasFailed());
  }
}
