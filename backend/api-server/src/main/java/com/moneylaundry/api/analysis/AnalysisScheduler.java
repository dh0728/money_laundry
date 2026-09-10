package com.moneylaundry.api.analysis;

import com.moneylaundry.api.ApiException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@Slf4j
public class AnalysisScheduler {
  private final AnalysisService service;
  private final AnalysisRunner runner;

  public AnalysisScheduler(AnalysisService service, AnalysisRunner runner) {
    this.service = service;
    this.runner = runner;
  }

  @Scheduled(cron = "#{@analysisService.cron()}", zone = "${app.zone}")
  public void cutoff() {
    try {
      service.registerScheduled();
    } catch (ApiException | DataAccessException e) {
      log.warn("분석 등록 실패: 상태 확인 필요");
    }
  }

  @Scheduled(fixedDelay = 5000, initialDelay = 5000)
  public void retryDue() {
    runner.scan();
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recover() {
    runner.recover();
  }
}
