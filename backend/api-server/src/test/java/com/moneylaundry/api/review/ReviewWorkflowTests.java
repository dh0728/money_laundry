package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.*;
import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class ReviewWorkflowTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @MockitoBean AnalysisScheduler scheduler;
  ReviewService service;
  BusinessTime clock;
  AlertQueryService evidence;
  long l1, l2, other;
  UUID run;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate alerts,batch_jobs,review_cases,review_requests cascade");
    jdbc.update("update demo_business_clock set business_at=null,revision=0");
    jdbc.update("update users set last_assigned_at=null");
    l1 = jdbc.queryForObject("select user_id from users where username='l1a'", Long.class);
    other = jdbc.queryForObject("select user_id from users where username='l1b'", Long.class);
    l2 = jdbc.queryForObject("select user_id from users where username='l2a'", Long.class);
    clock =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "local"));
    clock.set(Instant.parse("2023-09-02T00:00:00Z"), 0);
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,threshold_value) values('ANALYSIS','COMPLETED','2023-09-02',.7) returning job_id",
            Long.class);
    run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,input_revision,status) values(?,?,1,'COMPLETED')",
        run,
        job);
    evidence = mock(AlertQueryService.class);
    service = new ReviewService(jdbc, tx, clock, evidence);
  }

  long alert(long owner) {
    long id =
        jdbc.queryForObject(
            "insert into alerts(assignee_id) values(?) returning alert_id", Long.class, owner);
    var items = new ArrayList<Map<String, Object>>();
    for (int i = 1; i <= 3; i++) {
      var t = new LinkedHashMap<String, Object>();
      t.put("txId", (long) i);
      t.put("role", i == 3 ? "CONTEXT" : "SEED");
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
    when(evidence.detail(id, null))
        .thenReturn(Map.of("runId", run.toString(), "version", 1, "transactions", items));
    return jdbc.queryForObject("select case_id from review_cases where alert_id=?", Long.class, id);
  }

  ReviewService.Selection select(long id, long... txIds) {
    var d = service.detail(id);
    var g = rows(d.get("groups")).getFirst();
    return new ReviewService.Selection(
        id,
        number(d.get("revision")),
        number(g.get("groupId")),
        Arrays.stream(txIds).boxed().toList());
  }

  Map<String, Object> act(
      long user, String action, String decision, ReviewService.Selection... selections) {
    return service.command(
        user,
        new ReviewService.Command(
            UUID.randomUUID(), action, List.of(selections), null, null, null, decision, "검토 근거"));
  }

  @Test
  void published_evidence_uses_real_query_for_list_and_review() {
    long id = alert(l1);
    long alertId = number(service.detail(id).get("alertId"));
    var doc = object(encode(evidence.detail(alertId, null)));
    doc.put("policyVersion", "calendar-event-v4");
    doc.put("summary", Map.of("scoreMax", .9, "txCount", 3));
    doc.put(
        "seeds",
        List.of(
            Map.of("txId", 1, "score", .9, "threshold", .7),
            Map.of("txId", 2, "score", .9, "threshold", .7)));
    jdbc.update(
        "insert into alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,?,?::jsonb)",
        alertId,
        run,
        "a".repeat(64),
        encode(doc));
    var actual = new ReviewService(jdbc, tx, clock, new AlertQueryService(jdbc, ReviewJson.JSON));
    var page =
        actual.list("ALERT", "OPEN", l1, LocalDate.of(2023, 9, 2), LocalDate.of(2023, 9, 2), 0, 20);
    assertThat(page.get("totalElements")).isEqualTo(1L);
    assertThat(object(rows(page.get("content")).getFirst().get("summary")).get("riskScore"))
        .isEqualTo(.9);
    var d = actual.detail(id);
    actual.command(
        l1,
        new ReviewService.Command(
            UUID.randomUUID(),
            "DECIDE",
            List.of(new ReviewService.Selection(id, number(d.get("revision")), 0, List.of(1L, 2L))),
            null,
            null,
            null,
            "NORMAL",
            "공개 근거 확인"));
    assertThat(actual.detail(id).get("pendingCount")).isEqualTo(0L);
    assertThat(
            jdbc.queryForObject(
                "select evidence->'transactions'->0->>'role' from alert_versions where alert_id=?",
                String.class,
                alertId))
        .isEqualTo("SEED");
  }

  @Test
  void partial_transfer_preserves_context_and_closing_requires_remaining_decision() {
    long id = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(id, 1, 3)).get("targetCaseId"));
    assertThat(service.detail(id).get("pendingCount")).isEqualTo(1L);
    assertThatThrownBy(() -> act(l1, "CLOSE", null, select(id))).isInstanceOf(ApiException.class);
    act(l1, "DECIDE", "NORMAL", select(id, 2));
    act(l1, "CLOSE", null, select(id));
    assertThat(service.detail(id).get("outcome")).isEqualTo("MIXED");
    act(l2, "DECIDE", "SUSPICIOUS", select(ep, 1));
    act(l2, "CLOSE", null, select(ep));
    var members = rows(rows(service.detail(ep).get("groups")).getFirst().get("members"));
    assertThat(
            members.stream()
                .filter(m -> number(m.get("txId")) == 3)
                .findFirst()
                .orElseThrow()
                .get("decision"))
        .isNull();
    assertThat(service.detail(ep).get("outcome")).isEqualTo("SUSPICIOUS");
    assertThatThrownBy(() -> act(l2, "EXCLUDE", null, select(ep, 3)))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void multiple_transfer_is_atomic_and_retries_are_idempotent() {
    long a = alert(l1), b = alert(other);
    var request =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a, 1), select(b, 1)),
            null,
            null,
            null,
            null,
            "묶음 조사");
    assertThatThrownBy(() -> service.command(l1, request)).isInstanceOf(ApiException.class);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_cases where kind='EPISODE'", Integer.class))
        .isZero();
    assertThat(service.detail(a).get("revision")).isEqualTo(1L);
    var ok =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a, 1, 2, 3)),
            null,
            null,
            null,
            null,
            "묶음 조사");
    var first = service.command(l1, ok);
    var second = service.command(l1, ok);
    assertThat(number(first.get("targetCaseId"))).isEqualTo(number(second.get("targetCaseId")));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_cases where kind='EPISODE'", Integer.class))
        .isEqualTo(1);
    assertThatThrownBy(
            () ->
                service.command(
                    l1,
                    new ReviewService.Command(
                        ok.requestId(),
                        "EXCLUDE",
                        ok.selections(),
                        null,
                        null,
                        null,
                        null,
                        "다른 내용")))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void stale_revision_and_foreign_scope_rejected() {
    long id = alert(l1);
    var stale = select(id, 2);
    act(l1, "DECIDE", "NORMAL", select(id, 1));
    assertThatThrownBy(() -> act(l1, "EXCLUDE", null, stale)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l1, "EXCLUDE", null, select(id, 999)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(other, "EXCLUDE", null, select(id, 2)))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void business_clock_persists_and_blocks_backward_or_busy_changes() {
    clock.set(Instant.parse("2023-09-03T00:00:00Z"), 1);
    assertThat(clock.now()).isEqualTo(Instant.parse("2023-09-03T00:00:00Z"));
    assertThatThrownBy(() -> clock.set(Instant.parse("2023-09-02T00:00:00Z"), 2))
        .isInstanceOf(ApiException.class);
    jdbc.update("insert into batch_jobs(job_type,status) values('INGEST','RUNNING')");
    assertThatThrownBy(() -> clock.set(Instant.parse("2023-09-04T00:00:00Z"), 2))
        .isInstanceOf(ApiException.class);
    assertThat(
            new BusinessTime(
                    jdbc,
                    tx,
                    new MockEnvironment().withProperty("spring.profiles.active", "local,prod"))
                .now())
        .isAfter(Instant.parse("2025-01-01T00:00:00Z"));
  }

  @Test
  void excluding_all_is_scope_clear_not_normal() {
    long id = alert(l1);
    act(l1, "EXCLUDE", null, select(id, 1, 2));
    act(l1, "CLOSE", null, select(id));
    assertThat(service.detail(id).get("outcome")).isEqualTo("SCOPE_CLEARED");
  }

  @Test
  void split_and_mixed_episode_decisions_preserve_original_transfer() {
    long id = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(id, 1, 2, 3)).get("targetCaseId"));
    act(l2, "SPLIT", null, select(ep, 2));
    var groups = rows(service.detail(ep).get("groups"));
    var second = groups.get(1);
    act(
        l2,
        "DECIDE",
        "NORMAL",
        new ReviewService.Selection(
            ep,
            number(service.detail(ep).get("revision")),
            number(second.get("groupId")),
            List.of(2L)));
    act(l2, "DECIDE", "SUSPICIOUS", select(ep, 1));
    act(l2, "CLOSE", null, select(ep));
    assertThat(service.detail(ep).get("outcome")).isEqualTo("SUSPICIOUS");
    assertThat(service.detail(id).get("pendingCount")).isEqualTo(0L);
    assertThat(rows(rows(service.detail(id).get("groups")).getFirst().get("members")))
        .allMatch(m -> "TRANSFERRED".equals(m.get("state")));
  }

  @Test
  void same_episode_move_and_empty_source_episode_can_be_closed_without_normal_verdict() {
    long id = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(id, 1, 2, 3)).get("targetCaseId"));
    act(l2, "SPLIT", null, select(ep, 2));
    long destGroup = number(rows(service.detail(ep).get("groups")).get(1).get("groupId"));
    var move =
        new ReviewService.Command(
            UUID.randomUUID(),
            "MOVE",
            List.of(select(ep, 1)),
            ep,
            number(service.detail(ep).get("revision")),
            destGroup,
            null,
            "같은 사건 묶음 통합");
    service.command(l2, move);
    var g = rows(service.detail(ep).get("groups")).get(1);
    var next =
        service.command(
            l2,
            new ReviewService.Command(
                UUID.randomUUID(),
                "MOVE",
                List.of(
                    new ReviewService.Selection(
                        ep,
                        number(service.detail(ep).get("revision")),
                        number(g.get("groupId")),
                        List.of(1L, 2L))),
                null,
                null,
                null,
                null,
                "사건 분리"));
    act(l2, "CLOSE", null, select(ep));
    assertThat(service.detail(ep).get("outcome")).isEqualTo("TRANSFERRED");
    assertThat(service.detail(number(next.get("targetCaseId"))).get("assigneeId")).isEqualTo(l2);
  }

  @Test
  void reconsideration_is_explicit_and_retains_prior_audit() {
    long id = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(id, 1, 2)).get("targetCaseId"));
    act(l2, "DECIDE", "NORMAL", select(ep, 1, 2));
    assertThatThrownBy(() -> act(l2, "SPLIT", null, select(ep, 1)))
        .isInstanceOf(ApiException.class);
    act(l2, "RECONSIDER", null, select(ep, 1));
    assertThat(service.detail(ep).get("pendingCount")).isEqualTo(2L);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_events where case_id=? and action='DECIDE' and snapshot::text like '%NORMAL%'",
                Integer.class, ep))
        .isEqualTo(1);
  }

  @Test
  void ledger_filters_show_unique_incoming_and_outgoing_without_private_or_label_fields() {
    jdbc.update("insert into banks(bank_id) values(999010) on conflict do nothing");
    String token = UUID.randomUUID().toString();
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(gen_random_uuid(),?,'hidden','hidden','test') returning entity_id",
            Long.class,
            token);
    long a =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999010,gen_random_uuid(),?,?, 'hidden','test') returning account_id",
            Long.class,
            token + "a",
            entity);
    long b =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999010,gen_random_uuid(),?,?, 'hidden','test') returning account_id",
            Long.class,
            token + "b",
            entity);
    for (int i = 0; i < 2; i++)
      jdbc.update(
          "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2023-08-31 15:00Z',?,?,10,'USD',10,'USD','ACH',10,'fx_rates_usd_v1','2023-09-01')",
          i == 0 ? a : b,
          i == 0 ? b : a);
    var query = new LedgerQueryService(jdbc);
    UUID owner =
        jdbc.queryForObject(
            "select service_entity_id from private.entities where entity_id=?", UUID.class, entity);
    UUID account =
        jdbc.queryForObject(
            "select service_account_id from private.accounts where account_id=?", UUID.class, a);
    var filter =
        new LedgerQueryService.Filter(
            LocalDate.parse("2023-09-01"),
            LocalDate.parse("2023-09-01"),
            owner,
            account,
            null,
            List.of("ACH"),
            0,
            20);
    var data = query.query("transactions", filter);
    assertThat(data.get("totalElements")).isEqualTo(2L);
    assertThat(encode(data)).doesNotContain("hidden", "is_laundering", "name_cipher");
    assertThat(query.query("owners", filter).get("totalElements")).isEqualTo(1L);
    assertThat(query.query("accounts", filter).get("totalElements")).isEqualTo(2L);
    assertThat(
            query
                .query(
                    "transactions",
                    new LedgerQueryService.Filter(
                        filter.from(), filter.to(), owner, account, List.of("NORMAL"), null, 0, 20))
                .get("totalElements"))
        .isEqualTo(0L);
    var d = new DashboardService(jdbc, clock).view(l1, filter.from(), filter.to());
    assertThat(object(d.get("detection")).get("received")).isEqualTo(2L);
    assertThat(object(d.get("detection")).get("analyzed")).isEqualTo(0L);
    assertThat(rows(d.get("daily")).getFirst().get("day").toString()).isEqualTo("2023-09-01");
  }

  @Test
  void money_scope_reads_nonmember_ledger_and_preserves_closed_snapshot() {
    // This test owns its isolated Testcontainers database.
    jdbc.execute("truncate bank_reporting_periods cascade");
    jdbc.update("insert into banks(bank_id) values(999011) on conflict do nothing");
    String token = UUID.randomUUID().toString();
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(gen_random_uuid(),?,'hidden','hidden','test') returning entity_id",
            Long.class,
            token);
    List<Long> internal = new ArrayList<>();
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 2; i++) {
      UUID uuid = UUID.randomUUID();
      ids.add(uuid);
      internal.add(
          jdbc.queryForObject(
              "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999011,?,?,?,'hidden','test') returning account_id",
              Long.class,
              uuid,
              token + i,
              entity));
    }
    jdbc.update(
        "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2023-09-01 00:00Z',?,?,100,'USD',100,'USD','ACH',100,'fx_rates_usd_v1','2023-09-01')",
        internal.get(0),
        internal.get(1));
    long id = alert(l1);
    long aid = number(service.detail(id).get("alertId"));
    for (var t : rows(evidence.detail(aid, null).get("transactions"))) {
      t.put("fromAccountId", ids.get(0).toString());
      t.put("toAccountId", ids.get(1).toString());
    }
    assertThat(service.money(id, 180).get("available")).isEqualTo(false);
    var request =
        new ReviewService.MoneyScope(
            UUID.randomUUID(),
            number(service.detail(id).get("revision")),
            List.of(ids.get(1)),
            "수취 계좌 중심 조사");
    assertThatThrownBy(() -> service.setMoneyScope(id, other, request))
        .isInstanceOf(ApiException.class);
    var saved = service.setMoneyScope(id, l1, request);
    assertThat(service.setMoneyScope(id, l1, request)).isEqualTo(object(encode(saved)));
    assertThatThrownBy(
            () ->
                service.setMoneyScope(
                    id,
                    l1,
                    new ReviewService.MoneyScope(
                        UUID.randomUUID(), request.revision(), List.of(), "오래된 화면")))
        .isInstanceOf(ApiException.class);
    jdbc.update(
        "insert into bank_reporting_periods(bank_id,effective_from_date,effective_to_date) values(999011,'2023-09-01','2023-09-01')");
    long upload =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,bank_id,business_date) values('INGEST','COMPLETED',999011,'2023-09-01') returning job_id",
            Long.class);
    long set =
        jdbc.queryForObject(
            "insert into report_sets(bank_id,business_date) values(999011,'2023-09-01') returning set_id",
            Long.class);
    long version =
        jdbc.queryForObject(
            "insert into report_versions(set_id,upload_id,version_no,received_at,stage_status) values(?,?,1,now(),'ACTIVE') returning version_id",
            Long.class,
            set,
            upload);
    jdbc.update("update report_sets set current_version_id=? where set_id=?", version, set);
    var metrics = service.money(id, 180);
    assertThat(metrics.get("available")).isEqualTo(true);
    assertThat(metrics.get("complete")).isEqualTo(true);
    assertThat(metrics.get("ledgerCount")).isEqualTo(1);
    assertThat(
            new java.math.BigDecimal(rows(metrics.get("external")).getFirst().get("in").toString()))
        .isEqualByComparingTo("100");
    assertThat(encode(metrics)).doesNotContain("hidden", "identity_cipher");
    act(l1, "DECIDE", "NORMAL", select(id, 1, 2));
    act(l1, "CLOSE", null, select(id));
    String frozen = encode(service.money(id, 180));
    jdbc.update(
        "update transactions set amount_received=999 where from_account_id=?", internal.get(0));
    assertThat(encode(service.money(id, 60))).isEqualTo(frozen);
    assertThatThrownBy(
            () ->
                service.setMoneyScope(
                    id,
                    l1,
                    new ReviewService.MoneyScope(
                        UUID.randomUUID(),
                        number(service.detail(id).get("revision")),
                        List.of(),
                        "종결 변경")))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void http_contract_serializes_clock_cases_and_validates_missing_actor() throws Exception {
    var controller =
        new ReviewController(
            service, new LedgerQueryService(jdbc), clock, new DashboardService(jdbc, clock));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new ApiExceptionHandler())
            .build();
    long id = alert(l1);
    mvc.perform(get("/api/v1/demo/clock"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessAt").value("2023-09-02T09:00+09:00"));
    mvc.perform(get("/api/v1/review/cases/" + id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.groups[0].members.length()").value(3));
    var cmd =
        new ReviewService.Command(
            UUID.randomUUID(), "DECIDE", List.of(select(id, 1)), null, null, null, "NORMAL", "확인");
    mvc.perform(
            post("/api/v1/review/commands").contentType("application/json").content(encode(cmd)))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/v1/review/commands")
                .header("X-Demo-User-Id", l1)
                .contentType("application/json")
                .content(encode(cmd)))
        .andExpect(status().isOk());
    mvc.perform(get("/api/v1/ledger/transactions").param("judgement", "BOGUS"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            get("/api/v1/dashboard")
                .header("X-Demo-User-Id", l1)
                .param("from", "2023-09-01")
                .param("to", "2023-09-02"))
        .andExpect(status().isOk());
  }

  @Test
  void simultaneous_writes_only_one_revision_wins() throws Exception {
    long id = alert(l1);
    var selection = select(id, 1);
    var start = new java.util.concurrent.CountDownLatch(1);
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      java.util.concurrent.Callable<Boolean> work =
          () -> {
            start.await();
            try {
              act(l1, "EXCLUDE", null, selection);
              return true;
            } catch (ApiException conflict) {
              return false;
            }
          };
      var a = pool.submit(work);
      var b = pool.submit(work);
      start.countDown();
      assertThat(List.of(a.get(), b.get())).containsExactlyInAnyOrder(true, false);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from review_events where case_id=?", Integer.class, id))
          .isEqualTo(1);
    }
  }

  @Test
  void later_evidence_invalidates_stale_selection_and_adds_new_pending_range() {
    long id = alert(l1);
    var stale = select(id, 1);
    long alertId = number(service.detail(id).get("alertId"));
    var old = object(encode(evidence.detail(alertId, null)));
    old.put("version", 2);
    var added = object(encode(rows(old.get("transactions")).getFirst()));
    added.put("txId", 4);
    rows(old.get("transactions")).add(added);
    when(evidence.detail(alertId, null)).thenReturn(old);
    assertThatThrownBy(() -> act(l1, "DECIDE", "NORMAL", stale)).isInstanceOf(ApiException.class);
    assertThat(service.detail(id).get("pendingCount")).isEqualTo(3L);
  }
}
