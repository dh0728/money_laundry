package com.moneylaundry.api.rules.backtest;

import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleCompiler;
import com.moneylaundry.api.rules.engine.RuleEvaluator;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 백테스트를 한 번에 하나씩 돌린다. 전용 스레드 하나가 접수 순서대로 처리한다.
 *
 * <p>한 번의 백테스트는 세 트랜잭션이다. ① 새 버전을 기간 전체에 돌리고, 같은 세는 거래로 값만 바꿔 다시 돌린다 ② 비교 기준 버전을 같은 기간에 돌린다 ③ 대상마다
 * Alert 와 사람 판정을 붙이고 숫자를 정리한다. 임시 표가 트랜잭션에 묶여 있어서 이렇게 나눴다. 진행률은 쿼리를 하나 끝낼 때마다 메모리에 올리고 트랜잭션이 끝날 때
 * DB 에 적는다.
 */
@Component
public class BacktestRunner implements SmartInitializingSingleton, DisposableBean {
  /** 값을 바꿔 다시 돌려 보는 횟수의 상한(이번 값 포함). */
  static final int SWEEP_VALUES = 5;

  private static final class Cancelled extends RuntimeException {}

  // rule_result(대상 × 날짜)를 대상마다 한 줄로 모을 때 쓰는 줄. 근거 거래는 기간 전체의 것을 합치고, 측정값은 근거 거래가 가장 많은 날의 것이다.
  private static final String SUBJECT_ROWS =
      """
      select r.subject_id, x,
             first_value(r.measured) over (partition by r.subject_id
                                           order by cardinality(r.tx_ids) desc, r.hit_date desc) as measured
      from rule_result r cross join lateral unnest(r.tx_ids) x
      """;

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final RuleCatalog catalog;
  private final RuleEvaluator evaluator;
  private final ExecutorService worker =
      Executors.newSingleThreadExecutor(
          task -> {
            var thread = new Thread(task, "rule-backtest");
            thread.setDaemon(true);
            return thread;
          });
  private final Map<Long, Integer> progress = new ConcurrentHashMap<>();

