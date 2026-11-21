package com.moneylaundry.api.rules;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.dashboard.DashboardProjection;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 룰엔진 화면의 룰 목록, 초안 저장, 승인 요청·승인·반려, 백테스트. 룰은 분석 파이프라인의 탐지에 쓰이지 않는다. */
@Service
public class RuleService {
  public record Input(
      String name,
      String description,
      Integer typeCode,
      Double scoreMin,
      Integer minTransactions,
      Integer windowHours) {}

  public record Review(String status, String reason) {}

  public record Backtest(
      Input rule, LocalDate start, LocalDate end, Integer offset, Integer limit) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;

  public RuleService(JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
  }

  private static Input valid(Input in) {
    if (in == null
        || in.name() == null
        || in.name().isBlank()
        || in.name().strip().length() > 80
        || in.description() == null
        || in.description().isBlank()
        || in.description().length() > 1000
        || (in.typeCode() != null && (in.typeCode() < 0 || in.typeCode() > 8))
        || in.scoreMin() == null
        || !(in.scoreMin() >= 0 && in.scoreMin() <= 1)
        || in.minTransactions() == null
        || in.minTransactions() < 1
        || in.windowHours() == null
        || in.windowHours() < 1
        || in.windowHours() > 720) throw AnalysisService.invalid();
    return in;
  }

