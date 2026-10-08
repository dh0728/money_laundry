package com.moneylaundry.api.review;

import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Polls durable invalidations; unchanged scopes perform no aggregation. */
@Component
@Slf4j
public class DashboardRefreshWorker {
  private final DashboardProjection projection;
  private final long delay;
  private final boolean enabled;
  private final ScheduledExecutorService executor =
      Executors.newScheduledThreadPool(
          2,
          r -> {
            var thread = new Thread(r, "dashboard-refresh");
            thread.setDaemon(true);
            return thread;
          });

  public DashboardRefreshWorker(
      DashboardProjection projection,
      @Value("${app.dashboard.refresh-delay-ms:2000}") long delay,
      @Value("${app.dashboard.refresh-enabled:true}") boolean enabled) {
    if (delay < 100)
      throw new IllegalArgumentException("Dashboard refresh delay must be at least 100ms");
    this.projection = projection;
    this.delay = delay;
    this.enabled = enabled;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void start() {
    if (!enabled) return;
    executor.scheduleWithFixedDelay(
        () -> refresh(DashboardProjection.Scope.MODEL), 0, delay, TimeUnit.MILLISECONDS);
    executor.scheduleWithFixedDelay(
        () -> {
          refresh(DashboardProjection.Scope.CASES);
          refresh(DashboardProjection.Scope.REPORTS);
          refresh(DashboardProjection.Scope.DELIVERY);
        },
        0,
        delay,
        TimeUnit.MILLISECONDS);
  }

  private void refresh(DashboardProjection.Scope scope) {
    long start = System.nanoTime();
    try {
      if (projection.refresh(scope))
        log.info(
            "Dashboard scope={} refreshed durationMs={}",
            scope,
            (System.nanoTime() - start) / 1_000_000);
    } catch (RuntimeException ex) {
      // No payload/credentials in logs. Rollback preserves both the published values and requests.
      log.warn(
          "Dashboard scope={} refresh failed; retained for retry, exception={}",
          scope,
          ex.getClass().getSimpleName());
    }
  }

  @PreDestroy
  public void stop() throws InterruptedException {
    executor.shutdownNow();
    executor.awaitTermination(10, TimeUnit.SECONDS);
  }
}
