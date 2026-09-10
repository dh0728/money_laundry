package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

class AnalysisControlTests {
  @ParameterizedTest
  @ValueSource(strings = {"dev", "local"})
  void enabled(String profile) {
    var env = new MockEnvironment();
    env.setActiveProfiles(profile);
    var service = mock(AnalysisService.class);
    var controller = new AnalysisController(service, env);
    assertThat(controller.trigger().getStatusCode().value()).isEqualTo(202);
    assertThat(controller.trigger().getBody().get("status")).isEqualTo("QUEUED");
    controller.resume(1);
    verify(service).resume(1);
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "prod", "dev,prod", "local,prod", "unknown"})
  void disabled(String profiles) {
    var env = new MockEnvironment();
    if (!profiles.isEmpty()) env.setActiveProfiles(profiles.split(","));
    var service = mock(AnalysisService.class);
    var controller = new AnalysisController(service, env);
    assertThatThrownBy(controller::trigger).isInstanceOf(com.moneylaundry.api.ApiException.class);
    assertThatThrownBy(() -> controller.resume(1))
        .isInstanceOf(com.moneylaundry.api.ApiException.class);
    verifyNoInteractions(service);
  }
}
