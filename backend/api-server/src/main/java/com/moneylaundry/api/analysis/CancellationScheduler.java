package com.moneylaundry.api.analysis;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 정정으로 취소된 추론 요청의 취소 통지(analysis.cancel_outbox)를 5초마다 전달·재시도한다. */
@Component
public class CancellationScheduler {
  private final AnalysisRunService runs;
  private final CancellationTransport transport;

  public CancellationScheduler(AnalysisRunService runs, CancellationTransport transport) {
    this.runs = runs;
    this.transport = transport;
  }

  @Scheduled(fixedDelay = 5000, initialDelay = 5000)
  public void deliver() {
    try {
      runs.deliverCancellations(transport);
    } catch (org.springframework.dao.DataAccessException ignored) {
      /* Durable rows are retried after connectivity returns. */
    }
  }
}
