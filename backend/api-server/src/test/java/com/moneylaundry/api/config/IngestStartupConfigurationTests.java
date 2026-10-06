package com.moneylaundry.api.config;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.ingest.PrivateDataProtector;
import java.util.Base64;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

class IngestStartupConfigurationTests {
  private static String key(int marker) {
    byte[] value = new byte[32];
    value[0] = (byte) marker;
    return Base64.getEncoder().encodeToString(value);
  }

  private AnnotationConfigApplicationContext context(
      String profile, String a, String b, String version) {
    var context = new AnnotationConfigApplicationContext();
    context.getEnvironment().setActiveProfiles(profile);
    context.registerBean(PrivateDataProtector.class, () -> new PrivateDataProtector(a, b, version));
    context.register(IngestStartupConfiguration.class);
    return context;
  }

  @ParameterizedTest
  @ValueSource(strings = {"dev", "prod"})
  void deployed_profiles_reject_missing_keys_before_accepting_work(String profile) {
    try (var context = context(profile, "", "", "")) {
      assertThatThrownBy(context::refresh)
          .hasRootCauseInstanceOf(IllegalStateException.class)
          .hasRootCauseMessage("PRIVATE_DATA_KEYS_REQUIRED");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"dev", "prod"})
  void deployed_profiles_accept_distinct_valid_keys(String profile) {
    try (var context = context(profile, key(1), key(2), "test")) {
      context.refresh();
      assertThat(context.isActive()).isTrue();
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"malformed", "short", "equal"})
  void invalid_keys_fail_without_disclosing_values(String scenario) {
    String supplied =
        switch (scenario) {
          case "malformed" -> "not-base64-secret";
          case "short" -> Base64.getEncoder().encodeToString(new byte[16]);
          default -> key(1);
        };
    try (var context = context("dev", key(1), supplied, "test")) {
      assertThatThrownBy(context::refresh)
          .hasRootCauseInstanceOf(IllegalStateException.class)
          .hasStackTraceContaining("PRIVATE_DATA_KEY")
          .hasStackTraceContaining("IllegalStateException")
          .hasStackTraceContaining("privateDataKeyValidation")
          .satisfies(error -> assertThat(error.getMessage()).doesNotContain(supplied));
    }
  }
}
