package com.moneylaundry.api.analysis;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;
@Component
public class CancellationScheduler  {
  private final AnalysisRunService runs;
  private final CancellationTransport transport;
  public CancellationScheduler(AnalysisRunService runs,CancellationTransport transport) {
    this.runs=runs;
    this.transport=transport;
  }
  @Scheduled(fixedDelay=5000,initialDelay=5000)
  public void deliver() {
    try {
      runs.deliverCancellations(transport);
    }
    catch(org.springframework.dao.DataAccessException ignored) {
      /* Durable rows are retried after connectivity returns. */
    }
  }
}
