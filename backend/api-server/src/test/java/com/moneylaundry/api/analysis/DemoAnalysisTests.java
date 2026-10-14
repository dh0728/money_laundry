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
    jdbc.execute("truncate analysis.jobs,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at=null where id");
    jdbc.update("insert into core.banks(bank_id) values(12) on conflict do nothing");
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
    upload(date, state, "2026-09-22T00:59:00Z");
  }

  /** received_at is business time: before the cutoff of the clock the test runs on. */
  void upload(LocalDate date, String state, String receivedAt) {
    jdbc.update(
        "insert into ingest.uploads(bank_id,file_name,file_hash,size_bytes,status,business_date,received_at) values(12,'fixture.csv',repeat('a',64),1,?,?,?::timestamptz)",
        state,
        date,
        receivedAt);
  }

  @AfterEach
  void clearDemoClock() {
    jdbc.update("update ops.business_clock set business_at=null where id");
  }

  @Test
  void demo_clock_blocks_real_date_registration_but_allows_dated_demo() {
    jdbc.update("update ops.business_clock set business_at='2023-09-02T00:00:00+09' where id");
    assertThatThrownBy(() -> service.registerNow())
        .isInstanceOfSatisfying(
            ApiException.class,
            e -> {
              assertThat(e.code()).isEqualTo("INVALID_TRANSITION");
              assertThat(e.status().value()).isEqualTo(409);
            });
    assertThatThrownBy(() -> service.registerScheduled()).isInstanceOf(ApiException.class);
    assertThat(jdbc.queryForObject("select count(*) from analysis.jobs", Integer.class)).isZero();
    upload(day, "COMPLETED", "2023-09-01T23:00:00+09");
    long id = service.registerDemo(day, day.plusDays(1));
    assertThat(
            jdbc.queryForObject(
                "select analysis_date from analysis.jobs where job_id=?", LocalDate.class, id))
        .isEqualTo(day.plusDays(1));
    assertThat(service.job(id).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
  }

  @Test
  void unconfigured_clock_keeps_normal_registration_available() {
    long manual = service.registerNow();
    assertThat(service.job(manual).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
    jdbc.execute("truncate analysis.jobs,ingest.uploads cascade");
    long scheduled = service.registerScheduled();
    assertThat(service.job(scheduled).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
  }

  @Test
  void configured_business_clock_controls_demo_date_but_not_receipt_cutoff() {
    LocalDate future = LocalDate.of(2030, 1, 1);
    upload(future, "COMPLETED");
    assertThatThrownBy(() -> service.registerDemo(future)).isInstanceOf(ApiException.class);
    long id = service.registerDemo(future, future.plusDays(1));
    assertThat(
            jdbc.queryForObject(
                    "select analysis_cutoff_at from analysis.jobs where job_id=?",
                    java.sql.Timestamp.class,
                    id)
                .toInstant())
        .isEqualTo(Instant.parse("2026-09-22T01:00:00Z"));
  }

  @Test
  void configured_business_clock_is_the_cutoff_and_receipts_compare_business_time() {
    jdbc.update("update ops.business_clock set business_at='2023-09-02T09:00:00+09' where id");
    jdbc.update(
        "insert into ingest.uploads(bank_id,file_name,file_hash,size_bytes,status,business_date,received_at) values"
            + "(12,'in.csv',repeat('a',64),1,'COMPLETED',?,'2023-09-02T08:59:00+09'),"
            + "(12,'late.csv',repeat('b',64),1,'COMPLETED',?,'2023-09-02T09:01:00+09')",
        day,
        day);
    long id = service.registerDemo(day);
    var job =
        jdbc.queryForMap(
            "select analysis_date,analysis_cutoff_at,business_at from analysis.jobs where job_id=?",
            id);
    Instant business = Instant.parse("2023-09-02T00:00:00Z");
    assertThat(job.get("analysis_date").toString()).isEqualTo("2023-09-02");
    assertThat(((java.sql.Timestamp) job.get("analysis_cutoff_at")).toInstant())
        .isEqualTo(business);
    assertThat(((java.sql.Timestamp) job.get("business_at")).toInstant()).isEqualTo(business);
    assertThat(
            jdbc.queryForList(
                "select u.file_name from analysis.receipts r join ingest.uploads u using(upload_id) where r.job_id=?",
                String.class,
                id))
        .containsExactly("in.csv");
  }

  @Test
  void demo_business_clock_flows_from_its_last_setting_but_presentation_copy_does_not() {
    jdbc.update(
        "update ops.business_clock set business_at='2023-09-02T09:00:00+09',updated_at=clock_timestamp()-interval '10 minutes' where id");
    var local = new MockEnvironment();
    local.setActiveProfiles("local");
    Instant now =
        new com.moneylaundry.api.review.BusinessTime(jdbc, new TransactionTemplate(manager), local)
            .now();
    assertThat(Duration.between(Instant.parse("2023-09-02T00:10:00Z"), now).abs())
        .isLessThan(Duration.ofSeconds(30));
    var presentation = new MockEnvironment().withProperty("app.presentation.enabled", "true");
    presentation.setActiveProfiles("prod");
    assertThat(
            new com.moneylaundry.api.review.BusinessTime(
                    jdbc, new TransactionTemplate(manager), presentation)
                .now())
        .isEqualTo(Instant.parse("2023-09-02T00:00:00Z"));
  }

  @Test
  void two_days_run_without_changing_wall_clock_and_keep_normal_wait_stage() {
    upload(day, "RUNNING");
    long first = service.registerDemo(day);
    assertThat(service.job(first).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
    assertThat(
            jdbc.queryForObject(
                "select analysis_date from analysis.jobs where job_id=?", LocalDate.class, first))
        .isEqualTo(day.plusDays(1));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.receipts where job_id=?", Integer.class, first))
        .isEqualTo(1);
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
    jdbc.update("update analysis.jobs set status='COMPLETED' where job_id=?", first);
    upload(day.plusDays(1), "COMPLETED");
    long next = service.registerDemo(day.plusDays(1));
    assertThat(next).isGreaterThan(first);
    assertThat(
            jdbc.queryForObject(
                "select count(distinct analysis_cutoff_at) from analysis.jobs", Integer.class))
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
    jdbc.update("update analysis.jobs set status='COMPLETED' where job_id=?", later);
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> service.registerDemo(day)).isInstanceOf(ApiException.class);
  }

  @Test
  void failed_previous_analysis_requires_resume() {
    upload(day, "COMPLETED");
    long id = service.registerDemo(day);
    jdbc.update("update analysis.jobs set status='FAILED' where job_id=?", id);
    upload(day.plusDays(1), "COMPLETED");
    assertThatThrownBy(() -> service.registerDemo(day.plusDays(1)))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void control_allows_dev_local_and_rejects_prod_mixed_profiles() {
    for (String profiles : new String[] {"", "prod", "local,prod", "dev,prod"}) {
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
