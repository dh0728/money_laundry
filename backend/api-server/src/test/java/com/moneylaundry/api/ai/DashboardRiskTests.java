package com.moneylaundry.api.ai;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** 대시보드 종합 위험지수와 AI 요약. 집계 표(ops.dashboard_*)에 값을 직접 넣어 지수 계산을 확인한다. 집계 갱신이 표를 덮지 않도록 갱신을 끈다. */
@SpringBootTest(
    properties = {"spring.profiles.active=local", "app.dashboard.refresh-enabled=false"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class DashboardRiskTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean AiSummaryService.Writer writer;
  @Autowired AiSummaryService summaries;
  MockHttpSession session = new MockHttpSession();
  String token;
  long l1;
  int key;

  @Test
  void ratio_and_backlog_scores_follow_the_agreed_breakpoints() {
    assertThat(DashboardRisk.ratioScore(0.4)).isZero();
    assertThat(DashboardRisk.ratioScore(1)).isEqualTo(20);
    assertThat(DashboardRisk.ratioScore(1.5)).isEqualTo(40);
    assertThat(DashboardRisk.ratioScore(2)).isEqualTo(60);
    assertThat(DashboardRisk.ratioScore(3)).isEqualTo(100);
    assertThat(DashboardRisk.ratioScore(9)).isEqualTo(100);
    assertThat(DashboardRisk.backlogScore(0.25)).isEqualTo(50);
    assertThat(DashboardRisk.backlogScore(0.8)).isEqualTo(100);
    assertThat(List.of(0, 19, 20, 39, 40, 59, 60, 79, 80, 100).stream().map(DashboardRisk::level))
        .containsExactly("낮음", "낮음", "보통", "보통", "경계", "경계", "높음", "높음", "심각", "심각");
  }

  @BeforeEach
  void setup() throws Exception {
    jdbc.execute(
        "truncate ops.dashboard_model_counts,ops.dashboard_score_points,ops.dashboard_case_counts,ops.dashboard_case_items");
    jdbc.update("update ops.business_clock set business_at='2023-09-11T03:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username='l1a'",
        encoder.encode("Test-password-123"));
    l1 = jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
    when(writer.model()).thenReturn("test-model");
    summaries.clearCache();
    token =
        object(
                mvc.perform(get("/api/auth/csrf").session(session))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("token")
            .toString();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", "l1a")
                .param("password", "Test-password-123"))
        .andExpect(status().isOk());
  }

  void model(String day, boolean suspicious, long n) {
    jdbc.update(
        "insert into ops.dashboard_model_counts(business_date,detected_day,suspicious,type_class,n) values(?::date,?::date,?,?,?)",
        day,
        day,
        suspicious,
        suspicious ? 2 : 0,
        n);
  }

  void score(String day, int pct, long n) {
    jdbc.update(
        "insert into ops.dashboard_score_points(business_date,score_pct,n) values(?::date,?,?)",
        day,
        pct,
        n);
  }

  void alerts(String createdAt, long n) {
    jdbc.update(
        "insert into ops.dashboard_case_counts(group_key,kind,assignee_id,status,created_at,assigned_at,linked,n) values(?::jsonb,'ALERT',?,'OPEN',?::timestamptz,?::timestamptz,false,?)",
        "{\"k\":" + (key++) + "}",
        l1,
        createdAt,
        createdAt,
        n);
  }

  void openAlert(long id, String assignedAt) {
    jdbc.update(
        "insert into ops.dashboard_case_items(case_id,kind,assignee_id,assignee,status,created_at,assigned_at,linked) values(?,'ALERT',?,'l1a','OPEN',?::timestamptz,?::timestamptz,false)",
        id,
        l1,
        assignedAt,
        assignedAt);
  }

  /**
   * 의심 비율 2배(60점), 고위험 비중 1배(20점), 신규 Alert 3배(100점), 적체 25%(50점) → (30·60+25·20+25·100+20·50)/100
   * = 58점 경계.
   */
  void fixture() {
    for (int d = 1; d <= 9; d++) {
      String day = "2023-09-0" + d;
      model(day, false, 980);
      model(day, true, 20);
      score(day, 95, 10);
      score(day, 50, 90);
    }
    model("2023-09-10", false, 960);
    model("2023-09-10", true, 40);
    score("2023-09-10", 95, 10);
    score("2023-09-10", 50, 90);
    for (int d = 4; d <= 10; d++) alerts("2023-09-" + (d < 10 ? "0" + d : d) + "T01:00:00Z", 2);
    alerts("2023-09-11T01:00:00Z", 6);
    openAlert(1, "2023-09-05T00:00:00Z");
    openAlert(2, "2023-09-10T00:00:00Z");
    openAlert(3, "2023-09-10T00:00:00Z");
    openAlert(4, "2023-09-11T00:00:00Z");
  }

  Map<String, Object> dashboard() throws Exception {
    return object(
        mvc.perform(get("/api/v1/ai-summary/dashboard").session(session))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8));
  }

  @Test
  void dashboard_index_is_computed_from_aggregates_and_explained() throws Exception {
    fixture();
    when(writer.write(any()))
        .thenReturn(
            Optional.of(
                new AiSummaryService.Written(
                    "종합 위험지수 58점으로 경계 단계임",
                    List.of(
                        new AiSummaryService.Point("오늘 생성 Alert가 평소의 3.00배임", List.of("F4"))))));
    var body = dashboard();
    var index = object(body.get("index"));
    assertThat(index.get("score")).isEqualTo(58);
    assertThat(index.get("level")).isEqualTo("경계");
    assertThat(index.get("latestTxDate")).isEqualTo("2023-09-10");
    assertThat(rows(index.get("indicators")))
        .extracting(i -> i.get("key") + "=" + i.get("score"))
        .containsExactly("suspiciousRate=60", "highRiskShare=20", "newAlerts=100", "backlog=50");
    assertThat(body.get("headline")).isEqualTo("종합 위험지수 58점으로 경계 단계임");
    var facts = rows(body.get("facts")).stream().map(f -> f.get("text").toString()).toList();
    assertThat(facts.getFirst()).isEqualTo("종합 위험지수 58점, 단계 경계");
    assertThat(facts).anyMatch(f -> f.startsWith("최근 거래일 2023-09-10 의심 거래 유형별 건수: Fan-in 40건"));
    // 같은 집계면 다시 부르지 않는다
    dashboard();
    verify(writer, times(1)).write(any());
  }

  @Test
  void index_is_returned_even_when_the_writer_fails() throws Exception {
    fixture();
    when(writer.write(any())).thenReturn(Optional.empty());
    var body = dashboard();
    assertThat(object(body.get("index")).get("score")).isEqualTo(58);
    assertThat(body.get("headline")).isNull();
    assertThat(rows(body.get("points"))).isEmpty();
  }

  @Test
  void indicators_without_a_baseline_are_left_out_of_the_index() throws Exception {
    // 첫날: 기준선이 없어 의심 비율·고위험·신규 Alert 는 빠지고 적체만 남는다
    model("2023-09-10", true, 5);
    score("2023-09-10", 95, 5);
    openAlert(1, "2023-09-05T00:00:00Z");
    openAlert(2, "2023-09-10T00:00:00Z");
    when(writer.write(any())).thenReturn(Optional.empty());
    var index = object(dashboard().get("index"));
    assertThat(index.get("score")).isEqualTo(100);
    assertThat(rows(index.get("indicators")))
        .extracting(i -> i.get("key") + "=" + i.get("score"))
        .containsExactly(
            "suspiciousRate=null", "highRiskShare=null", "newAlerts=null", "backlog=100");
  }
}
