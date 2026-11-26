package com.moneylaundry.api.rules.backtest;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.RuleService;
import com.moneylaundry.api.rules.engine.RuleCompiler;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 백테스트 접수 · 조회 · 취소. 실행은 {@link BacktestRunner} 가 한다. */
@Service
public class BacktestService {
  public record Request(Long versionId, Long baselineVersionId, String from, String to) {}

  /** 한 번에 검사하는 날짜 수의 상한. */
  public static final int MAX_DAYS = 90;

  /** 결과에 싣는 사례 줄 수의 상한. */
  static final int CASES = 200;

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final RuleService rules;
  private final BacktestRunner runner;
  private final int warmupDays;

  public BacktestService(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      RuleService rules,
      BacktestRunner runner,
      @Value("${app.rules.warmup-days:7}") int warmupDays) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.rules = rules;
    this.runner = runner;
    this.warmupDays = Math.max(0, warmupDays);
  }

  private static ApiException invalid(String detail) {
    return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", detail);
  }

  private static LocalDate date(String value, String label) {
    try {
      return value == null || value.isBlank() ? null : LocalDate.parse(value);
    } catch (DateTimeParseException e) {
      throw invalid(label + " 날짜는 YYYY-MM-DD 로 적어야 합니다.");
    }
  }

  /** 원장의 첫 거래 기준일과 마지막 거래 기준일. 거래가 없으면 400. */
  private LocalDate[] ledger() {
    var ledger =
        jdbc.queryForMap(
            "select min(business_date)::text as first, max(business_date)::text as last from ledger.transactions where integration_status='ACTIVE'");
    if (ledger.get("first") == null) throw invalid("원장에 거래가 없어 백테스트를 돌릴 수 없습니다.");
    return new LocalDate[] {
      LocalDate.parse(ledger.get("first").toString()),
      LocalDate.parse(ledger.get("last").toString())
    };
  }

  /**
   * 검사할 날짜 범위. 원장 첫날부터 warmupDays 일은 이력으로만 쓰므로 검사 날짜에서 뺀다(그 거래도 돌아보는 쪽에는 들어간다). 기간을 안 주면 그 뒤부터 원장
   * 마지막 날까지이고, 90일을 넘으면 마지막 90일이다.
   *
   * @param ledger {@link #ledger()} 가 준 원장의 첫날과 마지막 날
   */
  private LocalDate[] period(LocalDate[] ledger, String from, String to) {
    LocalDate first = ledger[0];
    LocalDate last = ledger[1];
    LocalDate earliest = first.plusDays(warmupDays);
    LocalDate start = date(from, "시작");
    LocalDate end = date(to, "끝");
    if (start != null && end != null && start.isAfter(end)) throw invalid("시작 날짜가 끝 날짜보다 늦습니다.");
    if (end == null || end.isAfter(last)) end = last;
    boolean chosen = start != null;
    if (start == null || start.isBefore(earliest)) start = earliest;
    if (start.isAfter(end))
      throw invalid(
          "검사할 날짜가 없습니다. 원장은 %s ~ %s 이고 첫 %d일은 이력으로만 씁니다.".formatted(first, last, warmupDays));
    if (ChronoUnit.DAYS.between(start, end) + 1 > MAX_DAYS) {
      if (chosen) throw invalid("백테스트 기간은 " + MAX_DAYS + "일까지입니다.");
      start = end.minusDays(MAX_DAYS - 1);
    }
    return new LocalDate[] {start, end};
  }

  /**
   * 화면이 검사 기간을 고를 때 쓰는 범위. ledgerFrom ~ ledgerTo 는 원장의 첫날과 마지막 날, earliest 는 검사할 수 있는 가장 이른 날(원장 첫날
   * + warmupDays), from ~ to 는 기간을 안 주고 접수했을 때 검사하는 날짜다. 원장이 비었거나 검사할 날짜가 없으면 400.
   */
  public Map<String, Object> range() {
    var ledger = ledger();
    var days = period(ledger, null, null);
    var view = new LinkedHashMap<String, Object>();
    view.put("ledgerFrom", ledger[0].toString());
    view.put("ledgerTo", ledger[1].toString());
    view.put("earliest", ledger[0].plusDays(warmupDays).toString());
    view.put("from", days[0].toString());
    view.put("to", days[1].toString());
    view.put("days", ChronoUnit.DAYS.between(days[0], days[1]) + 1);
    view.put("warmupDays", warmupDays);
    view.put("maxDays", MAX_DAYS);
    return view;
  }

  /** 백테스트를 접수한다. 같은 버전 · 같은 조건 · 같은 기간이 이미 줄에 있거나 돌고 있으면 그것을 돌려준다. */
  public Map<String, Object> request(long user, Request in) {
    if (in == null || in.versionId() == null) throw invalid("백테스트할 버전을 골라야 합니다.");
    var versions =
        jdbc.queryForList(
            """
            select v.version_id, v.rule_id, v.status, v.definition::text as definition, v.definition_digest, r.template,
                   (select o.version_id from rules.rule_versions o
                    where o.rule_id=v.rule_id and o.status in ('ACTIVE','PAUSED') and o.version_id<>v.version_id) as operating_id
            from rules.rule_versions v join rules.rules r using(rule_id) where v.version_id=?
            """,
            in.versionId());
    if (versions.isEmpty()) throw ApiException.notFound("룰 버전을 찾을 수 없습니다.");
    var version = versions.getFirst();
    long ruleId = ReviewJson.number(version.get("rule_id"));
    String template = version.get("template").toString();
    if (!RuleCompiler.supported(template)) throw invalid("이 템플릿의 백테스트는 아직 제공하지 않습니다.");
    var definition = ReviewJson.object(version.get("definition"));
    if (!rules.check(template, definition, ruleId).canRun())
      throw invalid("검토 체크리스트를 모두 통과한 조건만 백테스트할 수 있습니다.");
    Long baseline = in.baselineVersionId();
    if (baseline == null && version.get("operating_id") != null)
      baseline = ReviewJson.number(version.get("operating_id"));
    if (baseline != null) {
      if (baseline.equals(in.versionId())) throw invalid("비교 기준은 다른 버전이어야 합니다.");
      Integer same =
          jdbc.queryForObject(
              "select count(*) from rules.rule_versions where version_id=? and rule_id=?",
              Integer.class,
              baseline,
              ruleId);
      if (same == null || same == 0) throw invalid("비교 기준은 같은 룰의 버전이어야 합니다.");
    }
    var days = period(ledger(), in.from(), in.to());
    String digest = version.get("definition_digest").toString();
    Long base = baseline;
    Long id =
        tx.execute(
            s -> {
              var active =
                  jdbc.queryForList(
                      """
                      select backtest_id from rules.backtests
                      where version_id=? and definition_digest=? and baseline_version_id is not distinct from ?
                        and date_from=?::date and date_to=?::date and status in ('QUEUED','RUNNING') and not cancel_requested
                      order by backtest_id desc limit 1
                      """,
                      Long.class,
                      in.versionId(),
                      digest,
                      base,
                      days[0].toString(),
                      days[1].toString());
              if (!active.isEmpty()) return -active.getFirst();
              return jdbc.queryForObject(
                  """
                  insert into rules.backtests(version_id, definition_digest, baseline_version_id, date_from, date_to, status, requested_by, requested_at)
                  values(?,?,?,?::date,?::date,'QUEUED',?,?) returning backtest_id
                  """,
                  Long.class,
                  in.versionId(),
                  digest,
                  base,
                  days[0].toString(),
                  days[1].toString(),
                  user,
                  Timestamp.from(time.now()));
            });
    if (id > 0) runner.submit(id);
    var view = new LinkedHashMap<String, Object>();
    view.put("backtestId", Math.abs(id));
    view.put("status", id > 0 ? "QUEUED" : status(Math.abs(id)));
    return view;
  }

  private String status(long id) {
    return jdbc.queryForObject(
        "select status from rules.backtests where backtest_id=?", String.class, id);
  }

  private static String text(Object timestamp) {
    return timestamp == null ? null : ((Timestamp) timestamp).toInstant().toString();
  }

  private static final String HEAD =
      """
      select b.backtest_id, b.status, b.progress, b.cancel_requested, b.date_from::text as date_from, b.date_to::text as date_to,
             b.tx_count, b.error_code, b.requested_at, b.started_at, b.finished_at, b.definition_digest,
             b.version_id, v.version_no, v.definition_digest as current_digest, v.summary,
             v.rule_id, r.name, r.template, b.baseline_version_id, bv.version_no as base_no, bv.summary as base_summary,
             u.name as requested_by
      from rules.backtests b
      join rules.rule_versions v on v.version_id=b.version_id
      join rules.rules r on r.rule_id=v.rule_id
      left join rules.rule_versions bv on bv.version_id=b.baseline_version_id
      join core.users u on u.user_id=b.requested_by
      """;

  private Map<String, Object> head(Map<String, Object> row) {
    long id = ReviewJson.number(row.get("backtest_id"));
    String status = row.get("status").toString();
    var view = new LinkedHashMap<String, Object>();
    view.put("backtestId", id);
    view.put("status", status);
    Integer running = "RUNNING".equals(status) ? runner.progress(id) : null;
    view.put("progress", running != null ? running : row.get("progress"));
    view.put("cancelRequested", row.get("cancel_requested"));
    view.put("errorCode", row.get("error_code"));
    view.put("ruleId", row.get("rule_id"));
    view.put("code", RuleService.code(ReviewJson.number(row.get("rule_id"))));
    view.put("name", row.get("name"));
    view.put("template", row.get("template"));
    view.put("versionId", row.get("version_id"));
    view.put("versionNo", row.get("version_no"));
    view.put("summary", row.get("summary"));
    // 백테스트를 돌린 뒤에 조건을 고쳤으면 false. 그 결과는 지금 조건의 것이 아니다.
    view.put("currentDefinition", row.get("definition_digest").equals(row.get("current_digest")));
    if (row.get("baseline_version_id") == null) view.put("baseline", null);
    else {
      var baseline = new LinkedHashMap<String, Object>();
      baseline.put("versionId", row.get("baseline_version_id"));
      baseline.put("versionNo", row.get("base_no"));
      baseline.put("summary", row.get("base_summary"));
      view.put("baseline", baseline);
    }
    var period = new LinkedHashMap<String, Object>();
    period.put("from", row.get("date_from"));
    period.put("to", row.get("date_to"));
    period.put(
        "days",
        ChronoUnit.DAYS.between(
                LocalDate.parse(row.get("date_from").toString()),
                LocalDate.parse(row.get("date_to").toString()))
            + 1);
    view.put("period", period);
    view.put("requestedBy", row.get("requested_by"));
    view.put("requestedAt", text(row.get("requested_at")));
    view.put("startedAt", text(row.get("started_at")));
    view.put("finishedAt", text(row.get("finished_at")));
    return view;
  }

  /** 상태와 결과. 끝난 백테스트는 숫자(result)와 사례(cases)가 같이 온다. */
  public Map<String, Object> view(long backtestId) {
    var rows = jdbc.queryForList(HEAD + " where b.backtest_id=?", backtestId);
    if (rows.isEmpty()) throw ApiException.notFound("백테스트를 찾을 수 없습니다.");
    var view = head(rows.getFirst());
    if (!"COMPLETED".equals(view.get("status"))) return view;
    view.putAll(
        ReviewJson.object(
            jdbc.queryForObject(
                "select result::text from rules.backtests where backtest_id=?",
                String.class,
                backtestId)));
    boolean compared = view.get("baseline") != null;
    var cases = new ArrayList<Map<String, Object>>();
    // 새로 걸린 것, 빠진 것, 그대로인 것 순서. 같은 묶음 안에서는 근거 거래가 많은 대상부터.
    for (var row :
        jdbc.queryForList(
            """
            select s.subject_type, s.subject_id, left(a.service_account_id::text, 8) as account,
                   t.occurred_at, s.in_new, s.in_base, s.measured::text as measured,
                   cardinality(s.tx_ids) as tx_count, s.alert_id, s.judgement
            from rules.backtest_subjects s
            left join core.accounts a on s.subject_type='ACCOUNT' and a.account_id=s.subject_id
            left join ledger.transactions t on s.subject_type='TX' and t.tx_id=s.subject_id
            where s.backtest_id=?
            order by (s.in_new and not s.in_base) desc, (s.in_base and not s.in_new) desc,
                     cardinality(s.tx_ids) desc, s.subject_id
            limit ?
            """,
            backtestId,
            CASES)) {
      boolean inNew = Boolean.TRUE.equals(row.get("in_new"));
      boolean inBase = Boolean.TRUE.equals(row.get("in_base"));
      var item = new LinkedHashMap<String, Object>();
      // 대상이 거래면(LARGE_TX) subject 는 거래 ID 이고, 화면이 거래 코드를 만들 수 있게 txId · occurredAt 을 같이 준다
      boolean transaction = "TX".equals(row.get("subject_type"));
      item.put("subjectType", row.get("subject_type"));
      item.put("subject", transaction ? row.get("subject_id").toString() : row.get("account"));
      if (transaction) {
        item.put("txId", row.get("subject_id"));
        item.put("occurredAt", text(row.get("occurred_at")));
      }
      item.put("state", !compared ? "HIT" : inNew && inBase ? "KEPT" : inNew ? "ADDED" : "DROPPED");
      item.put("measured", ReviewJson.object(row.get("measured")));
      item.put("txCount", row.get("tx_count"));
      item.put("alertId", row.get("alert_id"));
      item.put("judgement", row.get("judgement"));
      cases.add(item);
    }
    view.put("cases", cases);
    return view;
  }

  /** 한 룰의 백테스트 기록. 최근 것부터 20건. */
  public List<Map<String, Object>> list(long ruleId) {
    var list = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            HEAD + " where v.rule_id=? order by b.backtest_id desc limit 20", ruleId)) {
      var view = head(row);
      view.put("txCount", row.get("tx_count"));
      list.add(view);
    }
    return list;
  }

  /** 취소를 요청한다. 줄에 서 있으면 바로 취소되고, 돌고 있으면 지금 쿼리가 끝난 뒤에 멈춘다. */
  public Map<String, Object> cancel(long backtestId) {
    int changed =
        jdbc.update(
            "update rules.backtests set cancel_requested=true where backtest_id=? and status in ('QUEUED','RUNNING')",
            backtestId);
    if (changed == 0) {
      status(backtestIdOrMissing(backtestId));
      throw ApiException.invalidTransition("이미 끝난 백테스트는 취소할 수 없습니다.");
    }
    // 줄에 서 있던 것은 실행기가 집기 전에 여기서 끝낸다
    jdbc.update(
        "update rules.backtests set status='CANCELLED', finished_at=? where backtest_id=? and status='QUEUED'",
        Timestamp.from(time.now()),
        backtestId);
    return view(backtestId);
  }

  private long backtestIdOrMissing(long backtestId) {
    Integer found =
        jdbc.queryForObject(
            "select count(*) from rules.backtests where backtest_id=?", Integer.class, backtestId);
    if (found == null || found == 0) throw ApiException.notFound("백테스트를 찾을 수 없습니다.");
    return backtestId;
  }
}
