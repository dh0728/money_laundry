package com.moneylaundry.api.review;

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

/** 새 화면의 조사 흐름을 실제 로그인 세션과 HTTP 경로로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class ReviewWorkflowTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;
  long l1, other;
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
    other = jdbc.queryForObject("select user_id from core.users where username='l1b'", Long.class);
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
    session = new MockHttpSession();
  }

  /** 거래 3건(조사 대상 2건, 주변 거래 1건)을 가진 공개된 Alert. 거래 번호는 first부터 이어진다. */
  long alert(long owner, long first) {
    long id =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,'2023-09-02T00:00:00Z','2023-09-02T00:00:00Z') returning alert_id",
            Long.class,
            owner);
    var items = new ArrayList<Map<String, Object>>();
    for (long tx = first; tx < first + 3; tx++) {
      var t = new LinkedHashMap<String, Object>();
      t.put("txId", tx);
      t.put("role", tx == first + 2 ? "CONTEXT" : "SEED");
      t.put("occurredAt", "2023-09-01T00:00:00Z");
      t.put("fromAccountId", "a");
      t.put("toAccountId", "b");
      t.put("amountPaid", 100);
      t.put("amountReceived", 100);
      t.put("paymentCurrency", "USD");
      t.put("receivingCurrency", "USD");
      t.put("paymentFormat", "ACH");
      t.put("scores", Map.of("p_laundering", .9, "p_0", .1, "p_1", .9));
      items.add(t);
    }
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,repeat('f',64),?::jsonb,now())",
        id,
        run,
        encode(Map.of("transactions", items, "seeds", List.of())));
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", id);
    jdbc.update("insert into core.banks(bank_id) values(999998) on conflict do nothing");
    long owned =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),gen_random_uuid()::text) returning owner_id",
            Long.class);
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,owner_id) values(999998,?) returning account_id",
            Long.class,
            owned);
    for (var item : items) {
      jdbc.update(
          "insert into ledger.transactions(tx_id,occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) overriding system value values(?,'2023-09-01',?,?,100,'USD',100,'USD','ACH',100,'fx_rates_usd_v1','2023-09-01')",
          item.get("txId"),
          account,
          account);
      jdbc.update(
          "insert into review.alert_transactions(alert_id,version,tx_id,role,reasons,seed_risk) values(?,1,?,?,'[]',?)",
          id,
          item.get("txId"),
          item.get("role"),
          "SEED".equals(item.get("role")) ? .9 : null);
    }
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

  ResultActions send(String path, Object body) throws Exception {
    return mvc.perform(
        post("/api/v1/review" + path)
            .session(session)
            .header("X-CSRF-TOKEN", token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(encode(body)));
  }

  Map<String, Object> boardCase(long id) throws Exception {
    var board =
        object(
            mvc.perform(get("/api/v1/review/board").session(session))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    return rows(board.get("cases")).stream()
        .filter(c -> number(c.get("caseId")) == id)
        .findFirst()
        .orElseThrow();
  }

  List<Long> txIds(Map<String, Object> item) {
    return rows(item.get("members")).stream().map(m -> number(m.get("txId"))).toList();
  }

  Map<String, Object> judgment(String verdict) {
    return Map.of("verdict", verdict, "reasonCategory", "pattern", "rationale", "판정 사유");
  }

  @Test
  void alert_goes_from_unread_to_judged_once() throws Exception {
    long a = alert(l1, 1);
    login("l1b");
    send("/cases/" + a + "/read", Map.of()).andExpect(status().isOk());
    assertThat(boardCase(a).get("readAt")).isNull(); // 담당자가 아니면 열람 표시를 남기지 않는다.
    send("/cases/" + a + "/start", Map.of()).andExpect(status().isForbidden());

    login("l1a");
    send("/cases/" + a + "/read", Map.of()).andExpect(status().isOk());
    assertThat(boardCase(a).get("readAt")).isNotNull();
    assertThat(boardCase(a).get("reviewStartedAt")).isNull();
    send("/cases/" + a + "/judgment", judgment("SUSPICIOUS")).andExpect(status().isConflict());
    send("/cases/" + a + "/start", Map.of()).andExpect(status().isOk());
    assertThat(boardCase(a).get("reviewStartedAt")).isNotNull();
    send("/cases/" + a + "/judgment", Map.of("verdict", "SUSPICIOUS", "reasonCategory", "pattern"))
        .andExpect(status().isBadRequest()); // 판정 사유는 필수다.
    // 근거와 관찰 내용은 비워도 된다.
    send("/cases/" + a + "/judgment", judgment("SUSPICIOUS"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.startsWith("J-230902-")))
        .andExpect(jsonPath("$.evidence").value(""));
    var closed = boardCase(a);
    assertThat(closed.get("status")).isEqualTo("CLOSED");
    assertThat(closed.get("outcome")).isEqualTo("SUSPICIOUS");
    assertThat(object(closed.get("judgment")).get("reason")).isEqualTo("판정 사유");
    // 조사 대상 거래는 사건 판정을 따르고 주변 거래는 판정이 없다.
    assertThat(rows(closed.get("members")))
        .extracting(m -> m.get("decision"))
        .containsExactly("SUSPICIOUS", "SUSPICIOUS", null);
    send("/cases/" + a + "/judgment", judgment("NORMAL")).andExpect(status().isConflict());
    assertThat(jdbc.queryForObject("select count(*) from review.judgments", Long.class))
        .isEqualTo(1);
  }

  @Test
  void transactions_are_excluded_moved_and_moved_back() throws Exception {
    long a = alert(l1, 1), b = alert(l1, 11), foreign = alert(other, 21);
    login("l1a");
    send("/cases/" + a + "/transaction-edits", Map.of("txIds", List.of(1)))
        .andExpect(status().isBadRequest()); // 사유 필수
    send("/cases/" + foreign + "/transaction-edits", Map.of("txIds", List.of(21), "reason", "제외"))
        .andExpect(status().isForbidden());
    send(
            "/cases/" + a + "/transaction-edits",
            Map.of("txIds", List.of(1), "targetAlertId", foreign, "reason", "이동"))
        .andExpect(status().isForbidden()); // 직원은 자기 Alert로만 옮긴다.

    send("/cases/" + a + "/transaction-edits", Map.of("txIds", List.of(1), "reason", "무관한 거래"))
        .andExpect(status().isOk());
    assertThat(txIds(boardCase(a))).containsExactly(2L, 3L);
    send("/cases/" + a + "/transaction-edits", Map.of("txIds", List.of(1), "reason", "다시"))
        .andExpect(status().isConflict()); // 이미 빠진 거래

    send(
            "/cases/" + a + "/transaction-edits",
            Map.of("txIds", List.of(2), "targetAlertId", b, "reason", "같은 흐름"))
        .andExpect(status().isOk());
    assertThat(txIds(boardCase(a))).containsExactly(3L);
    assertThat(txIds(boardCase(b))).containsExactly(2L, 11L, 12L, 13L);
    assertThat(object(boardCase(b).get("summary")).get("txCount")).isEqualTo(4);
    assertThat(rows(boardCase(b).get("edits")))
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.get("action")).isEqualTo("MOVE");
              assertThat(number(e.get("sourceAlertId"))).isEqualTo(a);
              assertThat(e.get("reason")).isEqualTo("같은 흐름");
            });
    assertThat(rows(boardCase(a).get("edits"))).hasSize(2);

    // 옮겨 온 거래를 원래 Alert로 되돌리면 편집 기록이 사라진다.
    send(
            "/cases/" + b + "/transaction-edits",
            Map.of("txIds", List.of(2), "targetAlertId", a, "reason", "되돌림"))
        .andExpect(status().isOk());
    assertThat(txIds(boardCase(a))).containsExactly(2L, 3L);
    assertThat(txIds(boardCase(b))).containsExactly(11L, 12L, 13L);
    assertThat(jdbc.queryForObject("select count(*) from review.alert_tx_edits", Long.class))
        .isEqualTo(1);

    login("admin");
    send(
            "/cases/" + foreign + "/transaction-edits",
            Map.of("txIds", List.of(21), "reason", "관리자 제외"))
        .andExpect(status().isOk());
    assertThat(txIds(boardCase(foreign))).containsExactly(22L, 23L);
  }

  @Test
  void episode_is_created_extended_unlinked_and_dissolved() throws Exception {
    long a = alert(l1, 1), b = alert(l1, 11), c = alert(l1, 21), foreign = alert(other, 31);
    login("l1a");
    send("/episodes", Map.of("alertIds", List.of(a), "reason", "묶기"))
        .andExpect(status().isConflict());
    send("/episodes", Map.of("alertIds", List.of(a, foreign), "reason", "묶기"))
        .andExpect(status().isConflict());
    send("/cases/" + a + "/transaction-edits", Map.of("txIds", List.of(1), "reason", "제외"))
        .andExpect(status().isOk());
    long episode =
        number(
            object(
                    send("/episodes", Map.of("alertIds", List.of(a, b), "reason", "같은 자금 흐름"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString())
                .get("episodeId"));
    var created = boardCase(episode);
    assertThat(created.get("kind")).isEqualTo("EPISODE");
    assertThat(created.get("status")).isEqualTo("OPEN");
    assertThat(created.get("linkedAlertIds")).isEqualTo(List.of((int) a, (int) b));
    // Episode 거래는 묶인 Alert의 남은 거래를 모은 것이다. 제외한 거래는 들어오지 않는다.
    assertThat(txIds(created)).containsExactly(2L, 3L, 11L, 12L, 13L);
    var transferred = boardCase(a);
    assertThat(transferred.get("status")).isEqualTo("CLOSED");
    assertThat(transferred.get("outcome")).isEqualTo("TRANSFERRED");
    assertThat(number(transferred.get("episodeId"))).isEqualTo(episode);
    send("/cases/" + a + "/transaction-edits", Map.of("txIds", List.of(2), "reason", "제외"))
        .andExpect(status().isConflict());

    send("/episodes/" + episode + "/alerts", Map.of("alertIds", List.of(c), "reason", "편입"))
        .andExpect(status().isOk());
    assertThat(boardCase(episode).get("linkedAlertIds"))
        .isEqualTo(List.of((int) a, (int) b, (int) c));

    login("l1b");
    send("/episodes/" + episode + "/unlink", Map.of("alertIds", List.of(c), "reason", "해제"))
        .andExpect(status().isForbidden());
    login("l1a");
    send("/episodes/" + episode + "/unlink", Map.of("alertIds", List.of(c), "reason", "해제"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dissolved").value(false));
    assertThat(boardCase(c).get("status")).isEqualTo("OPEN");
    assertThat(boardCase(c).get("episodeId")).isNull();

    // 판정하면 묶인 Alert의 조사 대상 거래도 같은 판정을 따른다.
    send("/cases/" + episode + "/judgment", judgment("NORMAL")).andExpect(status().isOk());
    assertThat(boardCase(episode).get("outcome")).isEqualTo("NORMAL");
    assertThat(rows(boardCase(b).get("members")))
        .extracting(m -> m.get("decision"))
        .containsExactly("NORMAL", "NORMAL", null);
    send("/episodes/" + episode + "/unlink", Map.of("alertIds", List.of(a), "reason", "해제"))
        .andExpect(status().isConflict());
  }

  @Test
  void unlinking_below_two_alerts_dissolves_the_episode() throws Exception {
    long a = alert(l1, 1), b = alert(l1, 11);
    login("l1a");
    long episode =
        number(
            object(
                    send("/episodes", Map.of("alertIds", List.of(a, b), "reason", "묶기"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString())
                .get("episodeId"));
    send("/episodes/" + episode + "/unlink", Map.of("alertIds", List.of(a), "reason", "잘못 묶음"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dissolved").value(true));
    var dissolved = boardCase(episode);
    assertThat(dissolved.get("status")).isEqualTo("CLOSED");
    assertThat(dissolved.get("outcome")).isEqualTo("DISSOLVED");
    assertThat(dissolved.get("linkedAlertIds")).isEqualTo(List.of());
    for (long id : List.of(a, b)) {
      assertThat(boardCase(id).get("status")).isEqualTo("OPEN");
      assertThat(boardCase(id).get("episodeId")).isNull();
    }
  }

  ResultActions request(Object body) throws Exception {
    return send("/work-requests", body);
  }

  /** 지금 로그인한 사람에게 보이는 요청 가운데 가장 최근 것. */
  Map<String, Object> latestRequest() throws Exception {
    var body =
        object(
            mvc.perform(get("/api/v1/review/work-requests").session(session))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    assertThat(object(body.get("admin")).get("username")).isEqualTo("admin");
    assertThat(rows(body.get("staff"))).extracting(u -> u.get("username")).contains("l1a", "l1b");
    return rows(body.get("requests")).getFirst();
  }

  void judge(long a, String verdict) throws Exception {
    send("/cases/" + a + "/start", Map.of()).andExpect(status().isOk());
    send("/cases/" + a + "/judgment", judgment(verdict)).andExpect(status().isOk());
  }

  @Test
  void approved_reopen_request_opens_the_case_and_keeps_the_old_judgment() throws Exception {
    long a = alert(l1, 1);
    login("l1a");
    var reopen = Map.of("type", "reopen", "caseId", a, "reason", "판정 근거 재확인");
    request(reopen).andExpect(status().isConflict()); // 판정으로 닫힌 업무만 재검토를 요청한다.
    judge(a, "NORMAL");
    request(Map.of("type", "assign", "caseId", a, "reason", "x")).andExpect(status().isForbidden());
    request(reopen).andExpect(status().isOk());
    request(reopen).andExpect(status().isConflict()); // 같은 요청이 처리 대기 중이다.
    long id = number(latestRequest().get("id"));
    send("/work-requests/" + id + "/resolve", Map.of("action", "approved", "note", "승인"))
        .andExpect(status().isConflict()); // 받은 사람만 처리한다.

    login("l1b");
    assertThat(
            rows(
                object(
                        mvc.perform(get("/api/v1/review/work-requests").session(session))
                            .andReturn()
                            .getResponse()
                            .getContentAsString())
                    .get("requests")))
        .isEmpty(); // 관련 없는 직원에게는 보이지 않는다.

    login("admin");
    var received = latestRequest();
    assertThat(received.get("unreadFor")).isEqualTo(List.of("admin"));
    send("/work-requests/read", Map.of("ids", List.of(id))).andExpect(status().isOk());
    assertThat(latestRequest().get("unreadFor")).isEqualTo(List.of());
    send("/work-requests/" + id + "/resolve", Map.of("action", "approved"))
        .andExpect(status().isConflict()); // 처리 내용은 필수다.
    send(
            "/work-requests/" + id + "/resolve",
            Map.of("action", "approved", "note", "다시 확인하세요", "reviewStatus", "PENDING"))
        .andExpect(status().isOk());
    var approved = latestRequest();
    assertThat(approved.get("state")).isEqualTo("approved");
    assertThat(approved.get("unreadFor")).isEqualTo(List.of("l1a"));
    assertThat(approved.get("reviewStatus")).isEqualTo("PENDING");
    var before = object(approved.get("before"));
    assertThat(before.get("outcome")).isEqualTo("NORMAL");
    assertThat(object(before.get("judgment")).get("reason")).isEqualTo("판정 사유");

    login("l1a");
    var reopened = boardCase(a);
    assertThat(reopened.get("status")).isEqualTo("OPEN");
    assertThat(reopened.get("outcome")).isNull();
    assertThat(reopened.get("judgment")).isNull();
    assertThat(reopened.get("reviewStartedAt")).isNull();
    assertThat(rows(reopened.get("members")))
        .extracting(m -> m.get("state"))
        .containsOnly("PENDING");
    judge(a, "SUSPICIOUS");
    assertThat(boardCase(a).get("outcome")).isEqualTo("SUSPICIOUS");
    // 이전 판정은 기록으로 남는다.
    assertThat(
            jdbc.queryForList(
                "select verdict from review.judgments where alert_id=? order by judgment_id",
                String.class,
                a))
        .containsExactly("NORMAL", "SUSPICIOUS");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review.judgments where alert_id=? and superseded_at is null",
                Long.class,
                a))
        .isEqualTo(1);
  }

  @Test
  void case_with_a_followup_alert_is_not_reopened() throws Exception {
    long a = alert(l1, 1);
    long followup = alert(l1, 10);
    login("l1a");
    judge(a, "NORMAL");
    long event =
        jdbc.queryForObject(
            "select max(event_id) from review.events where alert_id=?", Long.class, a);
    jdbc.update("insert into review.alert_lineage values(?,?,'FOLLOWUP_OF',?)", followup, a, event);
    request(Map.of("type", "reopen", "caseId", a, "reason", "재확인")).andExpect(status().isOk());
    long id = number(latestRequest().get("id"));
    login("admin");
    send("/work-requests/" + id + "/resolve", Map.of("action", "approved", "note", "승인"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("후속 Alert")));
    assertThat(boardCase(a).get("status")).isEqualTo("CLOSED");
    assertThat(latestRequest().get("state")).isEqualTo("pending");
    request(
            Map.of(
                "type",
                "reviewAgain",
                "caseId",
                a,
                "recipient",
                "l1a",
                "reason",
                "재검토",
                "reviewStatus",
                "IN_PROGRESS"))
        .andExpect(status().isConflict());
    send("/work-requests/" + id + "/resolve", Map.of("action", "declined", "note", "후속 Alert에서"))
        .andExpect(status().isOk());
    assertThat(latestRequest().get("state")).isEqualTo("declined");
  }

  @Test
  void admin_orders_apply_at_once_and_staff_answers() throws Exception {
    long a = alert(l1, 1);
    login("admin");
    // 담당 변경: 새 담당자와 이전 담당자 모두에게 보인다.
    request(Map.of("type", "assign", "caseId", a, "recipient", "l1a", "reason", "재배정"))
        .andExpect(status().isConflict()); // 이미 담당자다.
    request(Map.of("type", "assign", "caseId", a, "recipient", "l1b", "reason", "재배정"))
        .andExpect(status().isOk());
    var assigned = latestRequest();
    assertThat(assigned.get("assignee")).isEqualTo("l1b");
    assertThat(object(assigned.get("before")).get("assignee")).isEqualTo("l1a");
    assertThat(assigned.get("unreadFor")).isEqualTo(List.of("l1b", "l1a"));
    assertThat(boardCase(a).get("assigneeUsername")).isEqualTo("l1b");
    // 처리 기한.
    request(Map.of("type", "deadline", "caseId", a, "recipient", "l1b", "reason", "기한"))
        .andExpect(status().isConflict()); // 기한 날짜가 필요하다.
    request(
            Map.of(
                "type",
                "deadline",
                "caseId",
                a,
                "recipient",
                "l1b",
                "reason",
                "기한",
                "deadline",
                "2023-09-10"))
        .andExpect(status().isOk());
    assertThat(boardCase(a).get("dueOn")).isEqualTo("2023-09-10");
    // 처리 상태.
    request(
            Map.of(
                "type",
                "changeStatus",
                "caseId",
                a,
                "recipient",
                "l1b",
                "reason",
                "착수",
                "reviewStatus",
                "PENDING"))
        .andExpect(status().isConflict()); // 이미 처리 전이다.
    request(
            Map.of(
                "type",
                "changeStatus",
                "caseId",
                a,
                "recipient",
                "l1b",
                "reason",
                "착수",
                "reviewStatus",
                "IN_PROGRESS"))
        .andExpect(status().isOk());
    assertThat(boardCase(a).get("reviewStartedAt")).isNotNull();
    long status = number(latestRequest().get("id"));
    send("/work-requests/" + status + "/resolve", Map.of("action", "cancelled"))
        .andExpect(status().isConflict()); // 이미 적용된 지시는 취소할 수 없다.
    // 효과 없는 지시는 보낸 사람이 취소할 수 있다.
    request(Map.of("type", "investigate", "caseId", a, "recipient", "l1b", "reason", "추가 조사"))
        .andExpect(status().isOk());
    long order = number(latestRequest().get("id"));
    send("/work-requests/" + order + "/resolve", Map.of("action", "cancelled"))
        .andExpect(status().isOk());
    request(Map.of("type", "evidence", "caseId", a, "recipient", "l1b", "reason", "근거 보완"))
        .andExpect(status().isOk());
    long evidence = number(latestRequest().get("id"));

    login("l1a"); // 이전 담당자는 담당 변경 알림만 본다.
    assertThat(latestRequest().get("type")).isEqualTo("assign");
    login("l1b");
    send("/work-requests/" + evidence + "/resolve", Map.of("action", "approved", "note", "x"))
        .andExpect(status().isConflict()); // 분석가는 처리 완료·협의 필요로 답한다.
    send("/work-requests/" + evidence + "/resolve", Map.of("action", "completed", "note", "보완함"))
        .andExpect(status().isOk());
    var done = latestRequest();
    assertThat(done.get("state")).isEqualTo("completed");
    assertThat(done.get("note")).isEqualTo("보완함");
    assertThat(done.get("unreadFor")).isEqualTo(List.of("admin"));
  }

  @Test
  void staff_requests_for_assignee_deadline_and_relation_review() throws Exception {
    long a = alert(l1, 1);
    long b = alert(other, 10);
    login("l1a");
    request(Map.of("type", "extension", "caseId", b, "reason", "x", "deadline", "2023-09-20"))
        .andExpect(status().isForbidden()); // 내 담당 업무만 요청한다.
    request(Map.of("type", "extension", "caseId", a, "reason", "연장", "deadline", "2023-09-20"))
        .andExpect(status().isOk());
    long extension = number(latestRequest().get("id"));
    request(Map.of("type", "changeAssignee", "caseId", a, "reason", "휴가"))
        .andExpect(status().isOk());
    long change = number(latestRequest().get("id"));
    var related =
        List.of(
            Map.of(
                "code", "A-230902-000002", "transactions", List.of("T-1"), "accounts", List.of()));
    // 연관 업무 검토는 다른 사람 담당 업무에도 요청할 수 있다.
    request(Map.of("type", "relationReview", "caseId", b, "reason", "x"))
        .andExpect(status().isConflict());
    request(Map.of("type", "relationReview", "caseId", b, "reason", "공통 거래", "related", related))
        .andExpect(status().isOk());
    request(Map.of("type", "relationReview", "caseId", b, "reason", "공통 거래", "related", related))
        .andExpect(status().isConflict());
    assertThat(rows(latestRequest().get("related")).getFirst().get("code"))
        .isEqualTo("A-230902-000002");

    login("admin");
    send("/work-requests/" + extension + "/resolve", Map.of("action", "approved", "note", "연장 승인"))
        .andExpect(status().isOk());
    assertThat(boardCase(a).get("dueOn")).isEqualTo("2023-09-20");
    send("/work-requests/" + change + "/resolve", Map.of("action", "approved", "note", "변경"))
        .andExpect(status().isConflict()); // 새 담당자가 필요하다.
    send(
            "/work-requests/" + change + "/resolve",
            Map.of("action", "approved", "note", "변경", "assignee", "l1b"))
        .andExpect(status().isOk());
    assertThat(boardCase(a).get("assigneeUsername")).isEqualTo("l1b");
    login("l1b"); // 새 담당자에게도 요청이 보인다.
    assertThat(latestRequest().get("assignee")).isEqualTo("l1b");
    send("/cases/" + a + "/start", Map.of()).andExpect(status().isOk());
  }
}
