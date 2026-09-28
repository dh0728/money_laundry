package com.moneylaundry.api.config;

import com.moneylaundry.api.ingest.PrivateDataProtector;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

/** Deployed services must be able to protect reports before accepting uploads. */
@Configuration(proxyBeanMethods = false)
@Profile({"dev", "prod"})
public class IngestStartupConfiguration {
  @Bean
  InitializingBean privateDataKeyValidation(PrivateDataProtector protector) {
    return protector::requireKeys;
  }
}