  public BacktestRunner(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      RuleCatalog catalog,
      RuleEvaluator evaluator) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.catalog = catalog;
    this.evaluator = evaluator;
  }

  /** 서버가 꺼질 때 돌던 것은 실패로 남기고, 접수만 된 것은 다시 줄에 세운다. */
  @Override
  public void afterSingletonsInstantiated() {
    jdbc.update(
        "update rules.backtests set status='FAILED', error_code='INTERRUPTED', finished_at=? where status='RUNNING'",
        Timestamp.from(time.now()));
    for (Long id :
        jdbc.queryForList(
            "select backtest_id from rules.backtests where status='QUEUED' order by backtest_id",
            Long.class)) submit(id);
  }

  @Override
  public void destroy() {
    worker.shutdownNow();
  }

  /** 줄에 세운다. 접수한 트랜잭션이 끝난 뒤에 부른다. */
  public void submit(long backtestId) {
    worker.execute(() -> process(backtestId));
  }

  /** 돌고 있는 백테스트의 진행률(0 ~ 100). 이 서버에서 돌고 있지 않으면 null. */
  public Integer progress(long backtestId) {
    return progress.get(backtestId);
  }

  private void step(long id, int done, int total) {
    progress.put(id, Math.min(99, done * 100 / total));
    Boolean cancel =
        jdbc.queryForObject(
            "select cancel_requested from rules.backtests where backtest_id=?", Boolean.class, id);
    if (Boolean.TRUE.equals(cancel)) throw new Cancelled();
  }

  private void saveProgress(long id) {
    Integer value = progress.get(id);
    if (value != null)
      jdbc.update("update rules.backtests set progress=? where backtest_id=?", value, id);
  }

  /** 백테스트 한 건을 끝까지 돌린다. 실패 · 취소도 여기서 상태로 남긴다. */
  public void process(long id) {
    var rows =
        jdbc.queryForList(
            """
            select b.version_id, b.baseline_version_id, b.date_from::text as date_from, b.date_to::text as date_to,
                   v.rule_id, v.version_no, v.definition::text as definition,
                   bv.version_no as base_no, bv.summary as base_summary, bv.definition::text as base_definition
            from rules.backtests b join rules.rule_versions v on v.version_id=b.version_id
            left join rules.rule_versions bv on bv.version_id=b.baseline_version_id
            where b.backtest_id=? and b.status='QUEUED'
            """,
            id);
    if (rows.isEmpty()) return;
    var row = rows.getFirst();
    int started =
        jdbc.update(
            "update rules.backtests set status='RUNNING', started_at=?, progress=0 where backtest_id=? and status='QUEUED' and not cancel_requested",
            Timestamp.from(time.now()),
            id);
    if (started == 0) {
      finish(id, "CANCELLED", null, null);
      return;
    }
    try {
      run(id, row);
    } catch (Cancelled e) {
      finish(id, "CANCELLED", null, null);
    } catch (RuntimeException e) {
      System.getLogger(BacktestRunner.class.getName())
          .log(System.Logger.Level.WARNING, "룰 백테스트 " + id + " 실패", e);
      finish(id, "FAILED", timeout(e) ? "TIMEOUT" : "INTERNAL", null);
    } finally {
      progress.remove(id);
    }
  }

  private static boolean timeout(Throwable error) {
    for (Throwable cause = error; cause != null; cause = cause.getCause())
      if (cause instanceof SQLException sql && "57014".equals(sql.getSQLState())) return true;
    return false;
  }

  private void finish(long id, String status, String error, String result) {
    tx.executeWithoutResult(
        s -> {
          if (!"COMPLETED".equals(status))
            jdbc.update("delete from rules.backtest_subjects where backtest_id=?", id);
          jdbc.update(
              "update rules.backtests set status=?, error_code=?, result=?::jsonb, finished_at=?, progress=case when ?='COMPLETED' then 100 else progress end where backtest_id=?",
              status,
              error,
              result,
              Timestamp.from(time.now()),
              status,
              id);
        });
  }

  private void run(long id, Map<String, Object> row) {
    var definition = ReviewJson.object(row.get("definition"));
    var baseline =
        row.get("base_definition") == null ? null : ReviewJson.object(row.get("base_definition"));
    String from = row.get("date_from").toString();
    String to = row.get("date_to").toString();
    var template = catalog.template(definition.get("template").toString());
    String sweepMetric = template.get("sweep") == null ? null : template.get("sweep").toString();
    Number current = sweepMetric == null ? null : RuleCompiler.metricValue(definition, sweepMetric);
    List<Long> values =
        current == null
            ? List.of()
            : sweepValues(
                current.longValue(),
                baseline == null ? null : RuleCompiler.metricValue(baseline, sweepMetric),
                catalog.metric(sweepMetric));
    int total = 1 + Math.max(0, values.size() - 1) + (baseline == null ? 0 : 1) + 1;
    var done = new int[] {0};
    var result = new LinkedHashMap<String, Object>();
    var busy = new ArrayList<Long>();

    // ① 새 버전. 세는 거래가 같으므로 값만 바꾼 실행도 같은 트랜잭션에서 돌린다.
    tx.executeWithoutResult(
        s -> {
          evaluator.begin();
          busy.addAll(evaluator.busy(null));
          evaluator.filtered(definition, from, to);
          var summary = evaluator.run(definition, from, to);
          jdbc.update(
              """
              insert into rules.backtest_subjects(backtest_id, subject_type, subject_id, in_new, in_base, measured, tx_ids)
              select ?, 'ACCOUNT', subject_id, true, false, measured, array_agg(distinct x order by x)
              from (%s) per_tx
              group by subject_id, measured
              """
                  .formatted(SUBJECT_ROWS),
              id);
          result.put("summary", summary);
          result.put("skippedBusySubjects", evaluator.skippedBusySubjects(definition, from, to));
          result.put(
              "txCount",
              jdbc.queryForObject(
                  "select count(*) from ledger.transactions where integration_status='ACTIVE' and from_account_id<>to_account_id and business_date between ?::date and ?::date",
                  Long.class,
                  from,
                  to));
          step(id, ++done[0], total);
          var sweep = new ArrayList<Map<String, Object>>();
          for (Long value : values) {
            boolean same = value == current.longValue();
            var counted =
                same
                    ? summary
                    : evaluator.run(
                        RuleCompiler.withMetricValue(definition, sweepMetric, value), from, to);
            var line = new LinkedHashMap<String, Object>();
            line.put("value", value);
            line.put("current", same);
            line.put("hits", counted.get("subjects"));
            line.put("txCount", counted.get("evidenceTx"));
            line.put("alertOverlap", counted.get("alertOverlap"));
            line.put("expectedNewAlerts", counted.get("expectedNewAlerts"));
            sweep.add(line);
            if (!same) step(id, ++done[0], total);
          }
          result.put("sweep", sweep);
          saveProgress(id);
        });

    // ② 비교 기준. 같은 기간, 같은 바쁜 계좌로 돌린다.
    if (baseline != null)
      tx.executeWithoutResult(
          s -> {
            evaluator.begin();
            evaluator.busy(busy);
            evaluator.filtered(baseline, from, to);
            result.put("baseSummary", evaluator.run(baseline, from, to));
            jdbc.update(
                """
                insert into rules.backtest_subjects(backtest_id, subject_type, subject_id, in_new, in_base, measured, tx_ids)
                select ?, 'ACCOUNT', subject_id, false, true, measured, array_agg(distinct x order by x)
                from (%s) per_tx
                group by subject_id, measured
                on conflict (backtest_id, subject_type, subject_id) do update set in_base=true
                """
                    .formatted(SUBJECT_ROWS),
                id);
            step(id, ++done[0], total);
            saveProgress(id);
          });

    // ③ 대상마다 거래가 가장 많이 겹치는 Alert 하나와 그 Alert 의 사람 판정을 붙인다. Episode 에 편입된 Alert 는 그 Episode 의 판정을
    // 따른다.
    tx.executeWithoutResult(
        s -> {
          jdbc.update(
              """
              with link as (
                select b.subject_type, b.subject_id, a.alert_id, count(*) as shared,
                       case when a.outcome = 'TRANSFERRED' then e.outcome else a.outcome end as outcome
                from rules.backtest_subjects b cross join lateral unnest(b.tx_ids) x
                join review.alert_transactions at on at.tx_id = x
                join review.alerts a on a.alert_id = at.alert_id and a.published_version = at.version
                 and a.merged_into_alert_id is null
                left join review.episode_alerts ea on ea.alert_id = a.alert_id
                left join review.episodes e on e.episode_id = ea.episode_id
                where b.backtest_id = ?
                group by b.subject_type, b.subject_id, a.alert_id, a.outcome, e.outcome
              ), best as (
                select distinct on (subject_type, subject_id) * from link
                order by subject_type, subject_id, shared desc, alert_id
              )
              update rules.backtest_subjects b
              set alert_id = best.alert_id,
                  judgement = case when best.outcome in ('SUSPICIOUS', 'NORMAL') then best.outcome end
              from best
              where b.backtest_id = ? and b.subject_type = best.subject_type and b.subject_id = best.subject_id
              """,
              id,
              id);
          var counts =
              jdbc.queryForMap(
                  """
                  select count(*) filter (where in_new) as hits,
                         count(*) filter (where in_base) as base_hits,
                         count(*) filter (where in_new and not in_base) as added,
                         count(*) filter (where in_base and not in_new) as dropped,
                         count(*) filter (where in_new and judgement='SUSPICIOUS') as suspicious,
                         count(*) filter (where in_new and judgement='NORMAL') as normal,
                         count(*) filter (where in_base and judgement='SUSPICIOUS') as base_suspicious,
                         count(*) filter (where in_base and judgement='NORMAL') as base_normal
                  from rules.backtest_subjects where backtest_id=?
                  """,
                  id);
          String json =
              ReviewJson.encode(result(row, result, counts, baseline != null, sweepMetric));
          jdbc.update(
              "update rules.backtests set status='COMPLETED', result=?::jsonb, tx_count=?, finished_at=?, progress=100 where backtest_id=?",
              json,
              result.get("txCount"),
              Timestamp.from(time.now()),
              id);
          var snapshot = new LinkedHashMap<String, Object>();
          snapshot.put("backtestId", id);
          snapshot.put("versionNo", row.get("version_no"));
          snapshot.put("hits", counts.get("hits"));
          jdbc.update(
              "insert into rules.events(rule_id,version_id,actor_id,action,snapshot,business_at) select ?,?,requested_by,'BACKTEST_DONE',?::jsonb,? from rules.backtests where backtest_id=?",
              row.get("rule_id"),
              row.get("version_id"),
              ReviewJson.encode(snapshot),
              Timestamp.from(time.now()),
              id);
        });
  }

  private static long count(Object value) {
    return value == null ? 0 : ((Number) value).longValue();
  }

  /** 사람이 종결한 Alert 가운데 의심 판정의 비율(%). 판정이 없으면 null. */
  private static Double precision(Object suspicious, Object normal) {
    long judged = count(suspicious) + count(normal);
    return judged == 0 ? null : Math.round(count(suspicious) * 1000.0 / judged) / 10.0;
  }

  private Map<String, Object> result(
      Map<String, Object> row,
      Map<String, Object> run,
      Map<String, Object> counts,
      boolean compared,
      String sweepMetric) {
    @SuppressWarnings("unchecked")
    var summary = (Map<String, Object>) run.get("summary");
    long txCount = count(run.get("txCount"));
    var kpis = new LinkedHashMap<String, Object>();
    kpis.put("hits", count(counts.get("hits")));
    kpis.put("added", compared ? count(counts.get("added")) : null);
    kpis.put("dropped", compared ? count(counts.get("dropped")) : null);
    kpis.put("precision", precision(counts.get("suspicious"), counts.get("normal")));
    kpis.put("judged", count(counts.get("suspicious")) + count(counts.get("normal")));
    kpis.put("baseHits", compared ? count(counts.get("base_hits")) : null);
    kpis.put(
        "basePrecision",
        compared ? precision(counts.get("base_suspicious"), counts.get("base_normal")) : null);
    kpis.put(
        "baseJudged",
        compared ? count(counts.get("base_suspicious")) + count(counts.get("base_normal")) : null);
    var result = new LinkedHashMap<String, Object>();
    result.put("kpis", kpis);
    result.put("txCount", txCount);
    result.put("evidenceTxCount", summary.get("evidenceTx"));
    // 검사한 거래 가운데 근거 거래가 차지하는 비율(%). 룰이 원장을 얼마나 덮는지 본다.
    result.put(
        "evidenceShare",
        txCount == 0
            ? null
            : Math.round(count(summary.get("evidenceTx")) * 10000.0 / txCount) / 100.0);
    result.put("hitDays", summary.get("hitDays"));
    result.put("alertOverlap", summary.get("alertOverlap"));
    result.put("expectedNewAlerts", summary.get("expectedNewAlerts"));
    result.put("chunkedCount", summary.get("chunked"));
    result.put("skippedBusySubjects", run.get("skippedBusySubjects"));
    var busy = new LinkedHashMap<String, Object>();
    busy.put("maxTransactions", evaluator.busyMax());
    busy.put("windowMinutes", evaluator.busyWindowMinutes());
    result.put("busy", busy);
    if (sweepMetric != null && !((List<?>) run.get("sweep")).isEmpty()) {
      var definition = ReviewJson.object(row.get("definition"));
      var spec = catalog.metric(sweepMetric);
      String side =
          RuleCatalog.side(
              catalog.template(definition.get("template").toString()), definition.get("direction"));
      var sweep = new LinkedHashMap<String, Object>();
      sweep.put("metric", sweepMetric);
      sweep.put("label", RuleCatalog.text(spec.get("label"), side));
      sweep.put("unit", spec.get("unit"));
      sweep.put("rows", run.get("sweep"));
      result.put("sweep", sweep);
    }
    return result;
  }

  /**
   * 값을 바꿔 돌려 볼 후보. 비교 기준이 있으면 그 값과 이번 값, 그 사이, 한 단계 아래다. 비교 기준이 없으면 이번 값의 아래위 두 단계다. 항목의 허용 범위를 벗어난
   * 값은 빼고, 많으면 이번 값에 가까운 것부터 남긴다.
   */
  static List<Long> sweepValues(long current, Number base, Map<String, Object> spec) {
    long step = Math.max(1, count(spec.get("step")));
    long low = base == null ? current - 2 * step : Math.min(current, base.longValue()) - step;
    long high = base == null ? current + 2 * step : Math.max(current, base.longValue());
    long min = spec.get("min") == null ? Long.MIN_VALUE : count(spec.get("min"));
    long max = spec.get("max") == null ? Long.MAX_VALUE : count(spec.get("max"));
    var values = new TreeSet<Long>();
    for (long value = low; value <= high; value += step)
      if (value >= min && value <= max) values.add(value);
    values.add(current);
    if (base != null && base.longValue() >= min && base.longValue() <= max)
      values.add(base.longValue());
    while (values.size() > SWEEP_VALUES) {
      long first = values.first(), last = values.last();
      boolean keepFirst = base != null && first == base.longValue();
      boolean keepLast = base != null && last == base.longValue();
      if (!keepLast
          && (keepFirst || Math.abs(last - current) >= Math.abs(first - current))
          && last != current) values.remove(last);
      else if (!keepFirst && first != current) values.remove(first);
      else values.remove(values.higher(first));
    }
    return new ArrayList<>(values);
  }
}
