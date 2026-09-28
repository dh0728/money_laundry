package com.moneylaundry.api.analysis;

import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AnalysisSchedulerTests {
  @Test
  void demo_disables_only_registration_not_processing_or_recovery() {
    var service = mock(AnalysisService.class);
    var runner = mock(AnalysisRunner.class);
    var scheduler = new AnalysisScheduler(service, runner);
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
    var scheduler = new AnalysisScheduler(service, mock(AnalysisRunner.class));
    scheduler.cutoff();
    verify(service).registerScheduled();
  }
}
