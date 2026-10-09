package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Transactions 화면의 소유주·계좌·거래 조회와 필터·페이지 처리. */
@Service
public class LedgerQueryService {
  private final JdbcTemplate jdbc;

  public LedgerQueryService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static final String ACCOUNTS =
      """
    from ledger.transactions t
    join core.accounts f on f.account_id=t.from_account_id
    join core.accounts r on r.account_id=t.to_account_id
    join core.owners fe on fe.owner_id=f.owner_id
    join core.owners re on re.owner_id=r.owner_id
    """;

  private static final String SCORE =
      """
    left join (
      select i.*,j.job_id,j.threshold_value,j.business_at as detected_at
      from analysis.current_scores c join analysis.scores i using(run_id,tx_id)
      join analysis.runs ar on ar.run_id=i.run_id
      join analysis.jobs j on j.job_id=ar.job_id and j.current_run_id=ar.run_id
      where ar.status='COMPLETED' and j.status='COMPLETED'
    ) s on s.tx_id=t.tx_id
    """;

  private static final String TYPE =
      """
    left join lateral (select s.type_class::bigint as type_class) w on true
    """;

  private static final String PAGE_SCORE =
      """
      left join lateral (
        select i.*,j.job_id,j.threshold_value,j.business_at as detected_at
        from analysis.current_scores c join analysis.scores i using(run_id,tx_id)
        join analysis.runs ar on ar.run_id=i.run_id
        join analysis.jobs j on j.job_id=ar.job_id and j.current_run_id=ar.run_id
        where c.tx_id=t.tx_id and ar.status='COMPLETED' and j.status='COMPLETED'
        limit 1
      ) s on true
      """;

  public static final String BASE =
      ACCOUNTS + SCORE + TYPE + " where t.integration_status='ACTIVE'";

  public record Filter(
      LocalDate from,
      LocalDate to,
      UUID owner,
      UUID account,
      List<String> judgement,
      List<String> payments,
      int page,
      int size,
      String query,
      List<String> directions) {
    public Filter(
        LocalDate from,
        LocalDate to,
        UUID owner,
        UUID account,
        List<String> judgement,
        List<String> payments,
        int page,
        int size) {
      this(from, to, owner, account, judgement, payments, page, size, null, null);
    }
  }

