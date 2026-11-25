package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleEvaluator;
import com.moneylaundry.api.rules.engine.RuleRunStep;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 일반 템플릿 넷(단건 고액거래 · 분할 입·출금 · 같은 금액 반복 · 급속 자금 통과)의 평가기. 손으로 만든 작은 원장에서 "이 거래들이면 걸린다 / 안 걸린다"를
 * 확인하고, 대상이 거래인 룰의 일일 실행과 사건의 룰 적중 카드까지 본다.
 */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RuleGeneralTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @Autowired RuleCatalog catalog;
  @Autowired RuleEvaluator evaluator;
  @Autowired RuleService rules;
  @Autowired RuleHitQuery hitQuery;
  @Autowired RuleRunStep step;
  @MockitoBean AnalysisScheduler scheduler;
  long owner;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate rules.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-17T00:00:00Z',revision=0");
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

  /** 룰을 2023-09-01 ~ 2023-09-30 의 원장에 돌려 대상 → 근거 거래(tx_id 순)를 돌려준다. 대상은 계좌이거나(계좌 ID) 거래다(거래 ID). */
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

  /** 같은 실행에서 그 대상의 측정값(여러 날이면 가장 늦은 날의 것). */
  Map<String, Object> measured(Map<String, Object> definition, long subject) {
    var out = new LinkedHashMap<String, Object>();
    tx.executeWithoutResult(
        s -> {
          evaluator.begin();
          evaluator.busy(null);
          evaluator.filtered(definition, "2023-09-01", "2023-09-30");
          evaluator.run(definition, "2023-09-01", "2023-09-30");
          out.putAll(
              object(
                  jdbc.queryForObject(
                      "select measured::text from rule_result where subject_id=? order by hit_date desc limit 1",
                      String.class,
                      subject)));
        });
    return out;
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> items(Map<String, Object> definition, String group) {
    return (List<Map<String, Object>>) ((Map<String, Object>) definition.get(group)).get("items");
  }

  /** 세는 거래 · 적중 조건에서 그 항목의 첫 줄. */
  static Map<String, Object> line(Map<String, Object> definition, String group, String name) {
    for (var item : items(definition, group))
      if (name.equals(item.get("field")) || name.equals(item.get("metric"))) return item;
    throw new AssertionError(name + " 줄이 없습니다.");
  }

  // ---- 평가기 ----

  @Test
  void large_tx_hits_every_counted_transaction_and_the_transaction_itself_is_the_subject() {
    var definition = catalog.defaults("LARGE_TX"); // 처음 거래하는 상대 AND 건당 ≥ 10,000 USD. 기간 · 적중 조건 없음
    long a = account();
    long b = account();
    long first = pay(a, b, "2023-09-09 10:00+09", 12000);
    pay(a, b, "2023-09-09 10:05+09", 15000); // 같은 상대에게 두 번째: 처음 거래하는 상대가 아니다
    pay(account(), account(), "2023-09-09 10:10+09", 9999.99); // 금액 미달
    long edge = pay(account(), account(), "2023-09-10 10:00+09", 10000); // 기준과 같은 금액은 걸린다

    // 대상은 계좌가 아니라 거래이고, 근거 거래는 그 거래 하나다
    assertThat(hits(evaluator, definition))
        .isEqualTo(Map.of(first, List.of(first), edge, List.of(edge)));
    assertThat(number(measured(definition, first).get("TX_USD"))).isEqualTo(12000L);

    // 계좌를 돌아보지 않으므로 바쁜 계좌도 빼지 않는다(72시간 안 같은 방향 거래 3건 초과가 바쁜 계좌)
    long busy = account();
    for (int i = 0; i < 5; i++) pay(busy, account(), "2023-09-11 10:%02d+09".formatted(i), 20000);
    var strict = new RuleEvaluator(jdbc, 3, 4320);
    assertThat(hits(strict, definition)).hasSize(7);
    tx.executeWithoutResult(
        s -> {
          strict.begin();
          assertThat(strict.busy(null)).containsExactly(busy);
          strict.filtered(definition, "2023-09-01", "2023-09-30");
          assertThat(strict.triggers(definition, "2023-09-01", "2023-09-30", false)).isEqualTo(7L);
          assertThat(strict.skippedBusySubjects(definition, "2023-09-01", "2023-09-30")).isZero();
        });
  }

  @Test
  void structuring_counts_transactions_inside_the_amount_band_in_the_chosen_direction() {
    // 기본값: 출금, 7일, 처음 거래하는 상대 AND 건당 ≥ 5,000 AND 건당 < 10,000 USD, 거래 건수 ≥ 2
    var definition = catalog.defaults("STRUCTURING");
    long split = account();
    var evidence =
        List.of(
            pay(split, account(), "2023-09-09 10:00+09", 5000), // 하한과 같은 금액은 띠 안
            pay(split, account(), "2023-09-09 10:05+09", 9999.99));
    pay(split, account(), "2023-09-09 10:10+09", 3000); // 띠 밖 거래는 세지도 않고 근거도 아니다
    long over = account(); // 하나가 상한과 같은 금액이라 띠 안 거래가 한 건뿐이다
    pay(over, account(), "2023-09-09 10:00+09", 6000);
    pay(over, account(), "2023-09-09 10:05+09", 10000);
    long gathered = account(); // 두 계좌에서 띠 안 금액을 받았다: 출금 방향으로는 누구도 두 건이 아니다
    var received =
        List.of(
            pay(account(), gathered, "2023-09-10 10:00+09", 7000),
            pay(account(), gathered, "2023-09-10 10:05+09", 8000));

    assertThat(hits(evaluator, definition)).isEqualTo(Map.of(split, evidence));
    assertThat(number(measured(definition, split).get("TX_COUNT"))).isEqualTo(2L);
    // 방향을 입금으로 바꾸면 받은 쪽 계좌가 대상이 된다
    definition.put("direction", "IN");
    assertThat(hits(evaluator, definition)).isEqualTo(Map.of(gathered, received));
    // 세 건 이상으로 올리면 아무도 걸리지 않는다
    line(definition, "where", "TX_COUNT").put("value", 3);
    assertThat(hits(evaluator, definition)).isEmpty();
  }

  @Test
  void same_amount_counts_earlier_transactions_close_to_the_checked_amount() {
    // 기본값: 출금, 3일, 처음 거래하는 상대 AND 건당 ≥ 1,000 USD AND 검사 거래 금액의 ±5%, 거래 건수 ≥ 2
    var definition = catalog.defaults("SAME_AMOUNT");
    long near = account(); // 2,000 뒤에 2,100: 2,100 의 ±5% 는 1,995 ~ 2,205 라 앞의 2,000 이 들어온다
    var nearTx =
        List.of(
            pay(near, account(), "2023-09-09 10:00+09", 2000),
            pay(near, account(), "2023-09-09 11:00+09", 2100));
    long far = account(); // 2,000 뒤에 2,200: 2,200 의 ±5% 는 2,090 ~ 2,310 이다
    pay(far, account(), "2023-09-09 10:00+09", 2000);
    pay(far, account(), "2023-09-09 11:00+09", 2200);
    long edge = account(); // 2,000 뒤에 2,000 ÷ 0.95 보다 조금 작은 2,105: 하한 1,999.75 로 2,000 이 들어온다
    pay(edge, account(), "2023-09-09 10:00+09", 2000);
    pay(edge, account(), "2023-09-09 11:00+09", 2105);
    long reverse =
        account(); // 2,105 뒤에 2,000: 범위는 검사 거래(나중 거래) 금액으로 정한다. 2,000 의 ±5% 는 1,900 ~ 2,100
    pay(reverse, account(), "2023-09-09 10:00+09", 2105);
    pay(reverse, account(), "2023-09-09 11:00+09", 2000);
    long mixed = account(); // 같은 분에 금액이 다른 두 건: 금액마다 따로 검사한다
    var mixedTx =
        List.of(
            pay(mixed, account(), "2023-09-10 09:00+09", 3000),
            pay(mixed, account(), "2023-09-10 10:00+09", 3000));
    pay(mixed, account(), "2023-09-10 10:00+09", 5000);
    long twice = account(); // 같은 분의 두 금액이 저마다 앞 거래와 짝이 맞는다: 둘 다 검사해야 네 건이 근거가 된다
    var twiceTx =
        List.of(
            pay(twice, account(), "2023-09-10 09:00+09", 3000),
            pay(twice, account(), "2023-09-10 09:00+09", 5000),
            pay(twice, account(), "2023-09-10 10:00+09", 3000),
            pay(twice, account(), "2023-09-10 10:00+09", 5000));
    long slow = account(); // 같은 금액이지만 정확히 3일 뒤라 기간 밖이다
    pay(slow, account(), "2023-09-11 10:00+09", 4000);
    pay(slow, account(), "2023-09-14 10:00+09", 4000);

    assertThat(hits(evaluator, definition)).containsOnlyKeys(near, edge, mixed, twice);
    assertThat(hits(evaluator, definition).get(twice)).isEqualTo(twiceTx);
    assertThat(hits(evaluator, definition).get(near)).isEqualTo(nearTx);
    assertThat(hits(evaluator, definition).get(mixed)).isEqualTo(mixedTx);
    assertThat(number(measured(definition, mixed).get("TX_COUNT"))).isEqualTo(2L);
    assertThat(number(measured(definition, mixed).get("SUM_USD"))).isEqualTo(6000L);

    // ±0% 는 정확히 같은 금액만 센다
    line(definition, "filter", "NEAR_TRIGGER_AMOUNT").put("value", 0);
    assertThat(hits(evaluator, definition)).containsOnlyKeys(mixed, twice);
    // 입금 방향: 같은 금액을 두 번 받은 계좌
    long taker = account();
    pay(account(), taker, "2023-09-12 10:00+09", 1500);
    pay(account(), taker, "2023-09-12 10:30+09", 1500);
    definition.put("direction", "IN");
    assertThat(hits(evaluator, definition)).containsOnlyKeys(taker);
  }

  @Test
  void pass_through_compares_what_left_after_the_first_receipt_with_what_came_in() {
    // 기본값: 3일, 처음 거래하는 상대 AND 건당 ≥ 1,000 USD, 출금 ÷ 입금 ≥ 80% AND ≤ 125%
    var definition = catalog.defaults("PASS_THROUGH");
    long hub = account(); // 한 계좌에서 받아 한 계좌로 보내도 걸린다(상대 계좌 수는 보지 않는다)
    var through =
        List.of(
            pay(account(), hub, "2023-09-09 10:00+09", 10000),
            pay(hub, account(), "2023-09-09 11:00+09", 9000));
    long kept = account(); // 절반만 내보냈다: 50%
    pay(account(), kept, "2023-09-09 10:00+09", 10000);
    pay(kept, account(), "2023-09-09 11:00+09", 5000);
    long more = account(); // 받은 것보다 훨씬 많이 내보냈다: 130%
    pay(account(), more, "2023-09-09 10:00+09", 10000);
    pay(more, account(), "2023-09-09 11:00+09", 13000);
    long before = account(); // 먼저 내보내고 나중에 받았다: 첫 입금 뒤의 출금이 없다
    pay(before, account(), "2023-09-09 10:00+09", 9000);
    pay(account(), before, "2023-09-09 11:00+09", 10000);
    long early = account(); // 받기 전에 내보낸 5,000 은 세지 않는다: 받은 뒤의 출금은 5,000 뿐이라 50%
    pay(early, account(), "2023-09-09 09:00+09", 5000);
    pay(account(), early, "2023-09-09 10:00+09", 10000);
    pay(early, account(), "2023-09-09 11:00+09", 5000);
    long edges = account(); // 경계: 정확히 80%
    pay(account(), edges, "2023-09-10 10:00+09", 10000);
    pay(edges, account(), "2023-09-10 10:00+09", 8000); // 같은 분의 입금 뒤 출금으로 센다

    assertThat(hits(evaluator, definition)).containsOnlyKeys(hub, edges);
    assertThat(hits(evaluator, definition).get(hub)).isEqualTo(through);
    var measured = measured(definition, hub);
    assertThat(number(measured.get("SUM_USD"))).isEqualTo(10000L);
    assertThat(((Number) measured.get("OUT_IN_RATIO")).doubleValue()).isEqualTo(90.0);

    // 상한을 빼면 많이 내보낸 계좌도 걸린다
    items(definition, "where").remove(1);
    assertThat(hits(evaluator, definition)).containsOnlyKeys(hub, edges, more);
    // 받은 총액 조건을 더하면 작은 통과는 빠진다. 보는 것은 내보낸 합계가 아니라 받은 합계다.
    items(definition, "where")
        .add(new LinkedHashMap<>(Map.of("metric", "SUM_USD", "cmp", "GTE", "value", 20000)));
    assertThat(hits(evaluator, definition)).isEmpty();
    long large = account();
    pay(account(), large, "2023-09-12 10:00+09", 20000);
    pay(large, account(), "2023-09-12 12:00+09", 16500);
    assertThat(hits(evaluator, definition)).containsOnlyKeys(large);
  }

  // ---- 일일 실행 · 사건의 룰 적중 ----

  long user(String username) {
    return jdbc.queryForObject(
        "select user_id from core.users where username=?", Long.class, username);
  }

  /** 템플릿 기본값으로 룰을 만들고 바로 운영 중으로 둔다. */
  long live(String name, String template) {
    long version =
        number(
            rules
                .create(user("l1a"), new RuleService.CreateInput(name, template, null))
                .get("versionId"));
    jdbc.update(
        "update rules.rule_versions set status='ACTIVE',eval_from_seq=0 where version_id=?",
        version);
    return version;
  }

  /** 분석 한 번. days 의 거래를 새로 받았다(TARGET). */
  UUID analysis(String... days) {
    UUID run = UUID.randomUUID();
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED','2099-01-01',.7,'COMPLETE',now(),now()) returning job_id",
            Long.class);
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status,input_seq) values(?,?,1,'ACTIVE',1)",
        run,
        job);
    jdbc.update(
        """
        insert into analysis.input_transactions(run_id,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
          from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,
          payment_currency,payment_format,amount_usd,fx_rate_version)
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,
          oa.service_owner_id,ob.service_owner_id,t.amount_received,t.receiving_currency,t.amount_paid,
          t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version
        from ledger.transactions t
        join core.accounts a on a.account_id=t.from_account_id join core.accounts b on b.account_id=t.to_account_id
        join core.owners oa on oa.owner_id=a.owner_id join core.owners ob on ob.owner_id=b.owner_id
        where t.business_date = any(?::date[])
        """,
        run,
        "{" + String.join(",", days) + "}");
    return run;
  }

  /** 그 분석이 공개한 Alert 하나. 거래는 txIds 다. */
  long alert(UUID run, List<Long> txIds) {
    long alert =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
            Long.class,
            user("l1a"));
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,md5(random()::text)||md5(random()::text),'{}',now())",
        alert,
        run);
    for (long txId : txIds)
      jdbc.update(
          "insert into review.alert_transactions(alert_id,version,tx_id,role,reasons) values(?,1,?,'SEED','[]')",
          alert,
          txId);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", alert);
    return alert;
  }

  @Test
  void daily_run_stores_transaction_hits_and_the_case_shows_them_on_one_card() {
    pay(account(), account(), "2023-09-01 09:00+09", 2000); // 원장 첫날. 첫 7일은 이력으로만 쓴다
    long bigger = pay(account(), account(), "2023-09-09 10:00+09", 50000);
    long big = pay(account(), account(), "2023-09-10 10:00+09", 12000);
    long small = pay(account(), account(), "2023-09-10 11:00+09", 900);
    long elsewhere = pay(account(), account(), "2023-09-10 12:00+09", 70000); // 이 Alert 에 없는 고액 거래
    long hub = account();
    var through =
        List.of(
            pay(account(), hub, "2023-09-10 13:00+09", 4000),
            pay(hub, account(), "2023-09-10 14:00+09", 3900));
    long large = live("고액 거래 감시", "LARGE_TX");
    long pass = live("급속 통과 감시", "PASS_THROUGH");

    UUID run = analysis("2023-09-09", "2023-09-10");
    assertThat(step.run(run)).allMatch(outcome -> "COMPLETED".equals(outcome.status()));
    // 대상이 거래인 적중은 subject_type 이 TX 이고 subject_id 가 그 거래다
    assertThat(
            jdbc.queryForList(
                "select subject_type||' '||subject_id||'@'||hit_date from rules.hits where version_id=? order by subject_id",
                String.class,
                large))
        .containsExactly(
            "TX " + bigger + "@2023-09-09",
            "TX " + big + "@2023-09-10",
            "TX " + elsewhere + "@2023-09-10");
    var execution =
        jdbc.queryForMap(
            "select trigger_count,hit_count,skipped_subjects from rules.executions where version_id=?",
            large);
    assertThat(execution.get("trigger_count")).isEqualTo(3);
    assertThat(execution.get("hit_count")).isEqualTo(3);
    assertThat(execution.get("skipped_subjects")).isEqualTo(0);

    long alert = alert(run, List.of(bigger, big, small, through.get(1)));
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
    var cards = hitQuery.forCase(alert);
    assertThat(cards).hasSize(2);

    // 고액 거래 두 건이 걸렸어도 카드는 한 장이다. 측정값은 날짜와 상관없이 그 가운데 가장 큰 금액이다.
    var first = cards.get(0);
    assertThat(first.get("templateName")).isEqualTo("단건 고액거래");
    assertThat(first.get("subjectType")).isEqualTo("TX");
    assertThat(first.get("subjectLabel")).isEqualTo("거래 1건");
    assertThat(first.get("subject")).isNull();
    assertThat(first.get("hitDates")).isEqualTo(List.of("2023-09-09", "2023-09-10"));
    assertThat(first.get("matchedTxIds")).isEqualTo(List.of(bigger, big));
    assertThat(first.get("evidenceTxCount")).isEqualTo(2);
    assertThat(first.get("roles")).isEqualTo(List.of());
    var amount = rows(first.get("conditions")).get(0);
    assertThat(rows(first.get("conditions"))).hasSize(1);
    assertThat(amount.get("metric")).isEqualTo("TX_USD");
    assertThat(amount.get("label")).isEqualTo("건당 금액");
    assertThat(amount.get("cmp")).isEqualTo("GTE");
    assertThat(amount.get("unit")).isEqualTo("USD");
    assertThat(number(amount.get("value"))).isEqualTo(10000L);
    assertThat(number(amount.get("measured"))).isEqualTo(50000L);

    var second = cards.get(1);
    assertThat(second.get("templateName")).isEqualTo("급속 자금 통과");
    assertThat(second.get("subjectType")).isEqualTo("ACCOUNT");
    assertThat(second.get("subject"))
        .isEqualTo(
            jdbc.queryForObject(
                "select left(service_account_id::text,8) from core.accounts where account_id=?",
                String.class,
                hub));
    assertThat(second.get("matchedTxIds")).isEqualTo(List.of(through.get(1)));
    assertThat(second.get("evidenceTxCount")).isEqualTo(2);
    var ratio = rows(second.get("conditions")).get(0);
    assertThat(ratio.get("label")).isEqualTo("첫 입금 뒤 출금 합계 ÷ 받은 합계");
    assertThat(((Number) ratio.get("measured")).doubleValue()).isEqualTo(97.5);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from rules.hits where version_id=?", Long.class, pass))
        .isEqualTo(1L);
  }
}
