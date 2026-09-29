package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "spring.profiles.active=local")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@Transactional
class NotificationTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired NotificationService service;
  @Autowired MockMvc mvc;
  @MockitoBean AnalysisScheduler scheduler;
  long owner, other, job;
  UUID run;

  @BeforeEach
  void setup() {
    owner = jdbc.queryForObject("select user_id from users where username='l1a'", Long.class);
    other = jdbc.queryForObject("select user_id from users where username='l1b'", Long.class);
    jdbc.update("update demo_business_clock set business_at='2023-09-02T00:00:00Z'");
    job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,threshold_value) values('ANALYSIS','COMPLETED','2023-09-02',.7) returning job_id",
            Long.class);
    run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
  }

  long alert(long user) {
    long id =
        jdbc.queryForObject(
            "insert into alerts(assignee_id) values(?) returning alert_id", Long.class, user);
    jdbc.update("insert into alert_versions values(?,1,?,repeat('a',64),'{}',now())", id, run);
    return jdbc.queryForObject("select case_id from review_cases where alert_id=?", Long.class, id);
  }

  @SuppressWarnings("unchecked")
  List<Map<String, Object>> rows(Map<String, Object> page) {
    return (List<Map<String, Object>>) page.get("content");
  }

  @Test
  void batch_grouping_only_completed_and_current_user_with_real_case_ids() {
    long first = alert(owner), second = alert(owner);
    alert(other);
    var page = service.list(owner, null, null, null, 0, 20);
    assertThat(rows(page)).hasSize(1);
    assertThat(rows(page).getFirst().get("count")).isEqualTo(2L);
    assertThat(rows(service.cases(owner, "batch:" + run, 0, 1))).hasSize(1);
    assertThat(rows(service.cases(owner, "batch:" + run, 0, 20)))
        .extracting(r -> r.get("caseId"))
        .containsExactlyInAnyOrder(first, second);
    jdbc.update("update batch_jobs set status='RUNNING' where job_id=?", job);
    assertThat(rows(service.list(owner, null, null, null, 0, 20))).isEmpty();
  }

  @Test
  void read_is_idempotent_persistent_isolated_and_atomic() {
    alert(owner);
    alert(other);
    String id = "batch:" + run;
    service.read(owner, new NotificationService.ReadInput(List.of(id), true));
    service.read(owner, new NotificationService.ReadInput(List.of(id), true));
    assertThat(service.list(owner, null, null, null, 0, 20).get("unreadCount")).isEqualTo(0L);
    assertThat(service.list(other, null, null, null, 0, 20).get("unreadCount")).isEqualTo(1L);
    assertThatThrownBy(
            () ->
                service.read(
                    owner,
                    new NotificationService.ReadInput(List.of(id, "event:999999999"), false)))
        .hasMessageContaining("알림");
    // Failed writes validate all IDs before changing any read state.
    assertThat(
            jdbc.queryForObject(
                "select count(*) from notification_reads where user_id=?", Long.class, owner))
        .isEqualTo(1L);
  }

  @Test
  void business_dates_search_and_actual_events_exclude_internal_snapshots() {
    long id = alert(owner);
    jdbc.update(
        "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'COMMENT','확인 요청','2023-09-02T01:00:00Z','{}')",
        id,
        owner);
    jdbc.update(
        "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'MONEY_SNAPSHOT','internal','2023-09-02T01:00:00Z','{}')",
        id,
        owner);
    var result =
        rows(
            service.list(
                owner,
                LocalDate.parse("2023-09-02"),
                LocalDate.parse("2023-09-02"),
                "확인 요청",
                0,
                20));
    assertThat(result).hasSize(1);
    assertThat(result.getFirst().get("caseId")).isEqualTo(id);
    assertThat(result.getFirst().get("at")).isEqualTo("2023-09-02T10:00:00+09:00");
    assertThat(rows(service.list(owner, null, null, "internal", 0, 20))).isEmpty();
  }

  @Test
  void login_csrf_other_account_and_validation() throws Exception {
    long id = alert(other);
    long event =
        jdbc.queryForObject(
            "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'CLOSE','종결',now(),'{}') returning event_id",
            Long.class,
            id,
            other);
    mvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
    mvc.perform(get("/api/v1/notifications").with(user("l1a").roles("STAFF")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(0));
    mvc.perform(
            get("/api/v1/notifications/event:" + event + "/cases").with(user("l1a").roles("STAFF")))
        .andExpect(status().isNotFound());
    mvc.perform(
            post("/api/v1/notifications/read")
                .with(user("l1b").roles("STAFF"))
                .contentType("application/json")
                .content("{\"ids\":[\"event:" + event + "\"],\"read\":true}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/notifications/read")
                .with(user("l1b").roles("STAFF"))
                .with(csrf())
                .contentType("application/json")
                .content("{\"ids\":[\"event:" + event + "\"],\"read\":true}"))
        .andExpect(status().isOk());
    mvc.perform(get("/api/v1/notifications?size=101").with(user("l1a").roles("STAFF")))
        .andExpect(status().isBadRequest());
    mvc.perform(
            get("/api/v1/notifications?from=2023-09-03&to=2023-09-01")
                .with(user("l1a").roles("STAFF")))
        .andExpect(status().isBadRequest());
  }
}