  public Map<String, Object> query(String kind, Filter filter) {
    AnalysisService.validatePage(filter.page(), filter.size());
    if (filter.from() != null && filter.to() != null && filter.from().isAfter(filter.to()))
      throw AnalysisService.invalid();
    var args = new ArrayList<Object>();
    // Candidate selection needs scores only when judgement is actually filtered.
    // Type probabilities and presentation names belong to the returned page.
    boolean needsScores = filter.judgement() != null && !filter.judgement().isEmpty();
    boolean needsIdentity =
        filter.owner() != null
            || filter.account() != null
            || (filter.query() != null && !filter.query().isBlank());
    var sql =
        new StringBuilder(
            (needsIdentity ? ACCOUNTS : " from ledger.transactions t ")
                + (needsScores ? SCORE : "")
                + " where t.integration_status='ACTIVE'");
    if (filter.from() != null) {
      sql.append(" and t.occurred_at>=?");
      args.add(Timestamp.from(filter.from().atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (filter.to() != null) {
      sql.append(" and t.occurred_at<?");
      args.add(Timestamp.from(filter.to().plusDays(1).atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (filter.owner() != null) {
      sql.append(" and (fe.service_owner_id=? or re.service_owner_id=?)");
      args.add(filter.owner());
      args.add(filter.owner());
    }
    if (filter.account() != null) {
      sql.append(" and (f.service_account_id=? or r.service_account_id=?)");
      args.add(filter.account());
      args.add(filter.account());
    }
    if (filter.judgement() != null && !filter.judgement().isEmpty()) {
      if (!Set.of("SUSPICIOUS", "NORMAL", "UNANALYZED").containsAll(filter.judgement()))
        throw AnalysisService.invalid();
      sql.append(" and (");
      var clauses = new ArrayList<String>();
      for (String v : filter.judgement())
        clauses.add(
            switch (v) {
              case "SUSPICIOUS" -> "s.p_laundering>=s.threshold_value";
              case "NORMAL" -> "s.p_laundering<s.threshold_value";
              default -> "s.job_id is null";
            });
      sql.append(String.join(" or ", clauses)).append(")");
    }
    if (filter.payments() != null && !filter.payments().isEmpty()) {
      if (filter.payments().size() > 30) throw AnalysisService.invalid();
      sql.append(" and t.payment_format in (")
          .append(String.join(",", Collections.nCopies(filter.payments().size(), "?")))
          .append(")");
      args.addAll(filter.payments());
    }
    if (filter.query() != null && !filter.query().isBlank()) {
      if (filter.query().length() > 200) throw AnalysisService.invalid();
      String q =
          "%"
              + filter.query().strip().replace("!", "!!").replace("%", "!%").replace("_", "!_")
              + "%";
      sql.append(
          " and (t.tx_id::text ilike ? escape '!' or f.service_account_id::text ilike ? escape '!' or r.service_account_id::text ilike ? escape '!' or fe.service_owner_id::text ilike ? escape '!' or re.service_owner_id::text ilike ? escape '!')");
      sql.setLength(sql.length() - 1);
      sql.append(" or ")
          .append("fe.display_name")
          .append(" ilike ? escape '!' or ")
          .append("re.display_name")
          .append(" ilike ? escape '!')");
      args.addAll(List.of(q, q, q, q, q, q, q));
    }
    if (filter.directions() != null && !filter.directions().isEmpty()) {
      if (!Set.of("IN", "OUT").containsAll(filter.directions()) || filter.account() == null)
        throw AnalysisService.invalid();
      var directionClauses = new ArrayList<String>();
      for (String direction : filter.directions()) {
        directionClauses.add(
            direction.equals("IN") ? "r.service_account_id=?" : "f.service_account_id=?");
        args.add(filter.account());
      }
      sql.append(" and (").append(String.join(" or ", directionClauses)).append(")");
    }
    String select =
        """
      select t.tx_id as "txId",t.occurred_at as "occurredAt",
      f.service_account_id as "fromAccountId",r.service_account_id as "toAccountId",
      fe.service_owner_id as "fromOwnerId",re.service_owner_id as "toOwnerId",
      f.bank_id as "fromBankId",r.bank_id as "toBankId",
      t.amount_paid as "amountPaid",t.payment_currency as "paymentCurrency",t.amount_usd as "amountUsd",
      t.amount_received as "amountReceived",t.receiving_currency as "receivingCurrency",t.payment_format as "paymentFormat",
      %s as "fromOwnerName",%s as "toOwnerName",
      s.p_laundering as "launderingScore",s.threshold_value as threshold,
      s.p_laundering>=s.threshold_value as "isSuspicious", w.type_class as "typeClass",
      array[s.p_0,s.p_1,s.p_2,s.p_3,s.p_4,s.p_5,s.p_6,s.p_7,s.p_8] as probabilities,
      case when s.job_id is null then 'UNANALYZED' when s.p_laundering>=s.threshold_value then 'SUSPICIOUS' else 'NORMAL' end as judgement
      """
            .formatted("fe.display_name", "re.display_name");
    String dataset;
    String pageSelect;
    if ("owners".equals(kind)) {
      dataset =
          needsIdentity
              ? "with matches as (select fe.owner_id as f,re.owner_id as r "
                  + sql
                  + ") select e.owner_id,e.display_name,e.service_owner_id as id from core.owners e join "
                  + "(select f as owner_id from matches union select r from matches) m using(owner_id)"
              : "with matches as (select t.from_account_id as f,t.to_account_id as r "
                  + sql
                  + "), matched_accounts as (select f as account_id from matches union select r from matches),"
                  + " ids as (select distinct a.owner_id from core.accounts a join matched_accounts m using(account_id))"
                  + " select e.owner_id,e.display_name,e.service_owner_id as id from core.owners e join ids using(owner_id)";
      pageSelect = "select id," + "p.display_name" + " as name from page p order by id";
    } else if ("accounts".equals(kind)) {
      dataset =
          "with matches as (select t.from_account_id as f,t.to_account_id as r "
              + sql
              + ") select a.service_account_id as id,e.owner_id,e.display_name,e.service_owner_id as \"ownerId\",a.bank_id as \"bankId\" "
              + "from core.accounts a join core.owners e using(owner_id) join "
              + "(select f as account_id from matches union select r from matches) m using(account_id)";
      if (filter.owner() != null) {
        dataset += " where e.service_owner_id=?";
        args.add(filter.owner());
      }
      pageSelect =
          "select id,\"ownerId\",\"bankId\","
              + "p.display_name"
              + " as \"ownerName\" from page p order by id";
    } else if ("transactions".equals(kind)) {
      dataset = "select t.tx_id as \"txId\",t.occurred_at as \"occurredAt\" " + sql;
      pageSelect =
          select
              + ACCOUNTS
              + " join page p on p.\"txId\"=t.tx_id "
              + PAGE_SCORE
              + TYPE
              + " order by t.occurred_at desc,t.tx_id";
    } else throw AnalysisService.invalid();
    Object[] countArgs = args.toArray();
    args.add(filter.size());
    args.add((long) filter.page() * filter.size());
    boolean transactions = "transactions".equals(kind);
    // Owner/account candidates require a full distinct projection. Count that
    // projection in the same query instead of constructing it twice per page.
    var rows =
        jdbc.queryForList(
            "with page as materialized ("
                + (transactions
                    ? dataset
                    : "select q.*,count(*) over() as _total from (" + dataset + ") q")
                + (transactions ? " order by \"occurredAt\" desc,\"txId\"" : " order by id")
                + " limit ? offset ?) "
                + (transactions
                    ? pageSelect
                    : pageSelect.replaceFirst("select ", "select p._total,")),
            args.toArray());
    long count =
        transactions || rows.isEmpty()
            ? jdbc.queryForObject("select count(*) from (" + dataset + ") q", Long.class, countArgs)
            : ((Number) rows.getFirst().get("_total")).longValue();
    for (var row : rows) {
      row.remove("_total");
      Object probs = row.remove("probabilities");
      if (probs instanceof java.sql.Array arr)
        try {
          row.put("probabilities", arr.getArray());
        } catch (java.sql.SQLException e) {
          throw new IllegalStateException(e);
        }
      if (row.get("typeClass") != null)
        row.put("typeName", CaseSummary.TYPES[((Number) row.get("typeClass")).intValue()]);
    }
    if ("transactions".equals(kind)) new CurrentCaseMembership(jdbc).attach(rows);
    return Map.of(
        "content",
        rows,
        "page",
        filter.page(),
        "size",
        filter.size(),
        "totalElements",
        count,
        "totalPages",
        (count + filter.size() - 1) / filter.size());
  }

  public List<Map<String, Object>> accounts(Collection<String> ids) {
    if (ids.isEmpty()) return List.of();
    return jdbc.queryForList(
        "select "
            + "e.display_name"
            + " as \"ownerName\",a.service_account_id as id,e.service_owner_id as \"ownerId\",a.bank_id as \"bankId\" from core.accounts a join core.owners e using(owner_id) where a.service_account_id::text in ("
            + String.join(",", Collections.nCopies(ids.size(), "?"))
            + ")",
        ids.toArray());
  }

  public List<String> payments() {
    return jdbc.queryForList(
        "select distinct payment_format from ledger.transactions order by payment_format",
        String.class);
  }
}
