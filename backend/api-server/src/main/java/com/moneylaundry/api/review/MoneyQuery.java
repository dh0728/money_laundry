package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Reads all received ledger activity, independently of case membership. */
final class MoneyQuery {
  private final JdbcTemplate jdbc;
  private final BusinessTime time;

  MoneyQuery(JdbcTemplate jdbc, BusinessTime time) {
    this.jdbc = jdbc;
    this.time = time;
  }

  Map<String, Object> read(Map<String, Object> detail, Map<String, Object> scope, int minutes) {
    Set<String> candidates = new TreeSet<>(), seeds = new TreeSet<>();
    LocalDate first = null, last = null;
    for (var g : rows(detail.get("groups")))
      for (var m : rows(g.get("members"))) {
        if (Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state"))) continue;
        var t = object(m.get("transaction"));
        candidates.add(t.get("fromAccountId").toString());
        candidates.add(t.get("toAccountId").toString());
        if ("SEED".equals(t.get("role"))) {
          seeds.add(t.get("fromAccountId").toString());
          seeds.add(t.get("toAccountId").toString());
        }
        if (!"SUBJECT".equals(m.get("reviewRole"))) continue;
        var d =
            Instant.parse(t.get("occurredAt").toString()).atZone(BusinessTime.KST).toLocalDate();
        if (first == null || d.isBefore(first)) first = d;
        if (last == null || d.isAfter(last)) last = d;
      }
    Set<String> accounts = new TreeSet<>(seeds);
    if (scope != null) {
      accounts.clear();
      for (var a : (List<?>) scope.get("accounts")) accounts.add(a.toString());
    }
    candidates.addAll(accounts);
    var out = new LinkedHashMap<String, Object>();
    out.put("selectedAccounts", accounts);
    out.put("candidateAccounts", candidates);
    out.put("customScope", scope != null);
    out.put("revision", detail.get("revision"));
    out.put("delayMinutes", minutes);
    out.put("observedAt", Instant.now().toString());
    out.put("requestedFrom", first == null ? null : first.toString());
    out.put("requestedTo", last == null ? null : last.toString());
    if (first == null) {
      out.put("available", false);
      out.put("reason", "EMPTY_SUBJECT_SCOPE");
      return out;
    }
    // Stop at the first unreceived/incomplete day; never infer observation from max(tx time).
    LocalDate stop = first;
    while (!stop.isAfter(last)
        && stop.isBefore(time.now().atZone(BusinessTime.KST).toLocalDate())) {
      boolean complete =
          jdbc.queryForObject(
              "select exists(select 1 from bank_reporting_periods where effective_from_date<=? and (effective_to_date is null or effective_to_date>=?)) and not exists(select 1 from bank_reporting_periods p left join report_sets s on s.bank_id=p.bank_id and s.business_date=? left join report_versions v on v.version_id=s.current_version_id where p.effective_from_date<=? and (p.effective_to_date is null or p.effective_to_date>=?) and v.stage_status is distinct from 'ACTIVE')",
              Boolean.class,
              stop,
              stop,
              stop,
              stop,
              stop);
      if (!complete) break;
      stop = stop.plusDays(1);
    }
    out.put("complete", stop.isAfter(last));
    if (stop.equals(first)) {
      out.put("available", false);
      out.put("reason", "WAITING_RECEIPTS");
      return out;
    }
    if (accounts.isEmpty()) {
      out.put("available", false);
      out.put("reason", "EMPTY_ACCOUNT_SCOPE");
      return out;
    }
    Instant start = first.atStartOfDay(BusinessTime.KST).toInstant(),
        end = stop.atStartOfDay(BusinessTime.KST).toInstant();
    // Scope IDs originate in real evidence or are validated by scope updates.
    List<UUID> ids = new ArrayList<>();
    for (var a : accounts) ids.add(UUID.fromString(a));
    var args = new ArrayList<Object>(List.of(Timestamp.from(start), Timestamp.from(end)));
    args.addAll(ids);
    args.addAll(ids);
    String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
    var transfers =
        jdbc.query(
            "select t.tx_id,t.occurred_at,f.service_account_id as f,r.service_account_id as r,t.amount_paid,t.payment_currency,t.amount_received,t.receiving_currency from transactions t join private.accounts f on f.account_id=t.from_account_id join private.accounts r on r.account_id=t.to_account_id where t.integration_status='ACTIVE' and t.occurred_at>=? and t.occurred_at<? and (f.service_account_id in ("
                + marks
                + ") or r.service_account_id in ("
                + marks
                + ")) order by t.occurred_at,t.tx_id",
            (rs, n) ->
                new MoneyMetrics.Transfer(
                    rs.getLong("tx_id"),
                    rs.getTimestamp("occurred_at").toInstant(),
                    rs.getString("f"),
                    rs.getString("r"),
                    rs.getBigDecimal("amount_paid"),
                    rs.getString("payment_currency").trim(),
                    rs.getBigDecimal("amount_received"),
                    rs.getString("receiving_currency").trim()),
            args.toArray());
    out.putAll(
        MoneyMetrics.calculate(transfers, accounts, start, end, Duration.ofMinutes(minutes)));
    out.put("available", true);
    out.put("ledgerCount", transfers.size());
    return out;
  }
}
