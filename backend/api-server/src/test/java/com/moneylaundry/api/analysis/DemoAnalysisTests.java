package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.TestcontainersConfiguration;
import java.time.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DemoAnalysisTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired PlatformTransactionManager manager;
  @MockitoBean AnalysisScheduler scheduler;
  AnalysisService service;
  LocalDate day = LocalDate.of(2023, 9, 1);

  @BeforeEach
  void setup() {
    jdbc.execute("truncate batch_jobs cascade");
    service =
        new AnalysisService(
            jdbc,
            new TransactionTemplate(manager),
            Clock.fixed(Instant.parse("2026-09-22T01:00:00Z"), ZoneOffset.UTC),
            "Asia/Seoul",
            .7,
            LocalTime.of(3, 0));
  }

  void upload(LocalDate date, String state) {
    jdbc.update(
        "insert into batch_jobs(job_type,status,business_date,received_at) values('INGEST',?,?, '2026-09-22T00:59:00Z')",
        state,
        date);
  }

  @Test
  void configured_business_clock_controls_demo_date_but_not_receipt_cutoff() {
    LocalDate future = LocalDate.of(2030, 1, 1);
    upload(future, "COMPLETED");
    assertThatThrownBy(() -> service.registerDemo(future)).isInstanceOf(ApiException.class);
    long id = service.registerDemo(future, future.plusDays(1));
    assertThat(
            jdbc.queryForObject(
                    "select analysis_cutoff_at from batch_jobs where job_id=?",
                    java.sql.Timestamp.class,
                    id)
                .toInstant())
        .isEqualTo(Instant.parse("2026-09-22T01:00:00Z"));
  }

  @Test
  void two_days_run_without_changing_wall_clock_and_keep_normal_wait_stage() {
    upload(day, "RUNNING");
    long first = service.registerDemo(day);
    assertThat(service.job(first).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
    assertThat(
            jdbc.queryForObject(
                "select analysis_date from batch_jobs where job_id=?", LocalDate.class, first))
        .isEqualTo(day.plusDays(1));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_receipts where job_id=?", Integer.class, first))
        .isEqualTo(1);
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
    jdbc.update("update batch_jobs set status='COMPLETED' where job_id=?", first);
    upload(day.plusDays(1), "COMPLETED");
    long next = service.registerDemo(day.plusDays(1));
    assertThat(next).isGreaterThan(first);
    assertThat(
            jdbc.queryForObject(
                "select count(distinct analysis_cutoff_at) from batch_jobs where job_type='ANALYSIS'",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void missing_future_and_out_of_order_inputs_are_not_bypassed() {
    assertThatThrownBy(() -> service.registerDemo(day)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> service.registerDemo(null)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> service.registerDemo(LocalDate.of(2026, 9, 22)))
        .isInstanceOf(ApiException.class);
    upload(day.plusDays(1), "COMPLETED");
    assertThatThrownBy(() -> service.registerDemo(day)).isInstanceOf(ApiException.class);
    long later = service.registerDemo(day.plusDays(1));
    jdbc.update("update batch_jobs set status='COMPLETED' where job_id=?", later);
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> service.registerDemo(day)).isInstanceOf(ApiException.class);
  }

  @Test
  void failed_previous_analysis_requires_resume() {
    upload(day, "COMPLETED");
    long id = service.registerDemo(day);
    jdbc.update("update batch_jobs set status='FAILED' where job_id=?", id);
    upload(day.plusDays(1), "COMPLETED");
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void control_is_local_only_even_with_mixed_profiles() {
    for (String profiles : new String[] {"", "prod", "dev", "local,prod", "local,dev"}) {
      var env = new MockEnvironment();
      if (!profiles.isEmpty()) env.setActiveProfiles(profiles.split(","));
      var mocked = mock(AnalysisService.class);
      var controller = new DemoAnalysisController(mocked, env);
      assertThatThrownBy(() -> controller.trigger(new DemoAnalysisController.Trigger(day)))
          .isInstanceOf(ApiException.class);
      verifyNoInteractions(mocked);
    }
    var env = new MockEnvironment();
    env.setActiveProfiles("local");
    var mocked = mock(AnalysisService.class);
    assertThat(
            new DemoAnalysisController(mocked, env)
                .trigger(new DemoAnalysisController.Trigger(day))
                .getStatusCode()
                .value())
        .isEqualTo(202);
    verify(mocked).registerDemo(day);
  }
}
