package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 룰엔진 화면의 저장·승인 흐름과 백테스트를 실제 로그인 세션과 HTTP 경로로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RuleApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate review.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-02T00:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a','l1b','admin')",
        encoder.encode("Test-password-123"));
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

  ResultActions send(MockHttpServletRequestBuilder request, Object body) throws Exception {
    return mvc.perform(
        request
            .session(session)
            .header("X-CSRF-TOKEN", token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(encode(body)));
  }

  Map<String, Object> rule(
      Integer typeCode, double scoreMin, int minTransactions, int windowHours) {
    var rule = new LinkedHashMap<String, Object>();
    rule.put("name", "고위험 반복 송금");
    rule.put("description", "같은 계좌의 반복 송금 확인");
    rule.put("typeCode", typeCode);
    rule.put("scoreMin", scoreMin);
    rule.put("minTransactions", minTransactions);
    rule.put("windowHours", windowHours);
    return rule;
  }

  @Test
  void draft_is_saved_requested_and_decided_by_admin_only() throws Exception {
    login("l1a");
    var invalid = rule(null, 1.5, 1, 24);
    send(post("/api/v1/rules"), invalid).andExpect(status().isBadRequest());
    var created =
        object(
            send(post("/api/v1/rules"), rule(null, .7, 2, 24))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.history[0].action").value("초안 생성"))
                .andReturn()
                .getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    String code = created.get("id").toString();
    assertThat(code).matches("RULE-\\d{3,}");
    send(post("/api/v1/rules/" + code), rule(1, .8, 2, 24))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.version").value(2))
        .andExpect(jsonPath("$.typeCode").value(1));
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "TESTING", "reason", "승인"))
        .andExpect(status().isForbidden());
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "PENDING_APPROVAL"))
        .andExpect(status().isBadRequest()); // 사유 필수
    send(
            post("/api/v1/rules/" + code + "/review"),
            Map.of("status", "PENDING_APPROVAL", "reason", "검토 요청"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING_APPROVAL"));
    send(post("/api/v1/rules/" + code), rule(1, .8, 2, 24)).andExpect(status().isConflict());

    login("admin");
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "TESTING", "reason", "승인합니다"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("TESTING"))
        .andExpect(jsonPath("$.version").value(4))
        .andExpect(jsonPath("$.history[3].action").value("승인"))
        .andExpect(jsonPath("$.history[3].actor").value("관리자"));
    mvc.perform(get("/api/v1/rules").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(1));
  }

  String created() throws Exception {
    return object(
            send(post("/api/v1/rules"), rule(null, .7, 2, 24))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
        .get("id")
        .toString();
  }

  void review(String code, String status) throws Exception {
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", status, "reason", "사유"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value(status));
  }

  @Test
  void admin_stops_a_testing_rule_and_the_stopped_rule_can_be_edited_again() throws Exception {
    login("l1a");
    String code = created();
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "STOPPED", "reason", "중지"))
        .andExpect(status().isForbidden());
    review(code, "PENDING_APPROVAL");
    login("admin");
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "STOPPED", "reason", "중지"))
        .andExpect(status().isConflict()); // 승인 대기는 중지 대상이 아니다
    review(code, "TESTING");
    send(post("/api/v1/rules/" + code + "/review"), Map.of("status", "STOPPED", "reason", "오탐 증가"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("STOPPED"))
        .andExpect(jsonPath("$.history[3].action").value("중지"))
        .andExpect(jsonPath("$.history[3].reason").value("오탐 증가"));
    send(post("/api/v1/rules/" + code), rule(1, .8, 2, 24))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DRAFT"));
  }

  @Test
  void draft_is_deleted_by_its_author_or_admin_and_later_states_by_admin_only() throws Exception {
    login("l1a");
    String mine = created();
    String requested = created();
    String forAdmin = created();
    review(requested, "PENDING_APPROVAL");

    login("l1b");
    send(post("/api/v1/rules/" + mine + "/delete"), Map.of()).andExpect(status().isForbidden());

    login("l1a");
    send(post("/api/v1/rules/" + requested + "/delete"), Map.of())
        .andExpect(status().isForbidden());
    send(post("/api/v1/rules/" + mine + "/delete"), Map.of()).andExpect(status().isOk());
    send(post("/api/v1/rules/" + mine + "/delete"), Map.of()).andExpect(status().isNotFound());

    login("admin");
    send(post("/api/v1/rules/" + forAdmin + "/delete"), Map.of()).andExpect(status().isOk());
    review(requested, "REJECTED");
    login("l1a");
    send(post("/api/v1/rules/" + requested + "/delete"), Map.of()).andExpect(status().isOk());
    mvc.perform(get("/api/v1/rules").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
    assertThat(jdbc.queryForObject("select count(*) from review.rule_history", Long.class))
        .isZero();
  }

  @Test
  void backtest_counts_transactions_inside_the_account_window() throws Exception {
    jdbc.update("insert into core.banks(bank_id) values(999017) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'룰 소유자') returning owner_id",
            Long.class);
    var accounts = new ArrayList<Long>();
    for (int i = 0; i < 3; i++)
      accounts.add(
          jdbc.queryForObject(
              "insert into core.accounts(bank_id,owner_id) values(999017,?) returning account_id",
              Long.class,
              owner));
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED','2023-09-02',.7,'COMPLETE',now(),now()) returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status) values(?,?,1,'COMPLETED')",
        run,
        job);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
    // 계좌 0: 1시간 간격 고점수 2건과 30시간 뒤 1건. 계좌 1: 고점수 1건. 계좌 2: 저점수 2건.
    transfer(run, accounts.get(0), accounts.get(2), "2023-09-01 10:00+09", .9);
    transfer(run, accounts.get(0), accounts.get(2), "2023-09-01 11:00+09", .9);
    transfer(run, accounts.get(0), accounts.get(2), "2023-09-02 17:00+09", .9);
    transfer(run, accounts.get(1), accounts.get(2), "2023-09-01 10:00+09", .9);
    transfer(run, accounts.get(2), accounts.get(0), "2023-09-01 10:00+09", .1);
    transfer(run, accounts.get(2), accounts.get(0), "2023-09-01 10:30+09", .1);
    login("l1a");
    var body = new LinkedHashMap<String, Object>();
    body.put("rule", rule(null, .7, 2, 24));
    body.put("start", "2023-09-01");
    body.put("end", "2023-09-02");
    send(post("/api/v1/rules/backtest"), body)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.scannedCount").value(6))
        .andExpect(jsonPath("$.matchedCount").value(2))
        .andExpect(jsonPath("$.accountCount").value(1))
        .andExpect(jsonPath("$.amountUsd").value(20))
        .andExpect(jsonPath("$.matchedAccountIds.length()").value(1))
        .andExpect(jsonPath("$.transactions.length()").value(2));
    // 조건이 없으면 기간의 모든 거래가 대상이다.
    body.put("rule", rule(null, 0, 1, 24));
    send(post("/api/v1/rules/backtest"), body)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.matchedCount").value(6))
        .andExpect(jsonPath("$.accountCount").value(3));
    body.put("start", "2023-09-03");
    send(post("/api/v1/rules/backtest"), body).andExpect(status().isBadRequest());
  }

  void transfer(UUID run, long from, long to, String at, double score) {
    long tx =
        jdbc.queryForObject(
            "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::timestamptz,(?::timestamptz at time zone 'Asia/Seoul')::date,?,?,10,'USD',10,'USD','ACH',10,'test') returning tx_id",
            Long.class,
            at,
            at,
            from,
            to);
    jdbc.update(
        """
        insert into analysis.input_transactions
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
        a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
        t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version
        from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id join core.owners e on e.owner_id=a.owner_id
        join core.owners f on f.owner_id=b.owner_id where t.tx_id=?
        """,
        run,
        tx);
    jdbc.update(
        "insert into analysis.scores(run_id,tx_id,p_laundering) values(?,?,?)", run, tx, score);
    jdbc.update("insert into analysis.current_scores(tx_id,run_id) values(?,?)", tx, run);
  }
}
