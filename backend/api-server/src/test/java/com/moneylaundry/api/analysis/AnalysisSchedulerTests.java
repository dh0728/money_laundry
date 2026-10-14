package com.moneylaundry.api.analysis;

import static org.mockito.Mockito.*;

import com.moneylaundry.api.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

class AnalysisSchedulerTests {
  private static MockEnvironment profile(String... profiles) {
    var env = new MockEnvironment();
    env.setActiveProfiles(profiles);
    return env;
  }

  @Test
  void demo_registration_rejection_does_not_disable_processing_or_recovery() {
    var service = mock(AnalysisService.class);
    var runner = mock(AnalysisRunner.class);
    var scheduler = new AnalysisScheduler(service, runner, profile("prod"));
    when(service.registerScheduled()).thenThrow(ApiException.invalidTransition("시연 시계 설정됨"));
    scheduler.cutoff();
    scheduler.retryDue();
    scheduler.recover();
    verify(service).registerScheduled();
    verify(runner).scan();
    verify(runner).recover();
  }

  @Test
  void demo_disables_only_registration_not_processing_or_recovery() {
    var service = mock(AnalysisService.class);
    var runner = mock(AnalysisRunner.class);
    var scheduler = new AnalysisScheduler(service, runner, profile("prod"));
    ReflectionTestUtils.setField(scheduler, "scheduledEnabled", false);
    scheduler.cutoff();
    scheduler.retryDue();
    scheduler.recover();
    verifyNoInteractions(service);
    verify(runner).scan();
    verify(runner).recover();
  }

  @Test
  void registration_remains_enabled_by_default() {
    var service = mock(AnalysisService.class);
    var scheduler = new AnalysisScheduler(service, mock(AnalysisRunner.class), profile("prod"));
    scheduler.cutoff();
    verify(service).registerScheduled();
  }

  @Test
  void business_clock_environments_never_register_on_the_real_cutoff() {
    for (String profile : new String[] {"dev", "local"}) {
      var service = mock(AnalysisService.class);
      var runner = mock(AnalysisRunner.class);
      var scheduler = new AnalysisScheduler(service, runner, profile(profile));
      scheduler.cutoff();
      scheduler.retryDue();
      verifyNoInteractions(service);
      verify(runner).scan();
    }
  }
}
