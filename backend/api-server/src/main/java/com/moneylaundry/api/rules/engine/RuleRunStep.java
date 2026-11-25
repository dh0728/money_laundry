package com.moneylaundry.api.rules.engine;

import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 일일 실행. 분석이 ALERTS 단계에 들어와 워커를 띄우기 직전에, 시험 운영 · 운영 중인 룰 버전을 그 분석이 새로 받은 날짜에 돌려 적중을 저장한다.
 *
 * <ul>
 *   <li>도는 버전: eval_from_seq 가 이 분석의 입력 순번(input_seq)보다 작은 SHADOW · PENDING · ACTIVE 버전
 *   <li>검사 날짜: 이 분석의 TARGET 거래가 있는 거래 기준일. 원장 첫날부터 warmup-days 안의 날짜는 뺀다. 그 날짜의 거래 전체를 검사 시점으로 삼으므로
 *       같은 날짜를 백테스트한 결과와 같다
 *   <li>실행 기록은 분석 × 버전에 한 줄(rules.executions)이다. 단계가 다시 돌아도 끝났거나 실패한 버전은 다시 돌리지 않는다
 *   <li>적중은 버전 × 대상 × 날짜에 한 줄이다. 같은 날짜를 다시 검사하면 그 날짜의 적중을 새 결과로 바꾼다
 *   <li>버전 하나가 실패해도 다음 버전으로 넘어가고, 이 단계는 예외를 던지지 않는다. 룰 때문에 그날 Alert 가 막히면 안 된다
 * </ul>
 */
@Component
public class RuleRunStep {
  /** 한 분석에서 룰 전체에 쓰는 시간. 넘으면 남은 버전은 FAILED(BUDGET)로 남긴다. */
  public static final Duration BUDGET = Duration.ofMinutes(10);

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final RuleEvaluator evaluator;
  private final int warmupDays;
  private final Duration budget;

  @Autowired
  public RuleRunStep(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      RuleEvaluator evaluator,
      @Value("${app.rules.warmup-days:7}") int warmupDays) {
    this(jdbc, tx, time, evaluator, warmupDays, BUDGET);
  }

