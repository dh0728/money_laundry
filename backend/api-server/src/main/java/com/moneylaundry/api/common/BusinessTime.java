package com.moneylaundry.api.common;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.auth.WorkbenchAccess;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 업무 시각: 업무 화면이 열린 환경에서 시연 업무 시계(ops.business_clock)가 있으면 그 시각, 없으면 실제 시각. 업무 의미가 있는 시각(수신·분석 기준·처리
 * 기록·화면 표시)은 모두 이 값을 쓰고, 실제 시각은 만료·재시도·timeout 같은 운영 타이머에만 쓴다. dev/local 시연 시계는 설정 뒤 흐른 시간만큼 앞으로
 * 간다(현실 날짜는 모른다). 복사된 시계를 읽기만 하는 prod 발표 모드는 설정값에 멈춰 있다. 시계 변경은 dev/local 전용이다.
 */
@Service
public class BusinessTime {
  public static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final String FLOWING =
      "select business_at+(clock_timestamp()-updated_at) from ops.business_clock where id";
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final Environment env;

  public BusinessTime(JdbcTemplate jdbc, TransactionTemplate tx, Environment env) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.env = env;
  }

  /** dev/local 시연 환경(prod 제외): 시계를 바꿀 수 있고, 실제 날짜 기준 자동 예약을 쓰지 않는다. */
  public static boolean demoEnvironment(Environment env) {
    var p = Arrays.asList(env.getActiveProfiles());
    return !p.contains("prod") && (p.contains("local") || p.contains("dev"));
  }

  public void demoOnly() {
    if (!demoEnvironment(env))
      throw new ApiException(
          HttpStatus.FORBIDDEN, "DEMO_CONTROL_DISABLED", "dev/local 시연 전용 기능입니다.");
  }

  public void workbenchOnly() {
    if (!WorkbenchAccess.enabled(env))
      throw new ApiException(HttpStatus.FORBIDDEN, "WORKBENCH_DISABLED", "업무 화면이 활성화되지 않았습니다.");
  }

  public Instant now() {
    if (!WorkbenchAccess.enabled(env)) return Instant.now();
    Timestamp value =
        demoEnvironment(env)
            ? jdbc.queryForObject(FLOWING, Timestamp.class)
            : jdbc.queryForObject(
                "select business_at from ops.business_clock where id", Timestamp.class);
    return value == null ? Instant.now() : value.toInstant();
  }

  /** 업무 시각 − 실제 시각. 업무 시각을 SQL·외부 프로세스에서 `실제 시각 + offset`으로 다시 만들 때 쓴다. */
  public Duration offset() {
    return Duration.between(Instant.now(), now());
  }

  public Map<String, Object> view() {
    var result = new LinkedHashMap<String, Object>();
    result.put("businessAt", now().atZone(KST).toOffsetDateTime().toString());
    result.put(
        "configured",
        jdbc.queryForObject(
            "select business_at is not null from ops.business_clock where id", Boolean.class));
    result.put(
        "revision",
        jdbc.queryForObject("select revision from ops.business_clock where id", Long.class));
    return result;
  }

  public Map<String, Object> set(Instant value, long expected) {
    demoOnly();
    if (value == null) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          jdbc.queryForList("select * from ops.business_clock where id for update");
          long revision =
              jdbc.queryForObject("select revision from ops.business_clock where id", Long.class);
          if (revision != expected)
            throw ApiException.invalidTransition("시연 시각이 변경됐습니다. 다시 조회하세요.");
          boolean busy =
              jdbc.queryForObject(
                  "select exists(select 1 from ops.work_items where status in ('RUNNING','QUEUED','SCHEDULED','RETRY_WAIT','RECEIVED') or (job_type='ANALYSIS' and status='FAILED'))",
                  Boolean.class);
          if (busy) throw ApiException.invalidTransition("진행 중 또는 복구가 필요한 작업이 있습니다.");
          // The flowing clock has already moved past the last setting.
          Timestamp previous = jdbc.queryForObject(FLOWING, Timestamp.class);
          if (previous != null && value.isBefore(previous.toInstant()))
            throw ApiException.invalidTransition("과거로 이동하려면 시연 데이터를 초기화하세요.");
          if (previous == null
              && jdbc.queryForObject(
                  "select exists(select 1 from ops.work_items where job_type='ANALYSIS')",
                  Boolean.class))
            throw ApiException.invalidTransition("기존 분석 시연은 초기화 후 업무 시각을 설정하세요.");
          jdbc.update(
              "update ops.business_clock set business_at=?,revision=revision+1,updated_at=now() where id",
              Timestamp.from(value));
          return view();
        });
  }
}
