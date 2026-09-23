package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class LedgerQueryService {
  private final JdbcTemplate jdbc;

  public LedgerQueryService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public static final String BASE =
      """
    from transactions t
    join private.accounts f on f.account_id=t.from_account_id
    join private.accounts r on r.account_id=t.to_account_id
    join private.entities fe on fe.entity_id=f.entity_id
    join private.entities re on re.entity_id=r.entity_id
    left join lateral (
      select i.*,j.threshold_value,j.business_at as detected_at
      from inference_results i join batch_jobs j on j.job_id=i.job_id
      where i.tx_id=t.tx_id and j.status='COMPLETED' and j.job_type='ANALYSIS'
      and ((j.current_run_id is null and i.run_id is null) or
       (i.run_id=j.current_run_id and exists(select 1 from analysis_runs ar where ar.run_id=i.run_id and ar.status='COMPLETED')))
      order by j.job_id desc limit 1
    ) s on true
    left join lateral (select ordinal-1 as type_class from unnest(array[s.p_0,s.p_1,s.p_2,s.p_3,s.p_4,s.p_5,s.p_6,s.p_7,s.p_8]) with ordinality p(prob,ordinal)
     where s.job_id is not null order by prob desc,ordinal limit 1) w on true
    where t.integration_status='ACTIVE'
    """;

  public record Filter(
      LocalDate from,
      LocalDate to,
      UUID owner,
      UUID account,
      List<String> judgement,
      List<String> payments,
      int page,
      int size) {}

  public Map<String, Object> query(String kind, Filter filter) {
    AnalysisService.validatePage(filter.page(), filter.size());
    if (filter.from() != null && filter.to() != null && filter.from().isAfter(filter.to()))
      throw AnalysisService.invalid();
    var args = new ArrayList<Object>();
    var sql = new StringBuilder(BASE);
    if (filter.from() != null) {
      sql.append(" and t.occurred_at>=?");
      args.add(Timestamp.from(filter.from().atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (filter.to() != null) {
      sql.append(" and t.occurred_at<?");
      args.add(Timestamp.from(filter.to().plusDays(1).atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (filter.owner() != null) {
      sql.append(" and (fe.service_entity_id=? or re.service_entity_id=?)");
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
    String select =
        """
      select t.tx_id as "txId",t.occurred_at as "occurredAt",
      f.service_account_id as "fromAccountId",r.service_account_id as "toAccountId",
      fe.service_entity_id as "fromOwnerId",re.service_entity_id as "toOwnerId",
      f.bank_id as "fromBankId",r.bank_id as "toBankId",
      t.amount_paid as "amountPaid",t.payment_currency as "paymentCurrency",
      t.amount_received as "amountReceived",t.receiving_currency as "receivingCurrency",t.payment_format as "paymentFormat",
      s.p_laundering as "launderingScore",s.threshold_value as threshold,
      s.p_laundering>=s.threshold_value as "isSuspicious", w.type_class as "typeClass",
      array[s.p_0,s.p_1,s.p_2,s.p_3,s.p_4,s.p_5,s.p_6,s.p_7,s.p_8] as probabilities,
      case when s.job_id is null then 'UNANALYZED' when s.p_laundering>=s.threshold_value then 'SUSPICIOUS' else 'NORMAL' end as judgement
      """;
    String dataset = select + sql;
    if ("owners".equals(kind))
      dataset =
          "with matches as ("
              + dataset
              + ") select distinct id from (select \"fromOwnerId\" as id from matches union select \"toOwnerId\" from matches) o";
    else if ("accounts".equals(kind)) {
      dataset =
          "with matches as ("
              + dataset
              + ") select distinct id,\"ownerId\",\"bankId\" from (select \"fromAccountId\" as id,\"fromOwnerId\" as \"ownerId\",\"fromBankId\" as \"bankId\" from matches union select \"toAccountId\",\"toOwnerId\",\"toBankId\" from matches) a";
      if (filter.owner() != null) {
        dataset += " where \"ownerId\"=?";
        args.add(filter.owner());
      }
    } else if (!"transactions".equals(kind)) throw AnalysisService.invalid();
    long count =
        jdbc.queryForObject("select count(*) from (" + dataset + ") q", Long.class, args.toArray());
    args.add(filter.size());
    args.add((long) filter.page() * filter.size());
    var rows =
        jdbc.queryForList(
            dataset
                + ("transactions".equals(kind)
                    ? " order by \"occurredAt\" desc,\"txId\""
                    : " order by id")
                + " limit ? offset ?",
            args.toArray());
    for (var row : rows) {
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
        "select a.service_account_id as id,e.service_entity_id as \"ownerId\",a.bank_id as \"bankId\" from private.accounts a join private.entities e using(entity_id) where a.service_account_id::text in ("
            + String.join(",", Collections.nCopies(ids.size(), "?"))
            + ")",
        ids.toArray());
  }

  public List<String> payments() {
    return jdbc.queryForList(
        "select distinct payment_format from transactions order by payment_format", String.class);
  }
}
