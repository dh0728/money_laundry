package com.moneylaundry.api.review;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class BusinessTime {
  public static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final Environment env;

  public BusinessTime(JdbcTemplate jdbc, TransactionTemplate tx, Environment env) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.env = env;
  }

  public void localOnly() {
    var p = Arrays.asList(env.getActiveProfiles());
    if (!p.contains("local") || p.contains("prod") || p.contains("dev"))
      throw new ApiException(HttpStatus.FORBIDDEN, "DEMO_CONTROL_DISABLED", "로컬 시연 전용 기능입니다.");
  }

  public Instant now() {
    var p = Arrays.asList(env.getActiveProfiles());
    if (!p.contains("local") || p.contains("prod") || p.contains("dev")) return Instant.now();
    Timestamp value =
        jdbc.queryForObject(
            "select business_at from demo_business_clock where id", Timestamp.class);
    return value == null ? Instant.now() : value.toInstant();
  }

  public Map<String, Object> view() {
    var result = new LinkedHashMap<String, Object>();
    result.put("businessAt", now().atZone(KST).toOffsetDateTime().toString());
    result.put(
        "configured",
        jdbc.queryForObject(
            "select business_at is not null from demo_business_clock where id", Boolean.class));
    result.put(
        "revision",
        jdbc.queryForObject("select revision from demo_business_clock where id", Long.class));
    return result;
  }

  public Map<String, Object> set(Instant value, long expected) {
    localOnly();
    if (value == null) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          jdbc.queryForList("select * from demo_business_clock where id for update");
          long revision =
              jdbc.queryForObject("select revision from demo_business_clock where id", Long.class);
          if (revision != expected)
            throw ApiException.invalidTransition("시연 시각이 변경됐습니다. 다시 조회하세요.");
          boolean busy =
              jdbc.queryForObject(
                  "select exists(select 1 from batch_jobs where status in ('RUNNING','QUEUED','SCHEDULED','RETRY_WAIT','RECEIVED') or (job_type='ANALYSIS' and status='FAILED'))",
                  Boolean.class);
          if (busy) throw ApiException.invalidTransition("진행 중 또는 복구가 필요한 작업이 있습니다.");
          Timestamp previous =
              jdbc.queryForObject(
                  "select business_at from demo_business_clock where id", Timestamp.class);
          if (previous != null && value.isBefore(previous.toInstant()))
            throw ApiException.invalidTransition("과거로 이동하려면 시연 데이터를 초기화하세요.");
          if (previous == null
              && jdbc.queryForObject(
                  "select exists(select 1 from batch_jobs where job_type='ANALYSIS')",
                  Boolean.class))
            throw ApiException.invalidTransition("기존 분석 시연은 초기화 후 업무 시각을 설정하세요.");
          jdbc.update(
              "update demo_business_clock set business_at=?,revision=revision+1,updated_at=now() where id",
              Timestamp.from(value));
          return view();
        });
  }
}
