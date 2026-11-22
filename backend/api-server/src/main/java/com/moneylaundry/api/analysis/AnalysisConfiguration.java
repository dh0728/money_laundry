package com.moneylaundry.api.analysis;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

/** 분석 스케줄링 공통 빈: UTC 기준 Clock과 스케줄러 스레드 풀(2개). */
@Configuration
@EnableScheduling
public class AnalysisConfiguration {
  @Bean
  public Clock applicationClock() {
    return Clock.systemUTC();
  }

  @Bean
  public ThreadPoolTaskScheduler taskScheduler() {
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(2);
    scheduler.setThreadNamePrefix("analysis-schedule-");
    return scheduler;
  }
}
