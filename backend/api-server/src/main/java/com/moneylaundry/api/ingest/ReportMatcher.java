package com.moneylaundry.api.ingest;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/** Exact values, not hash equality, decide matches. Repeated reports are a multiset. */
public final class ReportMatcher {
  public record Report(long id, long version, int bank, TransactionRow row) {}

  public record Key(
      Instant at,
      int fromBank,
      String fromAccount,
      int toBank,
      String toAccount,
      BigDecimal received,
      String receivingCurrency,
      BigDecimal paid,
      String paymentCurrency) {}

  public record Match(Report first, Report second) {}

  public record Result(
      List<Match> matches,
      Set<Long> heldVersions,
      Set<Long> dependencyReports,
      Map<Long, String> reasons) {}

  public static Key key(TransactionRow r) {
    return new Key(
        r.occurredAt(),
        r.fromBank(),
        r.fromAccount(),
        r.toBank(),
        r.toAccount(),
        r.amountReceived().stripTrailingZeros(),
        r.receivingCurrency(),
        r.amountPaid().stripTrailingZeros(),
        r.paymentCurrency());
  }

  public static Set<Long> identityConflicts(List<Report> reports) {
    Map<String, Map<String, Set<Long>>> claims = new HashMap<>();
    for (Report report : reports) {
      TransactionRow r = report.row();
      claim(claims, "bank:" + r.fromBank(), r.fromBankName(), report.version());
      claim(claims, "bank:" + r.toBank(), r.toBankName(), report.version());
      claim(claims, "entity:" + r.fromEntityId(), r.fromEntityName(), report.version());
      claim(claims, "entity:" + r.toEntityId(), r.toEntityName(), report.version());
      claim(
          claims,
          "account:" + r.fromBank() + ":" + r.fromAccount(),
          r.fromEntityId(),
          report.version());
      claim(
          claims, "account:" + r.toBank() + ":" + r.toAccount(), r.toEntityId(), report.version());
    }
    Set<Long> held = new HashSet<>();
    claims.values().stream()
        .filter(v -> v.size() > 1)
        .forEach(v -> v.values().forEach(held::addAll));
    return held;
  }

  private static void claim(
      Map<String, Map<String, Set<Long>>> claims, String id, String value, long version) {
    claims
        .computeIfAbsent(id, k -> new HashMap<>())
        .computeIfAbsent(value, k -> new HashSet<>())
        .add(version);
  }

  public static Result match(
      List<Report> reports, Set<Integer> scope, Set<Long> initialHeld, Set<Integer> invalidBanks) {
    Set<Long> held = new HashSet<>(initialHeld);
    Map<Long, String> reasons = new HashMap<>();
    initialHeld.forEach(v -> reasons.put(v, "INVALID_SELF_OR_CONFIRMED_IDENTITY"));
    Set<Long> conflicts =
        identityConflicts(
            reports.stream().filter(r -> !initialHeld.contains(r.version())).toList());
    held.addAll(conflicts);
    conflicts.forEach(v -> reasons.put(v, "IDENTITY_CONFLICT"));
    Set<Integer> blockedBanks = new HashSet<>(invalidBanks);
    reports.stream()
        .filter(r -> held.contains(r.version()))
        .forEach(r -> blockedBanks.add(r.bank()));
    Map<Key, List<Report>> groups = new LinkedHashMap<>();
    reports.stream()
        .filter(r -> !held.contains(r.version()))
        .sorted(Comparator.comparingLong(Report::id))
        .forEach(r -> groups.computeIfAbsent(key(r.row()), k -> new ArrayList<>()).add(r));
    List<Match> candidates = new ArrayList<>();
    Set<Long> dependencies = new HashSet<>();
    List<Report> unmatched = new ArrayList<>();
    for (var group : groups.values()) {
      TransactionRow row = group.getFirst().row();
      if (row.fromBank() == row.toBank()
          || !scope.contains(row.fromBank())
          || !scope.contains(row.toBank())) {
        for (Report r : group) candidates.add(new Match(r, null));
        continue;
      }
      Map<String, Deque<Report>> receivers = new LinkedHashMap<>();
      group.stream()
          .filter(r -> r.bank() == row.toBank())
          .forEach(
              r ->
                  receivers
                      .computeIfAbsent(r.row().paymentFormat(), k -> new ArrayDeque<>())
                      .add(r));
      List<Report> send = new ArrayList<>();
      for (Report first : group)
        if (first.bank() == row.fromBank()) {
          Deque<Report> queue = receivers.get(first.row().paymentFormat());
          if (queue != null && !queue.isEmpty())
            candidates.add(new Match(first, queue.removeFirst()));
          else send.add(first);
        }
      List<Report> receive = receivers.values().stream().flatMap(Collection::stream).toList();
      if (!send.isEmpty() && !receive.isEmpty()) {
        send.forEach(
            r -> {
              held.add(r.version());
              reasons.put(r.version(), "PAYMENT_FORMAT_CONFLICT");
            });
        receive.forEach(
            r -> {
              held.add(r.version());
              reasons.put(r.version(), "PAYMENT_FORMAT_CONFLICT");
            });
      } else unmatched.addAll(send.isEmpty() ? receive : send);
    }
    reports.stream()
        .filter(r -> held.contains(r.version()))
        .forEach(r -> blockedBanks.add(r.bank()));
    for (Report r : unmatched) {
      int other = r.bank() == r.row().fromBank() ? r.row().toBank() : r.row().fromBank();
      if (blockedBanks.contains(other)) dependencies.add(r.id());
      else {
        held.add(r.version());
        reasons.put(r.version(), "COUNTERPART_MISSING");
      }
    }
    List<Match> accepted = new ArrayList<>();
    for (Match match : candidates) {
      boolean blocked =
          held.contains(match.first().version())
              || (match.second() != null && held.contains(match.second().version()));
      if (blocked) {
        if (!held.contains(match.first().version())) dependencies.add(match.first().id());
        if (match.second() != null && !held.contains(match.second().version()))
          dependencies.add(match.second().id());
      } else accepted.add(match);
    }
    reports.stream()
        .filter(r -> held.contains(r.version()))
        .forEach(r -> dependencies.remove(r.id()));
    return new Result(accepted, held, dependencies, reasons);
  }

  private ReportMatcher() {}
}
