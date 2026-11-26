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
 * 2홉형(SCATTER-GATHER)과 경로형(CYCLE · RANDOM) 평가기. 손으로 만든 작은 원장에서 "이 모양이면 이 계좌가 걸린다 / 안 걸린다"를 확인하고, 일일
 * 실행과 사건의 룰 적중 카드까지 본다.
 */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RulePatternTests {
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
        "insert into core.accounts(bank_id,owner_id) values(999017,?) returning account_id",
        Long.class,
        owner);
  }

  String shortId(long account) {
    return jdbc.queryForObject(
        "select service_account_id from core.accounts where account_id=?", String.class, account);
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

  /**
   * source → 새 경유 계좌 count 개 → dest. 앞 구간은 day 의 10시대, 뒤 구간은 11시대에 1분 간격이다. 근거가 될 거래(앞 구간 + 뒤 구간)를
   * 돌려준다.
   */
  List<Long> scatterGather(long source, long dest, int count, String day, double usd) {
    var sent = new ArrayList<Long>();
    for (int i = 0; i < count; i++) {
      long mid = account();
      sent.add(pay(source, mid, "%s 10:%02d+09".formatted(day, i), usd));
      sent.add(pay(mid, dest, "%s 11:%02d+09".formatted(day, i), usd));
    }
    Collections.sort(sent);
    return sent;
  }

  /** accounts 를 차례로 잇는 거래. 10분 간격이고 금액은 한 건마다 5% 씩 줄어든다. */
  List<Long> chain(String day, double usd, long... accounts) {
    var sent = new ArrayList<Long>();
    for (int i = 0; i + 1 < accounts.length; i++)
      sent.add(
          pay(
              accounts[i],
              accounts[i + 1],
              "%s 10:%02d+09".formatted(day, i * 10),
              Math.round(usd * Math.pow(0.95, i))));
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
  static Map<String, Object> part(Map<String, Object> definition, String key) {
    return (Map<String, Object>) definition.get(key);
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> first(Map<String, Object> definition, String group) {
    return ((List<Map<String, Object>>) part(definition, group).get("items")).get(0);
  }

  // ---- 평가기 ----

  @Test
  void scatter_gather_counts_the_mids_one_source_reached_one_destination_through() {
    var definition = catalog.defaults("SCATTER_GATHER"); // 건당 ≥ 1,000 USD, 7일, 경유 계좌 ≥ 4
    long source = account();
    long dest = account();
    var evidence = scatterGather(source, dest, 4, "2023-09-09", 2000);

    long three = account(); // 경유 넷 가운데 하나는 앞 구간이 건당 금액 미달이라 세지 않는다
    long threeSource = account();
    var threeEvidence = scatterGather(threeSource, three, 3, "2023-09-09", 2000);
    long small = account();
    pay(threeSource, small, "2023-09-09 10:30+09", 500);
    pay(small, three, "2023-09-09 11:30+09", 2000);

    long reversed = account(); // 경유 계좌가 먼저 보내고 나중에 받았다
    long reversedSource = account();
    for (int i = 0; i < 4; i++) {
      long mid = account();
      pay(mid, reversed, "2023-09-09 10:%02d+09".formatted(i), 2000);
      pay(reversedSource, mid, "2023-09-09 11:%02d+09".formatted(i), 2000);
    }

    long mixed = account(); // 경유 계좌 넷이 저마다 다른 출발 계좌에서 받았다
    for (int i = 0; i < 4; i++) scatterGather(account(), mixed, 1, "2023-09-09", 2000);

    long round = account(); // 뿌린 계좌로 되돌아왔다: 출발과 도착이 같으면 이 패턴이 아니다
    scatterGather(round, round, 4, "2023-09-09", 2000);

    // 걸리는 것은 dest 하나이고, 근거 거래는 앞 구간 4건 + 뒤 구간 4건이다
    assertThat(hits(evaluator, definition)).isEqualTo(Map.of(dest, evidence));

    // 경유 계좌 3개로 내리면 three 도 걸린다. 금액 미달 구간을 거친 뒤 구간 거래는 근거가 아니다.
    first(definition, "where").put("value", 3);
    assertThat(hits(evaluator, definition)).isEqualTo(Map.of(dest, evidence, three, threeEvidence));

    // 기간: 검사하는 뒤 구간 거래의 분을 포함해 직전 N분 안에 앞 구간까지 들어와야 한다. 앞 구간이 10:00 ~ 10:03, 뒤 구간이
    // 11:00 ~ 11:03 이라 63분으로는 네 개가 모이지 않고 64분이면 모인다.
    first(definition, "where").put("value", 4);
    definition.put("windowMinutes", 63);
    assertThat(hits(evaluator, definition)).isEmpty();
    definition.put("windowMinutes", 64);
    assertThat(hits(evaluator, definition)).containsOnlyKeys(dest);
  }

  @Test
  void cycle_needs_a_path_that_returns_and_random_one_that_does_not() {
    long a = account();
    long b = account();
    long c = account();
    var loop = chain("2023-09-09", 10000, a, b, c, a); // 10,000 → 9,500 → 9,025
    long x = account(); // 왕복: 거래 2건
    long y = account();
    var bounce = chain("2023-09-09", 7000, x, y, x);
    long e = account();
    long f = account();
    long g = account();
    long h = account();
    var line = chain("2023-09-10", 5000, e, f, g, h); // 돌아오지 않는 세 건
    long p = account(); // 돌아오기는 하지만 가운데에서 금액이 반으로 줄었다
    long q = account();
    long r = account();
    pay(p, q, "2023-09-11 10:00+09", 10000);
    pay(q, r, "2023-09-11 10:10+09", 5000);
    pay(r, p, "2023-09-11 10:20+09", 5000);
    long late = account(); // 시각이 거꾸로다: 나중 거래가 먼저 일어났다
    long later = account();
    long last = account();
    pay(late, later, "2023-09-12 10:20+09", 3000);
    pay(later, last, "2023-09-12 10:10+09", 3000);
    pay(last, late, "2023-09-12 10:00+09", 3000);

    // CYCLE 기본값: 필터 없음, 7일, 순환 거래 ≥ 3, 금액 비 0.8 ~ 1.25. 대상은 돈이 돌아온 계좌다.
    var cycle = catalog.defaults("CYCLE");
    assertThat(hits(evaluator, cycle)).isEqualTo(Map.of(a, loop));
    // 순환 거래 수를 2 로 내리면 왕복도 걸린다
    part(cycle, "path").put("minHops", 2);
    assertThat(hits(evaluator, cycle)).isEqualTo(Map.of(a, loop, x, bounce));
    // 금액 비 하한을 0.5 로 넓히면 반으로 줄어든 순환도 이어진다
    part(cycle, "path").put("stepRatioMin", 0.5);
    assertThat(hits(evaluator, cycle)).containsOnlyKeys(a, x, p);

    // RANDOM: 닫히지 않은 경로만. 대상은 경로의 끝 계좌다. (필터를 비워 경로 조건만 본다)
    var random = catalog.defaults("RANDOM");
    part(random, "filter").put("items", new ArrayList<>());
    assertThat(hits(evaluator, random)).isEqualTo(Map.of(h, line));
    // 한 건 더 이어지면 그 끝 계좌도 걸리고 근거는 네 건이 된다
    long i = account();
    long more = pay(h, i, "2023-09-10 10:30+09", 4300);
    var longer = new ArrayList<>(line);
    longer.add(more);
    assertThat(hits(evaluator, random)).isEqualTo(Map.of(h, line, i, longer));
    // 따라가는 최대 거래 수를 3 으로 줄이면 네 건짜리 경로는 뒤의 세 건만 본다
    part(random, "path").put("maxHops", 3);
    assertThat(hits(evaluator, random).get(i)).isEqualTo(longer.subList(1, 4));
  }

  @Test
  void a_path_must_fit_in_the_window_and_pass_the_transaction_filter() {
    var random = catalog.defaults("RANDOM"); // 건당 ≥ 1,000 USD AND (처음 거래하는 상대 OR 환전 직후 송금), 3일
    long inside = account(); // 첫 거래부터 마지막 거래까지 3일에서 1분 모자란다
    long k1 = account();
    long k2 = account();
    long k3 = account();
    pay(k1, k2, "2023-09-09 10:00+09", 5000);
    pay(k2, k3, "2023-09-10 10:00+09", 4800);
    pay(k3, inside, "2023-09-12 09:59+09", 4600);
    long outside = account(); // 정확히 3일 뒤: 기간 밖이다
    long m1 = account();
    long m2 = account();
    long m3 = account();
    pay(m1, m2, "2023-09-09 10:00+09", 5000);
    pay(m2, m3, "2023-09-10 10:00+09", 4800);
    pay(m3, outside, "2023-09-12 10:00+09", 4600);
    long cheap = account(); // 가운데 거래가 건당 금액 미달이라 세는 거래가 아니다
    long n1 = account();
    long n2 = account();
    long n3 = account();
    pay(n1, n2, "2023-09-13 10:00+09", 1100);
    pay(n2, n3, "2023-09-13 10:10+09", 990);
    pay(n3, cheap, "2023-09-13 10:20+09", 1000);
    long repeat = account(); // 마지막 구간이 전에 거래한 상대다: 처음 거래하는 상대가 아니다
    long r1 = account();
    long r2 = account();
    long r3 = account();
    pay(r3, repeat, "2023-09-02 10:00+09", 50);
    pay(r1, r2, "2023-09-14 10:00+09", 5000);
    pay(r2, r3, "2023-09-14 10:10+09", 4800);
    pay(r3, repeat, "2023-09-14 10:20+09", 4600);

    assertThat(hits(evaluator, random)).containsOnlyKeys(inside);
  }

  @Test
  void a_busy_account_anywhere_on_the_path_breaks_it() {
    // 72시간 안 같은 방향 거래가 3건을 넘으면 바쁜 계좌로 본다
    var strict = new RuleEvaluator(jdbc, 3, 4320);
    long quiet = account();
    chain("2023-09-09", 5000, account(), account(), account(), quiet);
    long crowded = account(); // 대상은 한가하지만 경로의 가운데 계좌가 다른 입금을 네 건 받았다
    long hub = account();
    chain("2023-09-09", 5000, account(), hub, account(), crowded);
    for (int i = 0; i < 4; i++) pay(account(), hub, "2023-09-08 09:%02d+09".formatted(i), 100);

    var random = catalog.defaults("RANDOM");
    part(random, "filter").put("items", new ArrayList<>());
    assertThat(hits(evaluator, random)).containsOnlyKeys(quiet, crowded);
    assertThat(hits(strict, random)).containsOnlyKeys(quiet);

    // SCATTER-GATHER 도 같다: 대상(도착 계좌)이 한가해도 출발 계좌가 바쁘면 걸리지 않는다
    var scatterGather = catalog.defaults("SCATTER_GATHER");
    first(scatterGather, "where").put("value", 2);
    long calm = account();
    scatterGather(account(), calm, 2, "2023-09-11", 2000);
    long noisy = account();
    long sender = account();
    scatterGather(sender, noisy, 2, "2023-09-11", 2000);
    pay(sender, account(), "2023-09-11 12:00+09", 2000);
    pay(sender, account(), "2023-09-11 12:01+09", 2000);
    assertThat(hits(evaluator, scatterGather)).containsOnlyKeys(calm, noisy);
    assertThat(hits(strict, scatterGather)).containsOnlyKeys(calm);
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

  static List<String> accounts(Map<String, Object> card, String role) {
    var out = new ArrayList<String>();
    for (var item : rows(card.get("roles")))
      if (role.equals(item.get("role"))) out.add(item.get("accountId").toString());
    return out;
  }

  @Test
  void daily_run_stores_path_hits_and_the_case_card_names_the_other_accounts() {
    pay(account(), account(), "2023-09-01 09:00+09", 2000); // 원장 첫날. 첫 7일은 이력으로만 쓴다
    long a = account();
    long b = account();
    long c = account();
    var loop = chain("2023-09-09", 10000, a, b, c, a);
    long source = account();
    long dest = account();
    var spread = scatterGather(source, dest, 4, "2023-09-10", 2000);
    long cycle = live("순환 감시", "CYCLE");
    long scatter = live("뿌렸다 모으기 감시", "SCATTER_GATHER");

    UUID run = analysis("2023-09-09", "2023-09-10");
    var outcomes = step.run(run);
    assertThat(outcomes).hasSize(2);
    assertThat(outcomes).allMatch(outcome -> "COMPLETED".equals(outcome.status()));
    assertThat(
            jdbc.queryForList(
                "select h.subject_id||'@'||h.hit_date||' '||(select count(*) from rules.hit_transactions x where x.hit_id=h.hit_id) from rules.hits h where h.version_id=?",
                String.class,
                cycle))
        .containsExactly(a + "@2023-09-09 3");
    assertThat(
            jdbc.queryForList(
                "select h.subject_id||'@'||h.hit_date||' '||(select count(*) from rules.hit_transactions x where x.hit_id=h.hit_id) from rules.hits h where h.version_id=?",
                String.class,
                scatter))
        .containsExactly(dest + "@2023-09-10 8");

    // 순환의 한 건과 뿌렸다 모으기의 한 건이 들어간 Alert
    long alert = alert(run, List.of(loop.get(1), spread.get(0)));
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
    var cards = hitQuery.forCase(alert);
    assertThat(cards).hasSize(2);

    var first = cards.get(0);
    assertThat(first.get("templateName")).isEqualTo("CYCLE · 순환거래");
    assertThat(first.get("subject")).isEqualTo(shortId(a));
    assertThat(first.get("matchedTxIds")).isEqualTo(List.of(loop.get(1)));
    assertThat(first.get("evidenceTxCount")).isEqualTo(3);
    // 경로형의 조건은 "순환 거래 수 ≥ 3건, 실제 3건" 한 줄이다
    var hops = rows(first.get("conditions")).get(0);
    assertThat(hops.get("metric")).isEqualTo("minHops");
    assertThat(hops.get("label")).isEqualTo("순환 거래 수");
    assertThat(hops.get("cmp")).isEqualTo("GTE");
    assertThat(hops.get("unit")).isEqualTo("건");
    assertThat(number(hops.get("value"))).isEqualTo(3L);
    assertThat(number(hops.get("measured"))).isEqualTo(3L);
    // 대상 말고 경로에 있던 계좌가 지나간 순서대로 온다
    assertThat(accounts(first, "PATH")).containsExactly(shortId(b), shortId(c));

    var second = cards.get(1);
    assertThat(second.get("templateName")).isEqualTo("SCATTER-GATHER · 뿌렸다 모으기");
    assertThat(second.get("subject")).isEqualTo(shortId(dest));
    assertThat(second.get("evidenceTxCount")).isEqualTo(8);
    var mids = rows(second.get("conditions")).get(0);
    assertThat(mids.get("label")).isEqualTo("경유 계좌 수");
    assertThat(number(mids.get("measured"))).isEqualTo(4L);
    assertThat(accounts(second, "SOURCE")).containsExactly(shortId(source));
    assertThat(accounts(second, "MID")).hasSize(4).doesNotContain(shortId(source), shortId(dest));
  }
}
