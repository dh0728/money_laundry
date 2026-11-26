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

/** Alert · Episode AI 요약 API. Claude 대신 대역 Writer 를 두고, 사실 목록·검사·캐시·실패 응답을 실제 DB 로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AiSummaryApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean AiSummaryService.Writer writer;
  MockHttpSession session;
  String token;
  long l1;
  UUID run;

  @BeforeEach
  void setup() throws Exception {
    jdbc.execute(
        "truncate review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-02T00:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a')",
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
    session = new MockHttpSession();
  }

  /** 씨앗 2건과 주변 거래 1건을 가진 공개 Alert. 송금 계좌는 Alert 마다, 수취 계좌 shared 는 모두 같다. */
  long alert(long first, long shared) {
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
    long sender =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,owner_id) values(999998,?) returning account_id",
            Long.class,
            owner);
    var items = new ArrayList<Map<String, Object>>();
    for (long tx = first; tx < first + 3; tx++) {
      var t = new LinkedHashMap<String, Object>();
      t.put("txId", tx);
      t.put("role", tx == first + 2 ? "CONTEXT" : "SEED");
      t.put("occurredAt", "2023-09-01T0" + (tx - first) + ":00:00Z");
      t.put("fromAccountId", "S" + first);
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
          sender,
          shared);
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

  long sharedAccount() {
    jdbc.update("insert into core.banks(bank_id) values(999998) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),gen_random_uuid()::text) returning owner_id",
            Long.class);
    return jdbc.queryForObject(
        "insert into core.accounts(bank_id,owner_id) values(999998,?) returning account_id",
        Long.class,
        owner);
  }

  void login() throws Exception {
    csrf();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", "l1a")
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

  Map<String, Object> summary(long id, int status) throws Exception {
    return object(
        mvc.perform(get("/api/v1/ai-summary/cases/" + id).session(session))
            .andExpect(status().is(status))
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8));
  }

  static AiSummaryService.Written written(String headline, String text, String source) {
    return new AiSummaryService.Written(
        headline, List.of(new AiSummaryService.Point(text, List.of(source))));
  }

  @Test
  void alert_summary_is_built_from_facts_checked_and_cached() throws Exception {
    long a = alert(1, sharedAccount());
    when(writer.write(any()))
        .thenReturn(Optional.of(written("씨앗 거래 2건이 근거임", "근거 거래가 한 계좌로 모임", "F2")));
    login();
    var body = summary(a, 200);
    assertThat(body.get("kind")).isEqualTo("ALERT");
    assertThat(body.get("headline")).isEqualTo("씨앗 거래 2건이 근거임");
    assertThat(rows(body.get("points"))).hasSize(1);
    var facts = rows(body.get("facts")).stream().map(f -> f.get("text").toString()).toList();
    assertThat(facts.getFirst()).isEqualTo("Alert " + a + ", 상태 처리 중");
    assertThat(facts).anyMatch(f -> f.startsWith("근거 거래 ") && f.contains("씨앗 거래 2건"));
    assertThat(facts).anyMatch(f -> f.startsWith("씨앗 거래 최고 모델 점수 0.900"));
    // 같은 사실 목록이면 다시 부르지 않는다
    summary(a, 200);
    verify(writer, times(1)).write(any());
  }

  @Test
  void episode_summary_lists_member_alerts_and_shared_accounts() throws Exception {
    long shared = sharedAccount();
    long a = alert(1, shared), b = alert(11, shared);
    login();
    long episode =
        number(
            object(
                    mvc.perform(
                            post("/api/v1/review/episodes")
                                .session(session)
                                .header("X-CSRF-TOKEN", token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                    encode(Map.of("alertIds", List.of(a, b), "reason", "같은 흐름"))))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString())
                .get("episodeId"));
    when(writer.write(any()))
        .thenReturn(Optional.of(written("소속 Alert 2건이 한 계좌로 이어짐", "같은 수취 계좌가 나옴", "F3")));
    var body = summary(episode, 200);
    assertThat(body.get("kind")).isEqualTo("EPISODE");
    var facts = rows(body.get("facts")).stream().map(f -> f.get("text").toString()).toList();
    assertThat(facts).contains("소속 Alert 2건");
    assertThat(facts).anyMatch(f -> f.startsWith("소속 Alert " + a + ": 근거 거래 "));
    String code =
        jdbc.queryForObject(
            "select service_account_id from core.accounts where account_id=?",
            String.class,
            shared);
    assertThat(facts).contains("계좌 " + code + "가 Alert " + a + ", " + b + "에 함께 나옴");
  }

  @Test
  void unusable_or_missing_writer_output_is_503_and_not_cached() throws Exception {
    long a = alert(1, sharedAccount());
    login();
    when(writer.write(any())).thenReturn(Optional.empty());
    assertThat(summary(a, 503).get("code")).isEqualTo("AI_SUMMARY_UNAVAILABLE");
    // 사실 목록에 없는 숫자만 쓴 요약은 버린다
    when(writer.write(any())).thenReturn(Optional.of(written("거래 999건", "거래 999건", "F2")));
    assertThat(summary(a, 503).get("code")).isEqualTo("AI_SUMMARY_UNAVAILABLE");
    verify(writer, times(2)).write(any());
  }

  @Test
  void unknown_case_is_404_and_login_is_required() throws Exception {
    mvc.perform(get("/api/v1/ai-summary/cases/1").session(session))
        .andExpect(status().isUnauthorized());
    login();
    summary(987654321L, 404);
    verifyNoInteractions(writer);
  }
}