  public List<Map<String, Object>> list() {
    var history = new HashMap<Long, List<Map<String, Object>>>();
    for (var row :
        jdbc.queryForList(
            "select h.rule_id,h.at,u.name as actor,h.action,h.reason from review.rule_history h join core.users u on u.user_id=h.actor_id order by h.history_id")) {
      var entry = new LinkedHashMap<String, Object>();
      entry.put("at", ((Timestamp) row.get("at")).toInstant().toString());
      entry.put("actor", row.get("actor"));
      entry.put("action", row.get("action"));
      entry.put("reason", row.get("reason"));
      history
          .computeIfAbsent(((Number) row.get("rule_id")).longValue(), key -> new ArrayList<>())
          .add(entry);
    }
    var out = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            "select r.*,u.name as author from review.rules r join core.users u on u.user_id=r.author_id order by r.rule_id")) {
      long id = ((Number) row.get("rule_id")).longValue();
      var rule = new LinkedHashMap<String, Object>();
      rule.put("id", String.format("RULE-%03d", id));
      rule.put("name", row.get("name"));
      rule.put("description", row.get("description"));
      rule.put("typeCode", row.get("type_code"));
      rule.put("scoreMin", row.get("score_min"));
      rule.put("minTransactions", row.get("min_transactions"));
      rule.put("windowHours", row.get("window_hours"));
      rule.put("status", row.get("status"));
      rule.put("version", row.get("version"));
      rule.put("author", row.get("author"));
      rule.put("updatedAt", ((Timestamp) row.get("updated_at")).toInstant().toString());
      rule.put("history", history.getOrDefault(id, List.of()));
      out.add(rule);
    }
    return out;
  }

  private Map<String, Object> one(long id) {
    return list().stream()
        .filter(rule -> rule.get("id").equals(String.format("RULE-%03d", id)))
        .findFirst()
        .orElseThrow();
  }

  private void history(long id, long user, String action, String reason, Timestamp at) {
    jdbc.update(
        "insert into review.rule_history(rule_id,actor_id,action,reason,at) values(?,?,?,?,?)",
        id,
        user,
        action,
        reason,
        at);
  }

  /** 초안 저장. id가 없으면 새 룰, 있으면 초안·반려·중지 상태의 룰을 고쳐 다시 초안으로 둔다. */
  public Map<String, Object> save(Long id, long user, Input input) {
    var in = valid(input);
    return tx.execute(
        s -> {
          Timestamp at = Timestamp.from(time.now());
          long rule;
          if (id == null)
            rule =
                jdbc.queryForObject(
                    "insert into review.rules(name,description,type_code,score_min,min_transactions,window_hours,status,author_id,updated_at) values(?,?,?,?,?,?,'DRAFT',?,?) returning rule_id",
                    Long.class,
                    in.name().strip(),
                    in.description(),
                    in.typeCode(),
                    in.scoreMin(),
                    in.minTransactions(),
                    in.windowHours(),
                    user,
                    at);
          else {
            var found =
                jdbc.queryForList(
                    "select status from review.rules where rule_id=? for update", String.class, id);
            if (found.isEmpty()) throw ApiException.notFound("룰이 없습니다.");
            if (!Set.of("DRAFT", "REJECTED", "STOPPED").contains(found.getFirst()))
              throw ApiException.invalidTransition("현재 상태의 룰은 수정할 수 없습니다.");
            jdbc.update(
                "update review.rules set name=?,description=?,type_code=?,score_min=?,min_transactions=?,window_hours=?,status='DRAFT',version=version+1,author_id=?,updated_at=? where rule_id=?",
                in.name().strip(),
                in.description(),
                in.typeCode(),
                in.scoreMin(),
                in.minTransactions(),
                in.windowHours(),
                user,
                at,
                id);
            rule = id;
          }
          history(rule, user, id == null ? "초안 생성" : "초안 수정", in.description().strip(), at);
          return one(rule);
        });
  }

  /** 승인 요청(초안), 승인·반려(승인 대기, 관리자만). */
  public Map<String, Object> review(long id, long user, boolean admin, Review in) {
    if (in == null
        || in.reason() == null
        || in.reason().isBlank()
        || in.reason().length() > 1000
        || !Set.of("PENDING_APPROVAL", "TESTING", "REJECTED")
            .contains(Objects.toString(in.status(), ""))) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          var found =
              jdbc.queryForList(
                  "select status from review.rules where rule_id=? for update", String.class, id);
          if (found.isEmpty()) throw ApiException.notFound("룰이 없습니다.");
          boolean request = "PENDING_APPROVAL".equals(in.status());
          if (!request && !admin)
            throw new ApiException(
                HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "관리자만 승인하거나 반려할 수 있습니다.");
          if (!(request ? "DRAFT" : "PENDING_APPROVAL").equals(found.getFirst()))
            throw ApiException.invalidTransition("룰 상태와 처리 권한을 확인해 주세요.");
          Timestamp at = Timestamp.from(time.now());
          jdbc.update(
              "update review.rules set status=?,version=version+1,updated_at=? where rule_id=?",
              in.status(),
              at,
              id);
          history(
              id,
              user,
              request ? "승인 요청" : "TESTING".equals(in.status()) ? "승인" : "반려",
              in.reason().strip(),
              at);
          return one(id);
        });
  }

  private static final String MATCHED =
      """
      with candidates as (
        select t.tx_id,t.occurred_at,t.from_account_id,t.amount_usd,coalesce(s.p_laundering,0) as score
        %s
          and t.business_date between ? and ?
          and (?::int is null or coalesce(w.type_class,0)=?::int)
          and coalesce(s.p_laundering,0)>=?
      ), starts as (
        select c.*,lead(c.occurred_at,?) over account_time-c.occurred_at<=make_interval(hours=>?) as opens
        from candidates c window account_time as (partition by c.from_account_id order by c.occurred_at,c.tx_id)
      ), matched as (
        select * from (
          select s.*,max(case when s.opens then s.occurred_at+make_interval(hours=>?) end)
            over (partition by s.from_account_id order by s.occurred_at,s.tx_id) as covered_until
          from starts s) m where m.covered_until>=m.occurred_at
      )
      """
          .formatted(DashboardProjection.SCORE_BASE);

  /** 조회 기간의 원장 전체에 룰 조건을 적용한다. 같은 송금 계좌에서 시간 창 안에 조건 거래가 최소 건수 이상 모인 거래만 남긴다. */
  public Map<String, Object> backtest(Backtest in) {
    if (in == null
        || in.start() == null
        || in.end() == null
        || in.start().isAfter(in.end())
        || in.start().plusYears(2).isBefore(in.end())) throw AnalysisService.invalid();
    var rule = valid(in.rule());
    int limit = in.limit() == null || in.limit() < 1 ? 25 : Math.min(100, in.limit());
    int offset = in.offset() == null || in.offset() < 0 ? 0 : in.offset();
    Object[] scope = {
      java.sql.Date.valueOf(in.start()),
      java.sql.Date.valueOf(in.end()),
      rule.typeCode(),
      rule.typeCode(),
      rule.scoreMin(),
      rule.minTransactions() - 1,
      rule.windowHours(),
      rule.windowHours()
    };
    return tx.execute(
        s -> {
          jdbc.execute("set local statement_timeout='90s'");
          var out = new LinkedHashMap<String, Object>();
          out.putAll(
              jdbc.queryForMap(
                  MATCHED
                      + "select count(*) as \"matchedCount\",count(distinct from_account_id) as \"accountCount\",coalesce(sum(amount_usd),0) as \"amountUsd\",coalesce(array_agg(distinct a.service_account_id::text),'{}') as accounts from matched m left join core.accounts a on a.account_id=m.from_account_id",
                  scope));
          try {
            out.put(
                "matchedAccountIds",
                List.of((String[]) ((java.sql.Array) out.remove("accounts")).getArray()));
          } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
          }
          out.put(
              "scannedCount",
              jdbc.queryForObject(
                  "select count(*) from ledger.transactions where integration_status='ACTIVE' and business_date between ? and ?",
                  Long.class,
                  scope[0],
                  scope[1]));
          var page = new ArrayList<Object>(Arrays.asList(scope));
          page.add(limit);
          page.add(offset);
          var rows =
              jdbc.queryForList(
                  MATCHED
                      + """
                      select m.tx_id as "txId",m.occurred_at as "occurredAt",t.business_date::text as date,
                        f.service_account_id::text as "fromAccountId",r.service_account_id::text as "toAccountId",
                        fo.display_name as "fromOwnerName",ro.display_name as "toOwnerName",
                        t.amount_paid as "amountPaid",t.payment_currency as "paymentCurrency",
                        t.payment_format as "paymentFormat",m.amount_usd as "amountUsd",m.score
                      from matched m join ledger.transactions t using(tx_id)
                      join core.accounts f on f.account_id=t.from_account_id
                      join core.accounts r on r.account_id=t.to_account_id
                      join core.owners fo on fo.owner_id=f.owner_id join core.owners ro on ro.owner_id=r.owner_id
                      order by m.occurred_at,m.tx_id limit ? offset ?
                      """,
                  page.toArray());
          for (var row : rows)
            row.put("occurredAt", ((Timestamp) row.get("occurredAt")).toInstant().toString());
          out.put("transactions", rows);
          return out;
        });
  }
}
