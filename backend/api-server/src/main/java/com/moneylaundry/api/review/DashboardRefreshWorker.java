package com.moneylaundry.api.review;

import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** A bounded dispatcher: slow refreshes never run on the polling thread. */
@Component
@Slf4j
public class DashboardRefreshWorker {
  private final DashboardProjection projection;
  private final long intervalNanos;
  private final boolean enabled;
  private final ScheduledExecutorService poller =
      Executors.newSingleThreadScheduledExecutor(r -> daemon(r, "dashboard-poll"));
  private final ExecutorService workers =
      new ThreadPoolExecutor(
          2,
          2,
          0,
          TimeUnit.MILLISECONDS,
          new ArrayBlockingQueue<>(2),
          r -> daemon(r, "dashboard-refresh"),
          new ThreadPoolExecutor.AbortPolicy());
  private final Set<DashboardProjection.Scope> inFlight =
      Collections.synchronizedSet(EnumSet.noneOf(DashboardProjection.Scope.class));
  private final AtomicBoolean running = new AtomicBoolean();
  private long nextTick;

  public DashboardRefreshWorker(
      DashboardProjection projection,
      @Value("${app.dashboard.refresh-delay-ms:5000}") long delay,
      @Value("${app.dashboard.refresh-enabled:true}") boolean enabled) {
    if (delay < 100)
      throw new IllegalArgumentException("Dashboard poll interval must be at least 100ms");
    this.projection = projection;
    this.intervalNanos = TimeUnit.MILLISECONDS.toNanos(delay);
    this.enabled = enabled;
  }

  private static Thread daemon(Runnable task, String name) {
    var t = new Thread(task, name);
    t.setDaemon(true);
    return t;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void start() {
    if (!enabled || !running.compareAndSet(false, true)) return;
    nextTick = System.nanoTime();
    poller.execute(this::tick);
  }

  private void tick() {
    try {
      checkNow();
    } catch (RuntimeException ex) {
      log.warn("Dashboard poll failed code={}", DashboardProjection.errorCode(ex));
    } finally {
      if (running.get()) {
        long now = System.nanoTime();
        nextTick += (Math.max(0, now - nextTick) / intervalNanos + 1) * intervalNanos;
        try {
          poller.schedule(
              this::tick, Math.max(0, nextTick - System.nanoTime()), TimeUnit.NANOSECONDS);
        } catch (RejectedExecutionException ignored) {
          /* Shutdown raced with scheduling. */
        }
      }
    }
  }

  void checkNow() {
    for (var scope : projection.dueScopes()) {
      if (!inFlight.add(scope)) continue;
      try {
        workers.execute(() -> refresh(scope));
      } catch (RejectedExecutionException ex) {
        inFlight.remove(scope);
        if (!workers.isShutdown()) throw ex;
      }
    }
  }

  private void refresh(DashboardProjection.Scope scope) {
    long started = System.nanoTime();
    try {
      if (projection.refresh(scope))
        log.info(
            "Dashboard scope={} refreshed durationMs={}",
            scope,
            (System.nanoTime() - started) / 1_000_000);
    } catch (RuntimeException ex) {
      log.warn(
          "Dashboard scope={} refresh failed code={}; request retained",
          scope,
          DashboardProjection.errorCode(ex));
    } finally {
      inFlight.remove(scope);
    }
  }

  @PreDestroy
  public void stop() throws InterruptedException {
    running.set(false);
    poller.shutdownNow();
    workers.shutdownNow();
    poller.awaitTermination(2, TimeUnit.SECONDS);
    workers.awaitTermination(5, TimeUnit.SECONDS);
  }
}
