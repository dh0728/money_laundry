package com.moneylaundry.api.ai;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.review.CaseSummaryStore;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** 법정 STR 작성을 위한 분석 보고서 API. Claude 대신 대역 Writer 로 생성·저장·재사용·권한·실패를 실제 DB 에서 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AiReportApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean AiReportService.Writer writer;
  MockHttpSession session;
  String token;
  long l1;
  UUID run;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-02T00:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a','l1b','admin')",
        encoder.encode("Test-password-123"));
    l1 = jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED','2023-09-02',.7,'COMPLETE',now(),now()) returning job_id",
            Long.class);
    run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status) values(?,?,1,'COMPLETED')",
        run,
        job);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
    when(writer.model()).thenReturn("test-model");
  }

  /** 씨앗 2건과 주변 거래 1건을 가진 l1a 담당의 공개 Alert. */
  long alert() {
    long id =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,'2023-09-02T00:00:00Z','2023-09-02T00:00:00Z') returning alert_id",
            Long.class,
            l1);
    jdbc.update("insert into core.banks(bank_id) values(999998) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),gen_random_uuid()::text) returning owner_id",
            Long.class);
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,owner_id) values(999998,?) returning account_id",
            Long.class,
            owner);
    var items = new ArrayList<Map<String, Object>>();
    for (long tx = 1; tx <= 3; tx++) {
      var t = new LinkedHashMap<String, Object>();
      t.put("txId", tx);
      t.put("role", tx == 3 ? "CONTEXT" : "SEED");
      t.put("occurredAt", "2023-09-01T0" + tx + ":00:00Z");
      t.put("fromAccountId", "S1");
      t.put("toAccountId", "SHARED");
      t.put("amountPaid", 100);
      t.put("amountReceived", 100);
      t.put("paymentCurrency", "USD");
      t.put("receivingCurrency", "USD");
      t.put("paymentFormat", "ACH");
      t.put("scores", Map.of("p_laundering", .9, "p_0", .1, "p_1", .9));
      items.add(t);
      jdbc.update(
          "insert into ledger.transactions(tx_id,occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) overriding system value values(?,'2023-09-01',?,?,100,'USD',100,'USD','ACH',100,'fx_rates_usd_v1','2023-09-01')",
          tx,
          account,
          account);
    }
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,repeat('f',64),?::jsonb,now())",
        id,
        run,
        encode(Map.of("transactions", items, "seeds", List.of())));
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", id);
    for (var item : items)
      jdbc.update(
          "insert into review.alert_transactions(alert_id,version,tx_id,role,reasons,seed_risk) values(?,1,?,?,'[]',?)",
          id,
          item.get("txId"),
          item.get("role"),
          "SEED".equals(item.get("role")) ? .9 : null);
    new CaseSummaryStore(jdbc).refresh(id);
    return id;
  }

  void login(String username) throws Exception {
    session = new MockHttpSession();
    csrf();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", username)
                .param("password", "Test-password-123"))
        .andExpect(status().isOk());
    csrf();
  }

  void csrf() throws Exception {
    token =
        object(
                mvc.perform(get("/api/auth/csrf").session(session))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("token")
            .toString();
  }

  /** l1a 로 Alert 를 처리 중으로 바꾸고 판정해 판정 번호를 돌려준다. */
  long judge(long alert, String verdict) throws Exception {
    login("l1a");
    mvc.perform(
            post("/api/v1/review/cases/" + alert + "/start")
                .session(session)
                .header("X-CSRF-TOKEN", token))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/review/cases/" + alert + "/judgment")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    encode(
                        Map.of(
                            "verdict", verdict,
                            "reasonCategory", "pattern",
                            "rationale", "단기 집중 후 유출",
                            "observations", "같은 계좌로 모임"))))
        .andExpect(status().isOk());
    return jdbc.queryForObject(
        "select judgment_id from review.judgments where alert_id=?", Long.class, alert);
  }

  ResultActions report(long judgment, boolean regenerate) throws Exception {
    return mvc.perform(
        post("/api/v1/ai-reports/judgments/" + judgment + (regenerate ? "?regenerate=true" : ""))
            .session(session)
            .header("X-CSRF-TOKEN", token));
  }

  Map<String, Object> body(ResultActions actions) throws Exception {
    return object(actions.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  static AiReportService.Sentence s(String text, String source) {
    return new AiReportService.Sentence(text, List.of(source));
  }

  static AiReportService.Narrative narrative() {
    return new AiReportService.Narrative(
        List.of(s("근거 거래 2건에서 자금이 한 계좌로 집중됨", "F2")),
        List.of(),
        List.of(),
        List.of(),
        List.of(s("결제 수단은 ACH임", "F2")),
        List.of(),
        List.of(s("담당자 판단: 단기 집중 후 유출로 판단함", "F2")),
        List.of(s("거래자 신원 확인이 필요함", "F2")));
  }

  @Test
  void assignee_generates_once_reuses_and_regenerates() throws Exception {
    long judgment = judge(alert(), "SUSPICIOUS");
    when(writer.write(any())).thenReturn(Optional.of(narrative()));
    var first = body(report(judgment, false).andExpect(status().isOk()));
    assertThat(first.get("status")).isEqualTo("GENERATED");
    assertThat(first.get("kind")).isEqualTo("ALERT");
    var facts = rows(first.get("facts")).stream().map(f -> f.get("text").toString()).toList();
    assertThat(facts).contains("담당자 판정: 의심, 사유 분류 '패턴 일치'", "담당자 판단 근거: 단기 집중 후 유출");
    assertThat(facts).contains("담당자 관찰 내용: 같은 계좌로 모임");
    var narrative = object(first.get("narrative"));
    assertThat(rows(narrative.get("overview"))).hasSize(1);
    assertThat(rows(narrative.get("grounds"))).hasSize(1);
    assertThat((List<?>) first.get("needsBankCheck")).hasSize(4);
    // 저장된 보고서를 다시 쓴다
    var again = body(report(judgment, false).andExpect(status().isOk()));
    assertThat(again.get("reportId")).isEqualTo(first.get("reportId"));
    verify(writer, times(1)).write(any());
    // 다시 만들면 새 줄을 쌓는다
    var regenerated = body(report(judgment, true).andExpect(status().isOk()));
    assertThat(number(regenerated.get("reportId"))).isGreaterThan(number(first.get("reportId")));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.ai_reports where judgment_id=?", Long.class, judgment))
        .isEqualTo(2);
  }

  @Test
  void suspicious_judgment_builds_the_report_in_the_background_and_download_waits_for_it()
      throws Exception {
    when(writer.available()).thenReturn(true);
    // 뒤의 생성이 끝나기 전에 다운로드가 들어오도록 늦게 답한다
    when(writer.write(any()))
        .thenAnswer(
            i -> {
              Thread.sleep(1500);
              return Optional.of(narrative());
            });
    long judgment = judge(alert(), "SUSPICIOUS");
    var report = body(report(judgment, false).andExpect(status().isOk()));
    assertThat(report.get("status")).isEqualTo("GENERATED");
    verify(writer, times(1)).write(any());
    assertThat(
            jdbc.queryForList(
                "select status from review.ai_reports where judgment_id=?", String.class, judgment))
        .containsExactly("GENERATED");
    // 정상 판정은 뒤에서 만들지 않는다
    jdbc.execute("truncate review.alerts,ledger.transactions,core.owners cascade");
    judge(alert(), "NORMAL");
    Thread.sleep(300);
    verify(writer, times(1)).write(any());
  }

  @Test
  void background_report_is_stored_without_any_download() throws Exception {
    when(writer.available()).thenReturn(true);
    when(writer.write(any())).thenReturn(Optional.of(narrative()));
    long judgment = judge(alert(), "SUSPICIOUS");
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
    long count = 0;
    while (System.nanoTime() < deadline
        && (count =
                jdbc.queryForObject(
                    "select count(*) from review.ai_reports where judgment_id=? and status='GENERATED'",
                    Long.class,
                    judgment))
            == 0) Thread.sleep(100);
    assertThat(count).isEqualTo(1);
  }

  @Test
  void failed_or_unusable_writer_output_is_stored_as_failed_and_answers_503() throws Exception {
    long judgment = judge(alert(), "SUSPICIOUS");
    when(writer.write(any())).thenReturn(Optional.empty());
    assertThat(body(report(judgment, false).andExpect(status().isServiceUnavailable())).get("code"))
        .isEqualTo("AI_REPORT_UNAVAILABLE");
    // 사실 목록에 없는 숫자만 쓴 서술은 버린다
    when(writer.write(any()))
        .thenReturn(
            Optional.of(
                new AiReportService.Narrative(
                    List.of(s("거래 999건", "F2")),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(),
                    List.of(s("거래 999건", "F2")),
                    List.of())));
    report(judgment, false).andExpect(status().isServiceUnavailable());
    assertThat(
            jdbc.queryForList(
                "select status from review.ai_reports where judgment_id=? order by report_id",
                String.class,
                judgment))
        .containsExactly("FAILED", "FAILED");
  }

  @Test
  void normal_judgments_are_refused_and_only_assignee_or_admin_can_read() throws Exception {
    long normal = judge(alert(), "NORMAL");
    report(normal, false).andExpect(status().isConflict());
    jdbc.execute("truncate review.alerts,ledger.transactions,core.owners cascade");
    long suspicious = judge(alert(), "SUSPICIOUS");
    when(writer.write(any())).thenReturn(Optional.of(narrative()));
    login("l1b");
    report(suspicious, false).andExpect(status().isForbidden());
    login("admin");
    report(suspicious, false).andExpect(status().isOk());
    report(987654321L, false).andExpect(status().isNotFound());
  }
}
