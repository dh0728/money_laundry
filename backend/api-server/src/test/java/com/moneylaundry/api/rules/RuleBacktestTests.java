package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleEvaluator;
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
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 룰 평가기와 백테스트. 손으로 만든 작은 원장에 룰을 돌려 "이 조건이면 이 계좌가 걸린다 / 안 걸린다"를 확인하고, 백테스트를 실제 로그인 세션과 HTTP 경로로 접수해
 * 결과를 읽는다.
 */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RuleBacktestTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @Autowired PasswordEncoder encoder;
  @Autowired RuleCatalog catalog;
  @Autowired RuleEvaluator evaluator;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;
  long owner;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate rules.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-17T00:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a','admin')",
        encoder.encode("Test-password-123"));
    jdbc.update("insert into core.banks(bank_id) values(999017) on conflict do nothing");
    owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'룰 소유자') returning owner_id",
            Long.class);
  }

  // ---- 원장 만들기 ----

  long account() {
    return jdbc.queryForObject(
        "insert into core.accounts(bank_id,service_account_id,owner_id) values(999017,gen_random_uuid(),?) returning account_id",
        Long.class,
        owner);
  }

  /** from → to 로 usd 달러를 보낸 거래 한 건. at 은 "2023-09-09 10:00+09" 꼴이다. */
  long pay(long from, long to, String at, double usd) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::timestamptz,(?::timestamptz at time zone 'Asia/Seoul')::date,?,?,?,'USD',?,'USD','ACH',?,'test') returning tx_id",
        Long.class,
        at,
        at,
        from,
        to,
        usd,
        usd,
        usd);
  }

  /** 자기 계좌 안 환전: EUR 를 내고 usd 달러를 받는다. */
  void exchange(long account, String at, double usd) {
    jdbc.update(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::timestamptz,(?::timestamptz at time zone 'Asia/Seoul')::date,?,?,?,'USD',?,'EUR','ACH',?,'test')",
        at,
        at,
        account,
        account,
        usd,
        usd,
        usd);
  }

  /** from 이 서로 다른 새 계좌 count 개에 usd 달러씩 보낸다. 1분 간격이다. */
  List<Long> fanOut(long from, int count, String day, double usd) {
    var sent = new ArrayList<Long>();
    for (int i = 0; i < count; i++)
      sent.add(pay(from, account(), "%s 10:%02d+09".formatted(day, i), usd));
    return sent;
  }

  /** 룰을 2023-09-01 ~ 2023-09-30 의 원장에 돌려 대상 계좌 → 근거 거래(tx_id 순)를 돌려준다. */
  Map<Long, List<Long>> hits(RuleEvaluator engine, Map<String, Object> definition) {
    var found = new LinkedHashMap<Long, List<Long>>();
    tx.executeWithoutResult(
        s -> {
          engine.begin();
          engine.busy(null);
          engine.filtered(definition, "2023-09-01", "2023-09-30");
          engine.run(definition, "2023-09-01", "2023-09-30");
          for (var row :
              jdbc.queryForList(
                  "select distinct subject_id, x from rule_result cross join lateral unnest(tx_ids) x order by subject_id, x"))
            found
                .computeIfAbsent(number(row.get("subject_id")), key -> new ArrayList<>())
                .add(number(row.get("x")));
        });
    return found;
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> first(Map<String, Object> definition, String group) {
    return ((List<Map<String, Object>>) ((Map<String, Object>) definition.get(group)).get("items"))
        .get(0);
  }

  // ---- 평가기 ----

  @Test
  void fan_out_counts_only_filtered_transactions_inside_the_window() {
    var definition = catalog.defaults("FAN_OUT"); // 처음 거래하는 상대 AND 건당 ≥ 1,000 USD, 7일, 수취 계좌 ≥ 6
    long six = account();
    var evidence = fanOut(six, 6, "2023-09-09", 2000);
    pay(six, account(), "2023-09-09 11:00+09", 500); // 건당 금액 미달: 세지 않고 근거도 아니다
    long five = account();
    fanOut(five, 5, "2023-09-09", 2000);
    long repeat = account(); // 같은 상대에게 여섯 번: 처음 거래하는 상대는 첫 건뿐이다
    long same = account();
    for (int i = 0; i < 6; i++) pay(repeat, same, "2023-09-09 10:%02d+09".formatted(i), 2000);

    // 걸리는 것은 six 하나이고, 근거 거래는 세는 거래를 통과한 여섯 건뿐이다
    assertThat(hits(evaluator, definition)).isEqualTo(Map.of(six, evidence));

    // 기간은 검사 거래의 분을 포함해 직전 60분이다. 10:00 과 10:59 는 같은 기간, 10:00 과 11:00 은 아니다.
    definition.put("windowMinutes", 60);
    first(definition, "where").put("value", 2);
    long inside = account();
    pay(inside, account(), "2023-09-10 10:00+09", 2000);
    pay(inside, account(), "2023-09-10 10:59+09", 2000);
    long outside = account();
    pay(outside, account(), "2023-09-10 10:00+09", 2000);
    pay(outside, account(), "2023-09-10 11:00+09", 2000);
    assertThat(hits(evaluator, definition))
        .containsKeys(six, five, inside)
        .doesNotContainKey(outside);
  }

  @Test
  void fan_in_needs_an_exchange_in_the_same_minute_and_gather_scatter_needs_receipts_first() {
    // FAN-IN 기본값: 처음 거래하는 상대 AND 환전 직후 송금, 7일, 송금 계좌 ≥ 3
    long receiver = account();
    for (int i = 0; i < 3; i++) {
      long sender = account();
      String at = "2023-09-09 10:%02d+09".formatted(i);
      exchange(sender, at, 3000);
      pay(sender, receiver, at, 3000);
    }
    pay(account(), receiver, "2023-09-09 10:30+09", 3000); // 환전 없이 보낸 거래
    long plain = account();
    for (int i = 0; i < 3; i++) pay(account(), plain, "2023-09-09 10:%02d+09".formatted(i), 3000);
    var fanIn = hits(evaluator, catalog.defaults("FAN_IN"));
    assertThat(fanIn).containsOnlyKeys(receiver);
    assertThat(fanIn.get(receiver)).hasSize(3);

    // GATHER-SCATTER 기본값: 처음 거래하는 상대 AND 건당 ≥ 5,000 USD, 7일, 송금 계좌 ≥ 2 AND 첫 입금 뒤 수취 계좌 ≥ 2
    long hub = account();
    pay(account(), hub, "2023-09-11 10:00+09", 6000);
    pay(account(), hub, "2023-09-11 10:05+09", 6000);
    pay(hub, account(), "2023-09-11 11:00+09", 6000);
    pay(hub, account(), "2023-09-11 11:05+09", 6000);
    long reversed = account(); // 먼저 뿌리고 나중에 받았다: 첫 입금 뒤의 출금이 없다
    pay(reversed, account(), "2023-09-11 10:00+09", 6000);
    pay(reversed, account(), "2023-09-11 10:05+09", 6000);
    pay(account(), reversed, "2023-09-11 11:00+09", 6000);
    pay(account(), reversed, "2023-09-11 11:05+09", 6000);
    var gatherScatter = hits(evaluator, catalog.defaults("GATHER_SCATTER"));
    assertThat(gatherScatter).containsOnlyKeys(hub);
    assertThat(gatherScatter.get(hub)).hasSize(4);
  }

  @Test
  void busy_accounts_are_not_evaluated_as_subjects() {
    var definition = catalog.defaults("FAN_OUT");
    first(definition, "where").put("value", 2);
    long quiet = account();
    fanOut(quiet, 2, "2023-09-09", 2000);
    long busy = account();
    fanOut(busy, 4, "2023-09-09", 2000);

    // 72시간 안 같은 방향 거래가 3건을 넘으면 바쁜 계좌로 본다
    var strict = new RuleEvaluator(jdbc, 3, 4320);
    assertThat(hits(strict, definition)).containsOnlyKeys(quiet);
    tx.executeWithoutResult(
        s -> {
          strict.begin();
          assertThat(strict.busy(null)).containsExactly(busy);
          strict.filtered(definition, "2023-09-01", "2023-09-30");
          assertThat(strict.skippedBusySubjects(definition, "2023-09-01", "2023-09-30"))
              .isEqualTo(1L);
        });
    // 기준을 끄면(0) 전부 평가한다
    assertThat(hits(new RuleEvaluator(jdbc, 0, 4320), definition)).containsKeys(quiet, busy);
  }

  @Test
  void busy_accounts_are_counted_only_up_to_the_last_checked_day() {
    var definition = catalog.defaults("FAN_OUT");
    first(definition, "where").put("value", 2);
    long later = account();
    fanOut(later, 2, "2023-09-09", 2000);
    fanOut(later, 2, "2023-09-11", 2000); // 이틀 뒤 두 건이 더 생겨 72시간 안 네 건이 된다

    // 72시간 안 같은 방향 거래가 3건을 넘으면 바쁜 계좌로 본다
    var strict = new RuleEvaluator(jdbc, 3, 4320);
    tx.executeWithoutResult(
        s -> {
          strict.begin();
          // 09-09 까지의 거래로 세면 아직 두 건이라 바쁜 계좌가 아니고, 그날의 검사에서 걸린다
          assertThat(strict.busy(null, "2023-09-09")).isEmpty();
          strict.filtered(definition, "2023-09-09", "2023-09-09");
          strict.run(definition, "2023-09-09", "2023-09-09");
          assertThat(jdbc.queryForList("select subject_id from rule_result", Long.class))
              .containsExactly(later);
        });
    tx.executeWithoutResult(
        s -> {
          strict.begin();
          // 09-11 까지로 세면 바쁜 계좌다. 날짜를 안 주면 원장 전체로 센다
          assertThat(strict.busy(null, "2023-09-11")).containsExactly(later);
        });
    tx.executeWithoutResult(
        s -> {
          strict.begin();
          assertThat(strict.busy(null)).containsExactly(later);
        });
  }

  // ---- 백테스트 API ----

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
        post(path)
            .session(session)
            .header("X-CSRF-TOKEN", token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(encode(body)));
  }

  static Map<String, Object> json(ResultActions result) throws Exception {
    return object(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  /** 템플릿 기본값으로 룰을 만들고 {ruleId, versionId} 를 돌려준다. */
  long[] created(String name, String template) throws Exception {
    var created =
        json(
            send("/api/v1/rules", Map.of("name", name, "template", template))
                .andExpect(status().isOk()));
    return new long[] {number(created.get("ruleId")), number(created.get("versionId"))};
  }

  /** 백테스트를 접수하고 끝날 때까지 기다려 결과를 읽는다. */
  Map<String, Object> backtest(Map<String, Object> request) throws Exception {
    var accepted = json(send("/api/v1/rule-backtests", request).andExpect(status().isAccepted()));
    long id = number(accepted.get("backtestId"));
    for (int i = 0; i < 300; i++) {
      var view =
          json(
              mvc.perform(get("/api/v1/rule-backtests/" + id).session(session))
                  .andExpect(status().isOk()));
      if (!List.of("QUEUED", "RUNNING").contains(view.get("status"))) return view;
      Thread.sleep(100);
    }
    throw new AssertionError("백테스트 " + id + " 가 30초 안에 끝나지 않았습니다.");
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> part(Map<String, Object> view, String key) {
    return (Map<String, Object>) view.get(key);
  }

  @Test
  void backtest_reports_hits_value_sweep_and_cases_after_the_warmup_days() throws Exception {
    mvc.perform(get("/api/v1/rule-backtests/1")).andExpect(status().isUnauthorized());
    login("l1a");
    long[] rule = created("분산 송금 감시", "FAN_OUT");
    // 평가기가 있는 템플릿만 백테스트할 수 있다. 지금 고를 수 있는 열 개는 모두 된다(이후 제공 템플릿으로는 룰을 만들 수 없다).
    assertThat(
            json(mvc.perform(get("/api/v1/rule-templates").session(session)))
                .get("backtestTemplates"))
        .isEqualTo(
            List.of(
                "CYCLE",
                "FAN_IN",
                "FAN_OUT",
                "GATHER_SCATTER",
                "LARGE_TX",
                "PASS_THROUGH",
                "RANDOM",
                "SAME_AMOUNT",
                "SCATTER_GATHER",
                "STRUCTURING"));
    // 원장이 비어 있으면 돌릴 날짜가 없다
    send("/api/v1/rule-backtests", Map.of("versionId", rule[1])).andExpect(status().isBadRequest());

    pay(account(), account(), "2023-09-01 09:00+09", 2000); // 원장 첫날. 첫 7일은 이력으로만 쓴다
    long early = account();
    fanOut(early, 6, "2023-09-05", 2000); // 첫 7일 안이라 검사 시점이 되지 않는다
    long six = account();
    fanOut(six, 6, "2023-09-09", 2000);
    long five = account();
    fanOut(five, 5, "2023-09-10", 2000);

    send("/api/v1/rule-backtests", Map.of("versionId", 999999)).andExpect(status().isNotFound());
    send(
            "/api/v1/rule-backtests",
            Map.of("versionId", rule[1], "from", "2023-09-11", "to", "2023-09-12"))
        .andExpect(status().isBadRequest()); // 원장은 09-10 까지다

    var view = backtest(Map.of("versionId", rule[1]));
    assertThat(view.get("status")).isEqualTo("COMPLETED");
    assertThat(view.get("code")).isEqualTo(RuleService.code(rule[0]));
    assertThat(view.get("currentDefinition")).isEqualTo(true);
    assertThat(view.get("baseline")).isNull();
    assertThat(part(view, "period").get("from")).isEqualTo("2023-09-08");
    assertThat(part(view, "period").get("to")).isEqualTo("2023-09-10");
    assertThat(number(view.get("txCount"))).isEqualTo(11L);
    assertThat(number(view.get("evidenceTxCount"))).isEqualTo(6L);
    assertThat(number(part(view, "kpis").get("hits"))).isEqualTo(1L);
    assertThat(part(view, "kpis").get("added")).isNull();
    assertThat(part(view, "kpis").get("precision")).isNull();

    // 수취 계좌 수를 4 ~ 8 로 바꿔 본다. 5개 이하로 내리면 five 도 걸린다.
    var sweep = part(view, "sweep");
    assertThat(sweep.get("metric")).isEqualTo("DISTINCT_COUNTERPARTIES");
    var hitsByValue = new LinkedHashMap<Long, Long>();
    for (var row : rows(sweep.get("rows")))
      hitsByValue.put(number(row.get("value")), number(row.get("hits")));
    assertThat(hitsByValue).isEqualTo(Map.of(4L, 2L, 5L, 2L, 6L, 1L, 7L, 0L, 8L, 0L));

    var cases = rows(view.get("cases"));
    assertThat(cases).hasSize(1);
    assertThat(cases.get(0).get("state")).isEqualTo("HIT");
    assertThat(number(cases.get(0).get("txCount"))).isEqualTo(6L);
    assertThat(number(part(cases.get(0), "measured").get("DISTINCT_COUNTERPARTIES"))).isEqualTo(6L);
    assertThat(cases.get(0).get("subject").toString())
        .isEqualTo(
            jdbc.queryForObject(
                "select left(service_account_id::text,8) from core.accounts where account_id=?",
                String.class,
                six));

    long backtestId = number(view.get("backtestId"));
    var history =
        rows(
            object(
                    "{\"list\":"
                        + mvc.perform(
                                get("/api/v1/rule-backtests?ruleId=" + rule[0]).session(session))
                            .andExpect(status().isOk())
                            .andReturn()
                            .getResponse()
                            .getContentAsString(StandardCharsets.UTF_8)
                        + "}")
                .get("list"));
    assertThat(history).hasSize(1);
    assertThat(number(history.get(0).get("backtestId"))).isEqualTo(backtestId);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from rules.events where rule_id=? and action='BACKTEST_DONE'",
                Long.class,
                rule[0]))
        .isEqualTo(1L);
    // 끝난 백테스트는 취소할 수 없다
    send("/api/v1/rule-backtests/" + backtestId + "/cancel", Map.of())
        .andExpect(status().isConflict());
  }

  @Test
  void backtest_checks_only_the_chosen_days_and_looks_back_from_them() throws Exception {
    login("l1a");
    long[] rule = created("분산 송금 감시", "FAN_OUT");
    // 원장이 비어 있으면 고를 날짜가 없다
    mvc.perform(get("/api/v1/rule-backtests/period").session(session))
        .andExpect(status().isBadRequest());

    pay(account(), account(), "2023-09-01 09:00+09", 2000); // 원장 첫날
    long six = account();
    fanOut(six, 6, "2023-09-09", 2000);
    // 09-09 에 넷, 09-10 에 둘을 보낸다. 여섯 번째 수취 계좌는 09-10 에 채워진다
    long split = account();
    fanOut(split, 4, "2023-09-09", 2000);
    pay(split, account(), "2023-09-10 11:00+09", 2000);
    pay(split, account(), "2023-09-10 11:01+09", 2000);
    pay(account(), account(), "2023-09-12 09:00+09", 2000); // 원장 마지막 날

    // 화면이 기간을 고를 때 쓰는 범위. 첫 7일은 이력으로만 쓰므로 09-08 부터 검사할 수 있다
    var range =
        json(
            mvc.perform(get("/api/v1/rule-backtests/period").session(session))
                .andExpect(status().isOk()));
    assertThat(range.get("ledgerFrom")).isEqualTo("2023-09-01");
    assertThat(range.get("ledgerTo")).isEqualTo("2023-09-12");
    assertThat(range.get("earliest")).isEqualTo("2023-09-08");
    assertThat(range.get("from")).isEqualTo("2023-09-08");
    assertThat(range.get("to")).isEqualTo("2023-09-12");
    assertThat(number(range.get("days"))).isEqualTo(5L);
    assertThat(number(range.get("warmupDays"))).isEqualTo(7L);
    assertThat(number(range.get("maxDays"))).isEqualTo(90L);

    // 09-10 하루만 검사한다. 검사 시점은 그날의 두 거래뿐이고, 09-09 의 넷은 돌아보는 쪽에 들어가 여섯이 채워진다
    var day = backtest(Map.of("versionId", rule[1], "from", "2023-09-10", "to", "2023-09-10"));
    assertThat(day.get("status")).isEqualTo("COMPLETED");
    assertThat(part(day, "period").get("from")).isEqualTo("2023-09-10");
    assertThat(part(day, "period").get("to")).isEqualTo("2023-09-10");
    assertThat(number(part(day, "period").get("days"))).isEqualTo(1L);
    assertThat(number(day.get("txCount"))).isEqualTo(2L);
    assertThat(number(part(day, "kpis").get("hits"))).isEqualTo(1L);
    assertThat(number(day.get("evidenceTxCount"))).isEqualTo(6L);
    var cases = rows(day.get("cases"));
    assertThat(cases).hasSize(1);
    assertThat(cases.get(0).get("subject").toString())
        .isEqualTo(
            jdbc.queryForObject(
                "select left(service_account_id::text,8) from core.accounts where account_id=?",
                String.class,
                split));
    // 돌아본 범위: 룰의 기간이 7일이라 검사 첫날에서 7일 앞인 09-03 부터 읽는다. 바쁜 계좌는 검사 마지막 날까지의 거래로 센다
    assertThat(part(day, "lookback").get("from")).isEqualTo("2023-09-03");
    assertThat(number(part(day, "lookback").get("windowMinutes"))).isEqualTo(10080L);
    assertThat(part(day, "lookback").get("ledgerFrom")).isEqualTo("2023-09-01");
    assertThat(part(day, "busy").get("until")).isEqualTo("2023-09-10");

    // 09-09 하루만 검사하면 그날 여섯을 채운 six 만 걸린다. split 은 그날 넷뿐이다
    var before = backtest(Map.of("versionId", rule[1], "from", "2023-09-09", "to", "2023-09-09"));
    assertThat(number(before.get("txCount"))).isEqualTo(10L);
    assertThat(number(part(before, "kpis").get("hits"))).isEqualTo(1L);
    assertThat(rows(before.get("cases")).get(0).get("subject").toString())
        .isEqualTo(
            jdbc.queryForObject(
                "select left(service_account_id::text,8) from core.accounts where account_id=?",
                String.class,
                six));
    assertThat(part(before, "lookback").get("from")).isEqualTo("2023-09-02");
    assertThat(part(before, "busy").get("until")).isEqualTo("2023-09-09");

    // 시작이 끝보다 늦으면 받지 않는다
    send(
            "/api/v1/rule-backtests",
            Map.of("versionId", rule[1], "from", "2023-09-10", "to", "2023-09-09"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void backtest_of_a_path_rule_sweeps_the_number_of_transactions_on_the_path() throws Exception {
    login("l1a");
    long[] rule = created("순환 감시", "CYCLE"); // 필터 없음, 7일, 순환 거래 ≥ 3, 금액 비 0.8 ~ 1.25
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    long back = account(); // 왕복(거래 2건)
    long forth = account();
    pay(back, forth, "2023-09-09 09:00+09", 7000);
    pay(forth, back, "2023-09-09 09:30+09", 7000);
    long a = account(); // 세 계좌 순환(거래 3건)
    long b = account();
    long c = account();
    pay(a, b, "2023-09-09 10:00+09", 10000);
    pay(b, c, "2023-09-09 10:10+09", 9500);
    pay(c, a, "2023-09-09 10:20+09", 9000);

    var view = backtest(Map.of("versionId", rule[1]));
    assertThat(view.get("status")).isEqualTo("COMPLETED");
    assertThat(number(part(view, "kpis").get("hits"))).isEqualTo(1L);
    assertThat(number(view.get("evidenceTxCount"))).isEqualTo(3L);
    var cases = rows(view.get("cases"));
    assertThat(cases).hasSize(1);
    assertThat(number(part(cases.get(0), "measured").get("HOPS"))).isEqualTo(3L);
    // 순환 거래 수를 2 ~ 5 로 바꿔 본다. 2건으로 내리면 왕복도 걸린다.
    var sweep = part(view, "sweep");
    assertThat(sweep.get("metric")).isEqualTo("minHops");
    assertThat(sweep.get("label")).isEqualTo("순환 거래 수");
    assertThat(sweep.get("unit")).isEqualTo("건");
    var hitsByValue = new LinkedHashMap<Long, Long>();
    for (var row : rows(sweep.get("rows")))
      hitsByValue.put(number(row.get("value")), number(row.get("hits")));
    assertThat(hitsByValue).isEqualTo(Map.of(2L, 2L, 3L, 1L, 4L, 0L, 5L, 0L));
  }

  @Test
  void backtest_of_a_transaction_rule_lists_transactions_and_sweeps_the_amount() throws Exception {
    login("l1a");
    long[] rule = created("고액 거래 감시", "LARGE_TX"); // 처음 거래하는 상대 AND 건당 ≥ 10,000 USD
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    long nine = pay(account(), account(), "2023-09-09 10:00+09", 9500);
    long eleven = pay(account(), account(), "2023-09-09 11:00+09", 11500);
    long thirty = pay(account(), account(), "2023-09-10 10:00+09", 30000);

    var view = backtest(Map.of("versionId", rule[1]));
    assertThat(view.get("status")).isEqualTo("COMPLETED");
    assertThat(number(part(view, "kpis").get("hits"))).isEqualTo(2L);
    assertThat(number(view.get("evidenceTxCount"))).isEqualTo(2L);
    assertThat(number(view.get("skippedBusySubjects"))).isZero();
    // 사례는 거래마다 한 줄이고, 거래 코드를 만들 수 있게 거래 ID 와 시각이 같이 온다
    var cases = rows(view.get("cases"));
    assertThat(cases).hasSize(2);
    var byTx = new LinkedHashMap<Long, Map<String, Object>>();
    for (var item : cases) byTx.put(number(item.get("txId")), item);
    assertThat(byTx).containsOnlyKeys(eleven, thirty).doesNotContainKey(nine);
    var item = byTx.get(eleven);
    assertThat(item.get("subjectType")).isEqualTo("TX");
    assertThat(item.get("subject")).isEqualTo(Long.toString(eleven));
    assertThat(item.get("occurredAt")).isEqualTo("2023-09-09T02:00:00Z");
    assertThat(number(item.get("txCount"))).isEqualTo(1L);
    assertThat(number(part(item, "measured").get("TX_USD"))).isEqualTo(11500L);
    // 건당 금액을 8,000 ~ 12,000 으로 바꿔 본다. 세는 거래가 달라지므로 거를 때부터 다시 돈다.
    var sweep = part(view, "sweep");
    assertThat(sweep.get("metric")).isEqualTo("TX_USD");
    assertThat(sweep.get("label")).isEqualTo("건당 금액");
    assertThat(sweep.get("unit")).isEqualTo("USD");
    var hitsByValue = new LinkedHashMap<Long, Long>();
    for (var row : rows(sweep.get("rows")))
      hitsByValue.put(number(row.get("value")), number(row.get("hits")));
    assertThat(hitsByValue)
        .isEqualTo(Map.of(8000L, 3L, 9000L, 3L, 10000L, 2L, 11000L, 2L, 12000L, 1L));
  }

  @Test
  void backtest_compares_a_new_version_with_the_operating_one_and_attaches_human_judgement()
      throws Exception {
    login("l1a");
    long[] rule = created("분산 송금 감시", "FAN_OUT");
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    long six = account();
    var sixTx = fanOut(six, 6, "2023-09-09", 2000);
    long five = account();
    fanOut(five, 5, "2023-09-10", 2000);

    // 상태 명령을 거치지 않고 운영 버전(6개 이상)과 새 초안(5개 이상)을 표에 직접 만든다.
    jdbc.update("update rules.rule_versions set status='ACTIVE' where version_id=?", rule[1]);
    long draft =
        jdbc.queryForObject(
            """
            insert into rules.rule_versions(rule_id,version_no,status,definition,definition_digest,summary,author_id,created_at)
            select rule_id,2,'DRAFT',jsonb_set(definition,'{where,items,0,value}','5'),repeat('5',64),summary,author_id,created_at
            from rules.rule_versions where version_id=? returning version_id
            """,
            Long.class,
            rule[1]);

    // six 의 거래로 만든 Alert 를 사람이 의심으로 종결했다.
    long user =
        jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
    long alert =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
            Long.class,
            user);
    UUID run = UUID.randomUUID();
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED','2099-01-01',.7,'COMPLETE',now(),now()) returning job_id",
            Long.class);
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status) values(?,?,1,'COMPLETED')",
        run,
        job);
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,repeat('f',64),'{}',now())",
        alert,
        run);
    for (long txId : sixTx.subList(0, 2))
      jdbc.update(
          "insert into review.alert_transactions(alert_id,version,tx_id,role,reasons) values(?,1,?,'SEED','[]')",
          alert,
          txId);
    jdbc.update(
        "update review.alerts set published_version=1,status='CLOSED',outcome='SUSPICIOUS',closed_at=now(),closed_by=? where alert_id=?",
        user,
        alert);

    var view = backtest(Map.of("versionId", draft));
    assertThat(view.get("status")).isEqualTo("COMPLETED");
    assertThat(number(part(view, "baseline").get("versionNo"))).isEqualTo(1L);
    var kpis = part(view, "kpis");
    assertThat(number(kpis.get("hits"))).isEqualTo(2L);
    assertThat(number(kpis.get("baseHits"))).isEqualTo(1L);
    assertThat(number(kpis.get("added"))).isEqualTo(1L);
    assertThat(number(kpis.get("dropped"))).isZero();
    // 사람 판정이 붙은 대상은 six 하나(의심)다
    assertThat(number(kpis.get("judged"))).isEqualTo(1L);
    assertThat(((Number) kpis.get("precision")).doubleValue()).isEqualTo(100.0);
    assertThat(number(view.get("alertOverlap"))).isEqualTo(1L);
    assertThat(number(view.get("expectedNewAlerts"))).isEqualTo(1L);

    var states = new LinkedHashMap<String, String>();
    for (var item : rows(view.get("cases")))
      states.put(item.get("state").toString(), String.valueOf(item.get("judgement")));
    assertThat(states).isEqualTo(Map.of("ADDED", "null", "KEPT", "SUSPICIOUS"));
    var values = new ArrayList<Long>();
    for (var row : rows(part(view, "sweep").get("rows"))) values.add(number(row.get("value")));
    assertThat(values).containsExactly(4L, 5L, 6L);
  }
}