  public RuleRunStep(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      RuleEvaluator evaluator,
      int warmupDays,
      Duration budget) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.evaluator = evaluator;
    this.warmupDays = Math.max(0, warmupDays);
    this.budget = budget;
  }

  /** 실행 한 건의 결과. status 는 COMPLETED · FAILED · SKIPPED(이미 끝났거나 실패해 다시 돌리지 않음). */
  public record Outcome(long versionId, String status, String errorCode) {}

  /** 이 분석에서 돌 차례인 버전을 순서대로 실행한다. 예외를 던지지 않는다. */
  public List<Outcome> run(UUID runId) {
    try {
      return execute(runId);
    } catch (RuntimeException e) {
      System.getLogger(RuleRunStep.class.getName())
          .log(System.Logger.Level.WARNING, "룰 일일 실행을 시작하지 못했습니다. runId=" + runId, e);
      return List.of();
    }
  }

  private List<Outcome> execute(UUID runId) {
    long deadline = System.nanoTime() + budget.toNanos();
    var seqs =
        jdbc.queryForList(
            "select input_seq from analysis.runs where run_id=? and input_seq is not null",
            Long.class,
            runId);
    if (seqs.isEmpty()) return List.of();
    var versions =
        jdbc.queryForList(
            """
            select v.version_id, v.status, v.definition::text as definition
            from rules.rule_versions v
            where v.status in ('SHADOW','PENDING','ACTIVE')
              and v.eval_from_seq is not null and v.eval_from_seq < ?
            order by v.version_id
            """,
            seqs.getFirst());
    if (versions.isEmpty()) return List.of();
    // 이 분석이 새로 받은 거래의 날짜. 원장 첫날부터 warmup-days 안은 이력으로만 쓴다.
    List<String> days =
        jdbc.queryForList(
            """
            select distinct i.business_date::text from analysis.input_transactions i
            where i.run_id=? and i.input_role='TARGET'
              and i.business_date >= (select min(business_date) from ledger.transactions
                                      where integration_status='ACTIVE') + ?
            order by 1
            """,
            String.class,
            runId,
            warmupDays);
    if (days.isEmpty()) return List.of();

    var outcomes = new ArrayList<Outcome>();
    var busy = new ArrayList<Long>();
    boolean[] busyKnown = {false};
    for (var version : versions) {
      long versionId = ReviewJson.number(version.get("version_id"));
      var definition = ReviewJson.object(version.get("definition"));
      if (!RuleCompiler.supported(definition.get("template"))) continue;
      String mode = "ACTIVE".equals(version.get("status")) ? "LIVE" : "SHADOW";
      Long execution = claim(runId, versionId, mode);
      if (execution == null) {
        outcomes.add(new Outcome(versionId, "SKIPPED", null));
        continue;
      }
      String error = null;
      boolean entered = false;
      try {
        // 백테스트와 같은 줄에 선다. 남은 시간 안에 차례가 오지 않으면 이 버전은 돌리지 않는다.
        entered = evaluator.enter(Duration.ofNanos(Math.max(0, deadline - System.nanoTime())));
        if (!entered || System.nanoTime() >= deadline) error = "BUDGET";
        else evaluate(execution, versionId, mode, definition, days, busy, busyKnown);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        error = "INTERRUPTED";
      } catch (RuntimeException e) {
        System.getLogger(RuleRunStep.class.getName())
            .log(System.Logger.Level.WARNING, "룰 버전 " + versionId + " 일일 실행 실패", e);
        error = timeout(e) ? "TIMEOUT" : "INTERNAL";
      } finally {
        if (entered) evaluator.leave();
      }
      if (error != null) {
        jdbc.update(
            "update rules.executions set status='FAILED', error_code=?, finished_at=? where execution_id=?",
            error,
            Timestamp.from(time.now()),
            execution);
        // 실패는 지금의 룰 담당자와 관리자 전원에게 알린다(V3 의 rules.notifications 뷰가 읽는다)
        jdbc.update(
            """
            insert into rules.execution_recipients(execution_id,user_id)
            select ?,who from (
              select r.owner_id as who from rules.rule_versions v join rules.rules r using(rule_id) where v.version_id=?
              union select user_id from core.users where role='ADMIN') people
            on conflict do nothing
            """,
            execution,
            versionId);
      }
      outcomes.add(new Outcome(versionId, error == null ? "COMPLETED" : "FAILED", error));
      if ("INTERRUPTED".equals(error)) break;
    }
    return outcomes;
  }

  /** 실행 기록을 잡는다. 이 분석에서 이미 끝났거나 실패한 버전이면 null. */
  private Long claim(UUID runId, long versionId, String mode) {
    return tx.execute(
        s -> {
          Timestamp at = Timestamp.from(time.now());
          jdbc.update(
              """
              insert into rules.executions(run_id, version_id, mode, status, busy_max, busy_window_minutes)
              values(?,?,?,'QUEUED',?,?) on conflict(run_id, version_id) do nothing
              """,
              runId,
              versionId,
              mode,
              evaluator.busyMax(),
              evaluator.busyWindowMinutes());
          var rows =
              jdbc.queryForList(
                  "select execution_id, status from rules.executions where run_id=? and version_id=? for update",
                  runId,
                  versionId);
          var row = rows.getFirst();
          String status = row.get("status").toString();
          if ("COMPLETED".equals(status) || "FAILED".equals(status)) return null;
          long id = ReviewJson.number(row.get("execution_id"));
          // RUNNING 으로 남아 있으면 서버가 도중에 멈춘 것이다. 다시 돌린다.
          jdbc.update(
              """
              update rules.executions set status='RUNNING', mode=?, attempt_count=attempt_count+1, started_at=?,
                busy_max=?, busy_window_minutes=? where execution_id=?
              """,
              mode,
              at,
              evaluator.busyMax(),
              evaluator.busyWindowMinutes(),
              id);
          return id;
        });
  }

  private void evaluate(
      long execution,
      long versionId,
      String mode,
      Map<String, Object> definition,
      List<String> days,
      List<Long> busy,
      boolean[] busyKnown) {
    String from = days.getFirst();
    String to = days.getLast();
    // 적중의 대상이 계좌인가 거래인가(LARGE_TX)
    String subjectType = RuleCompiler.subjectType(definition.get("template"));
    tx.executeWithoutResult(
        s -> {
          evaluator.begin();
          // 바쁜 계좌는 버전마다 같으므로 한 번만 센다
          var found = evaluator.busy(busyKnown[0] ? busy : null);
          if (!busyKnown[0]) {
            busy.addAll(found);
            busyKnown[0] = true;
          }
          evaluator.filtered(definition, from, to);
          evaluator.days(days);
          var summary = evaluator.run(definition, from, to, true);
          long triggers = evaluator.triggers(definition, from, to, true);
          long skipped = evaluator.skippedBusySubjects(definition, from, to, true);
          Timestamp at = Timestamp.from(time.now());
          // 다시 검사한 날짜의 적중은 새 결과로 바꾼다
          jdbc.update(
              "delete from rules.hits where version_id=? and hit_date in (select business_date from rule_days)",
              versionId);
          jdbc.update(
              """
              insert into rules.hits(version_id, execution_id, mode, creates_alert, subject_type, subject_id,
                hit_date, window_start, window_end, measured, created_at)
              select ?, ?, ?, ?, ?, subject_id, hit_date, window_start, window_end, measured, ?
              from rule_result
              """,
              versionId,
              execution,
              mode,
              "CREATE_ALERT".equals(definition.get("then")),
              subjectType,
              at);
          jdbc.update(
              """
              insert into rules.hit_transactions(hit_id, tx_id)
              select h.hit_id, x
              from rule_result r
              join rules.hits h on h.version_id=? and h.subject_type=?
                and h.subject_id=r.subject_id and h.hit_date=r.hit_date
              cross join lateral unnest(r.tx_ids) x
              """,
              versionId,
              subjectType);
          jdbc.update(
              """
              update rules.executions set status='COMPLETED', error_code=null, finished_at=?,
                trigger_count=?, hit_count=?, skipped_subjects=? where execution_id=?
              """,
              at,
              (int) Math.min(Integer.MAX_VALUE, triggers),
              ((Number) summary.get("hitDays")).intValue(),
              (int) skipped,
              execution);
        });
  }

  private static boolean timeout(Throwable error) {
    for (Throwable cause = error; cause != null; cause = cause.getCause())
      if (cause instanceof SQLException sql && "57014".equals(sql.getSQLState())) return true;
    return false;
  }
}
