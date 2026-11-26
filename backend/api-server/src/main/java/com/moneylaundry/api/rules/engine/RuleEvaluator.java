package com.moneylaundry.api.rules.engine;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 룰을 원장에 돌린다. 계산은 PostgreSQL 이 하고 여기서는 순서만 잡는다.
 *
 * <p>임시 표를 쓴다. rule_busy(바쁜 계좌), rule_ftx(세는 거래를 통과한 거래), rule_result(적중), 경로형은 rule_walk(길)도.
 * 트랜잭션이 끝나면 사라지므로 모든 메서드는 한 트랜잭션 안에서 불러야 한다. 순서는 {@link #begin} → {@link #busy} → {@link #filtered}
 * → {@link #run} 이고, 세는 거래가 같으면 run 만 여러 번 불러도 된다.
 *
 * <p>룰 쿼리는 한 번에 하나만 돈다. 백테스트와 일일 실행은 {@link #enter} 로 같은 줄에 서고 끝나면 {@link #leave} 로 비킨다. 이 서버 안에서만
 * 지켜진다.
 */
@Component
public class RuleEvaluator {
  /** 쿼리 하나에 주는 시간. 넘으면 PostgreSQL 이 끊는다(SQLSTATE 57014). */
  public static final int STATEMENT_SECONDS = 120;

  private final JdbcTemplate jdbc;
  private final int busyMax;
  private final int busyWindowMinutes;
  // 먼저 온 쪽이 먼저 돈다
  private final ReentrantLock queue = new ReentrantLock(true);

  public RuleEvaluator(
      JdbcTemplate jdbc,
      @Value("${app.rules.busy.max-transactions:512}") int busyMax,
      @Value("${app.rules.busy.window-minutes:4320}") int busyWindowMinutes) {
    this.jdbc = jdbc;
    this.busyMax = Math.max(0, busyMax);
    this.busyWindowMinutes = Math.max(1, busyWindowMinutes);
  }

  /** 바쁜 계좌 기준. 0 이면 바쁜 계좌를 두지 않는다. */
  public int busyMax() {
    return busyMax;
  }

  public int busyWindowMinutes() {
    return busyWindowMinutes;
  }

  /**
   * 차례를 기다린다. 들어갔으면 끝난 뒤 반드시 {@link #leave} 를 부른다.
   *
   * @param wait 기다릴 수 있는 시간. null 이면 차례가 올 때까지
   * @return 차례가 왔으면 true, wait 안에 오지 않았으면 false
   */
  public boolean enter(Duration wait) throws InterruptedException {
    if (wait == null) {
      queue.lockInterruptibly();
      return true;
    }
    return queue.tryLock(Math.max(0, wait.toMillis()), TimeUnit.MILLISECONDS);
  }

  public void leave() {
    queue.unlock();
  }

  /** 이 트랜잭션의 룰 쿼리가 DB 를 얼마나 쓸지 묶고, 결과 표를 만든다. */
  public void begin() {
    jdbc.execute("set local statement_timeout = '" + STATEMENT_SECONDS + "s'");
    // 화면 조회와 CPU 를 나눠 쓰므로 코어 하나만 쓴다
    jdbc.execute("set local max_parallel_workers_per_gather = 0");
    jdbc.execute(
        """
        create temp table rule_result(
          subject_id bigint not null, hit_date date not null, measured jsonb not null,
          tx_ids bigint[] not null, window_start timestamptz not null, window_end timestamptz not null
        ) on commit drop
        """);
  }

  /**
   * 바쁜 계좌 표를 만든다. 바쁜 계좌 = 어느 busyWindowMinutes 구간에서든 보낸 거래 또는 받은 거래(같은 방향)가 busyMax 건을 넘는 계좌. 세는 거래
   * 필터를 걸기 전의 원장 전체로 센다. 자기 자신에게 보낸 거래는 세지 않는다.
   *
   * @param known 같은 실행에서 이미 구한 목록. null 이면 원장에서 다시 센다
   * @return 바쁜 계좌의 account_id
   */
  public List<Long> busy(List<Long> known) {
    jdbc.execute("create temp table rule_busy(account_id bigint primary key) on commit drop");
    if (busyMax == 0) return List.of();
    if (known != null) {
      for (Long account : known) jdbc.update("insert into rule_busy values(?)", account);
      return known;
    }
    // 분마다 건수를 먼저 세고(행 수가 줄어든다) 그 합을 구간으로 더한다. 구간은 그 분을 포함해 busyWindowMinutes 분이다.
    jdbc.update(
        """
        insert into rule_busy
        select distinct account_id from (
          select account_id,
                 sum(n) over (partition by account_id, side order by at
                              range between interval '%d minutes' preceding and current row) as total
          from (
            select from_account_id as account_id, 0 as side, date_trunc('minute', occurred_at) as at, count(*) as n
            from ledger.transactions
            where from_account_id <> to_account_id
            group by from_account_id, date_trunc('minute', occurred_at)
            union all
            select to_account_id, 1, date_trunc('minute', occurred_at), count(*)
            from ledger.transactions
            where from_account_id <> to_account_id
            group by to_account_id, date_trunc('minute', occurred_at)
          ) per_minute
        ) windowed
        where total > ?
        """
            .formatted(busyWindowMinutes - 1),
        busyMax);
    return jdbc.queryForList("select account_id from rule_busy order by account_id", Long.class);
  }

  /**
   * 세는 거래를 통과한 거래를 rule_ftx 에 담는다. 검사 날짜 [from, to] 의 거래와, 그 첫 거래에서 기간만큼 돌아본 거래까지 읽는다. 시각은 분으로 자른다
   * (원장이 초 단위 시각도 받는다). clean 은 양쪽 계좌가 모두 바쁜 계좌가 아닌 거래다(2홉형 · 경로형은 이 거래만 본다).
   */
  public void filtered(Map<String, Object> definition, String from, String to) {
    var filter = RuleCompiler.filter(definition);
    var args = new ArrayList<Object>(List.of(windowMinutes(definition), from, to));
    args.addAll(filter.args());
    jdbc.execute("drop table if exists rule_ftx");
    jdbc.update(
        """
        create temp table rule_ftx on commit drop as
        with bounds as (
          select min(occurred_at) - make_interval(mins => ?) - interval '1 minute' as lo,
                 max(occurred_at) + interval '1 minute' as hi
          from ledger.transactions
          where business_date between ?::date and ?::date
        )
        select t.tx_id, date_trunc('minute', t.occurred_at) as at, t.business_date,
               t.from_account_id, t.to_account_id, t.amount_usd,
               not exists (select 1 from rule_busy x
                           where x.account_id in (t.from_account_id, t.to_account_id)) as clean
        from ledger.transactions t, bounds b
        where t.from_account_id <> t.to_account_id
          and t.occurred_at >= b.lo and t.occurred_at < b.hi
          and %s
        """
            .formatted(filter.text()),
        args.toArray());
    jdbc.execute("create index on rule_ftx(from_account_id, at)");
    jdbc.execute("create index on rule_ftx(to_account_id, at)");
    jdbc.execute("analyze rule_ftx");
  }

  // 돌아보는 기간. 기간이 없는 템플릿(LARGE_TX)은 0 이다
  private static int windowMinutes(Map<String, Object> definition) {
    return definition.get("windowMinutes") instanceof Number minutes ? minutes.intValue() : 0;
  }

  /**
   * 적중을 rule_result 에 채우고(앞의 결과는 지운다) 요약을 돌려준다.
   *
   * @return subjects(적중 대상 수), hitDays(대상 × 날짜 수), evidenceTx(근거 거래 수), alertOverlap(근거 거래가 이미 있는
   *     Alert 와 겹치는 대상 수), expectedNewAlerts(어느 Alert 와도 안 겹치고 근거 거래가 2건 이상인 대상 수. 추정값), chunked(근거
   *     거래가 32건을 넘는 대상 수)
   */
  public Map<String, Object> run(Map<String, Object> definition, String from, String to) {
    return run(definition, from, to, false);
  }

  /**
   * 검사 날짜를 좁혀서 볼 날짜를 정한다. [from, to] 가운데 이 날짜들만 검사 시점으로 삼는다. {@link #run(Map, String, String,
   * boolean)} 과 {@link #triggers} · {@link #skippedBusySubjects(Map, String, String, boolean)} 에
   * listedDays = true 를 줄 때 쓰인다.
   */
  public void days(List<String> days) {
    jdbc.execute("drop table if exists rule_days");
    jdbc.execute("create temp table rule_days(business_date date primary key) on commit drop");
    for (String day : days)
      jdbc.update("insert into rule_days values(?::date) on conflict do nothing", day);
  }

  /**
   * 검사 시점의 수. 같은 대상 계좌의 같은 분은 한 번이고, 바쁜 계좌는 세지 않는다. SAME_AMOUNT 는 같은 분이어도 금액이 다르면 따로 센다. 대상이 거래인
   * 템플릿(LARGE_TX)은 세는 거래를 통과한 거래 수다.
   */
  public long triggers(Map<String, Object> definition, String from, String to, boolean listedDays) {
    String days = listedDays ? RuleCompiler.LISTED_DAYS : "";
    if (subjectIsTransaction(definition))
      return number(
          jdbc.queryForObject(
              "select count(*) from rule_ftx f where f.business_date between ?::date and ?::date"
                  + days,
              Long.class,
              from,
              to));
    String subject = subjectColumn(definition);
    return number(
        jdbc.queryForObject(
            """
            select count(*) from (
              select distinct f.%1$s, f.at%3$s from rule_ftx f
              where f.business_date between ?::date and ?::date%2$s
                and not exists (select 1 from rule_busy b where b.account_id = f.%1$s)) t
            """
                .formatted(
                    subject,
                    days,
                    "SAME_AMOUNT".equals(definition.get("template")) ? ", f.amount_usd" : ""),
            Long.class,
            from,
            to));
  }

  /** {@link #run(Map, String, String)} 과 같고, listedDays 가 true 면 {@link #days} 로 정한 날짜만 검사한다. */
  public Map<String, Object> run(
      Map<String, Object> definition, String from, String to, boolean listedDays) {
    return run(definition, from, to, listedDays, false);
  }

  /**
   * 조건값만 바꿔 다시 돌린다. 세는 거래 · 기간 · 날짜가 앞의 {@link #run} 과 같고 값 하나만 다를 때 쓴다. 경로형은 앞에서 만든 길(rule_walk)을
   * 다시 쓰므로 길을 한 번만 만든다.
   */
  public Map<String, Object> rerun(Map<String, Object> definition, String from, String to) {
    return run(definition, from, to, false, true);
  }

  private Map<String, Object> run(
      Map<String, Object> definition,
      String from,
      String to,
      boolean listedDays,
      boolean sameWalks) {
    if (RuleCompiler.path(definition.get("template")) && !sameWalks) {
      var walks = RuleCompiler.walks(definition, from, to, listedDays);
      jdbc.execute("drop table if exists rule_walk");
      jdbc.update(walks.text(), walks.args().toArray());
      jdbc.execute("analyze rule_walk");
    }
    var sql = RuleCompiler.evaluate(definition, from, to, listedDays);
    jdbc.execute("truncate rule_result");
    jdbc.update(sql.text(), sql.args().toArray());
    jdbc.execute("analyze rule_result");
    var row =
        jdbc.queryForMap(
            """
            with subject as (
              select subject_id, array_agg(distinct x) as txs
              from rule_result cross join lateral unnest(tx_ids) x group by subject_id
            ), flagged as (
              select cardinality(s.txs) as n,
                     exists (select 1 from review.alert_transactions at
                             join review.alerts a on a.alert_id = at.alert_id
                              and a.published_version = at.version and a.merged_into_alert_id is null
                             where at.tx_id = any(s.txs)) as linked
              from subject s
            )
            select count(*) as subjects,
                   count(*) filter (where linked) as alert_overlap,
                   count(*) filter (where not linked and n >= 2) as expected_new_alerts,
                   count(*) filter (where n > 32) as chunked,
                   (select count(*) from rule_result) as hit_days,
                   (select count(distinct x) from rule_result cross join lateral unnest(tx_ids) x) as evidence_tx
            from flagged
            """);
    var summary = new LinkedHashMap<String, Object>();
    summary.put("subjects", number(row.get("subjects")));
    summary.put("hitDays", number(row.get("hit_days")));
    summary.put("evidenceTx", number(row.get("evidence_tx")));
    summary.put("alertOverlap", number(row.get("alert_overlap")));
    summary.put("expectedNewAlerts", number(row.get("expected_new_alerts")));
    summary.put("chunked", number(row.get("chunked")));
    return summary;
  }

  /** 검사 날짜에 거래가 있었는데 바쁜 계좌라서 평가하지 않은 대상 계좌 수. */
  public long skippedBusySubjects(Map<String, Object> definition, String from, String to) {
    return skippedBusySubjects(definition, from, to, false);
  }

  public long skippedBusySubjects(
      Map<String, Object> definition, String from, String to, boolean listedDays) {
    // 거래가 대상이면 계좌를 돌아보지 않으므로 바쁜 계좌를 빼지 않는다
    if (subjectIsTransaction(definition)) return 0;
    String subject = subjectColumn(definition);
    return number(
        jdbc.queryForObject(
            "select count(distinct f.%1$s) from rule_ftx f join rule_busy b on b.account_id = f.%1$s where f.business_date between ?::date and ?::date%2$s"
                .formatted(subject, listedDays ? RuleCompiler.LISTED_DAYS : ""),
            Long.class,
            from,
            to));
  }

  // 대상 계좌가 거래의 어느 쪽인가
  private static String subjectColumn(Map<String, Object> definition) {
    return RuleCompiler.subjectReceives(definition) ? "to_account_id" : "from_account_id";
  }

  private static boolean subjectIsTransaction(Map<String, Object> definition) {
    return "TX".equals(RuleCompiler.subjectType(definition.get("template")));
  }

  private static long number(Object value) {
    return value == null ? 0 : ((Number) value).longValue();
  }
}
