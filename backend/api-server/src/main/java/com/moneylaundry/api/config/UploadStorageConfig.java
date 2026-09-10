package com.moneylaundry.api.config;

import com.moneylaundry.api.storage.LocalFolderUploadStore;
import com.moneylaundry.api.storage.S3UploadStore;
import com.moneylaundry.api.storage.UploadStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration
public class UploadStorageConfig {
  @Bean(destroyMethod = "close")
  DefaultCredentialsProvider awsCredentials() {
    return DefaultCredentialsProvider.builder().build();
  }

  @Bean(destroyMethod = "close")
  S3Client s3Client(
      DefaultCredentialsProvider credentials, @Value("${app.s3.region}") String region) {
    return S3Client.builder().region(Region.of(region)).credentialsProvider(credentials).build();
  }

  @Bean(destroyMethod = "close")
  S3Presigner s3Presigner(
      DefaultCredentialsProvider credentials, @Value("${app.s3.region}") String region) {
    return S3Presigner.builder().region(Region.of(region)).credentialsProvider(credentials).build();
  }

  @Bean
  UploadStore uploadStore(
      S3Client client,
      S3Presigner presigner,
      Environment environment,
      @Value("${app.s3.bucket}") String bucket,
      @Value("${app.s3.prefix}") String prefix,
      @Value("${app.storage-dir}") String directory) {
    if (!bucket.isBlank()) {
      if (prefix.isBlank() || prefix.startsWith("/") || prefix.contains("..")) {
        throw new IllegalStateException("S3_PREFIX에 환경별 접두어를 지정하세요.");
      }
      return new S3UploadStore(client, presigner, bucket, prefix);
    }
    if (environment.acceptsProfiles(Profiles.of("dev", "prod"))) {
      throw new IllegalStateException("dev/prod 환경에는 S3_BUCKET과 S3_PREFIX가 필요합니다.");
    }
    return new LocalFolderUploadStore(directory);
  }
}
