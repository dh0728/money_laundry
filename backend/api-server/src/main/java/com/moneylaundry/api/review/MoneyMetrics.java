package com.moneylaundry.api.review;

import java.math.*;
import java.time.*;
import java.util.*;

/** Account/currency FIFO estimate, never a claim about the identity of funds. */
public final class MoneyMetrics {
  private MoneyMetrics() {}

  public record Transfer(
      long id,
      Instant at,
      String from,
      String to,
      BigDecimal paid,
      String paymentCurrency,
      BigDecimal received,
      String receivingCurrency) {}

  private record Key(String account, String currency) {}

  private record Event(Instant at, boolean credit, long id, BigDecimal amount, boolean matchable) {}

  private static final class Credit {
    final Instant at;
    BigDecimal remaining;

    Credit(Instant at, BigDecimal amount) {
      this.at = at;
      remaining = amount;
    }
  }

  private static Double ratio(BigDecimal n, BigDecimal d) {
    return d.signum() == 0
        ? null
        : n.divide(d, 12, RoundingMode.HALF_UP).multiply(BigDecimal.valueOf(100)).doubleValue();
  }

  public static Map<String, Object> calculate(
      List<Transfer> transfers, Set<String> accounts, Instant start, Instant end, Duration delay) {
    if (!delay.isPositive() || end.isBefore(start)) throw new IllegalArgumentException();
    Map<String, BigDecimal> externalIn = new TreeMap<>(), externalOut = new TreeMap<>();
    Map<Key, List<Event>> events = new HashMap<>();
    Set<Long> seen = new HashSet<>();
    for (var t : transfers) {
      if (t.at().isBefore(start) || !t.at().isBefore(end) || !seen.add(t.id())) continue;
      boolean f = accounts.contains(t.from()), r = accounts.contains(t.to());
      if (!f && r) externalIn.merge(t.receivingCurrency(), t.received(), BigDecimal::add);
      if (f && !r) externalOut.merge(t.paymentCurrency(), t.paid(), BigDecimal::add);
      if (f)
        events
            .computeIfAbsent(new Key(t.from(), t.paymentCurrency()), k -> new ArrayList<>())
            .add(new Event(t.at(), false, t.id(), t.paid(), !t.from().equals(t.to())));
      if (r)
        events
            .computeIfAbsent(new Key(t.to(), t.receivingCurrency()), k -> new ArrayList<>())
            .add(new Event(t.at(), true, t.id(), t.received(), !t.from().equals(t.to())));
    }
    List<Map<String, Object>> rows = new ArrayList<>();
    Map<String, BigDecimal> positives = new HashMap<>();
    for (var entry : events.entrySet()) {
      var items = entry.getValue();
      // With minute-resolution input there is no evidence of within-minute order.
      items.sort(
          Comparator.comparing(Event::at)
              .thenComparing(Event::credit)
              .thenComparingLong(Event::id));
      BigDecimal in = BigDecimal.ZERO,
          out = BigDecimal.ZERO,
          eligible = BigDecimal.ZERO,
          matched = BigDecimal.ZERO,
          rapidIn = BigDecimal.ZERO;
      ArrayDeque<Credit> fifo = new ArrayDeque<>();
      for (var e : items) {
        if (e.credit()) {
          in = in.add(e.amount());
          if (!e.matchable()) continue;
          rapidIn = rapidIn.add(e.amount());
          if (!e.at().plus(delay).isAfter(end)) eligible = eligible.add(e.amount());
          fifo.add(new Credit(e.at(), e.amount()));
        } else {
          out = out.add(e.amount());
          if (!e.matchable()) continue;
          BigDecimal left = e.amount();
          while (left.signum() > 0 && !fifo.isEmpty()) {
            var c = fifo.peek();
            var portion = left.min(c.remaining);
            // Older credits still consume outgoing funds even after delay expires.
            if (e.at().isAfter(c.at)
                && !e.at().isAfter(c.at.plus(delay))
                && !c.at.plus(delay).isAfter(end)) matched = matched.add(portion);
            c.remaining = c.remaining.subtract(portion);
            left = left.subtract(portion);
            if (c.remaining.signum() == 0) fifo.remove();
          }
        }
      }
      var net = in.subtract(out);
      var positive = net.max(BigDecimal.ZERO);
      positives.merge(entry.getKey().currency(), positive, BigDecimal::add);
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("accountId", entry.getKey().account());
      row.put("currency", entry.getKey().currency());
      row.put("in", in);
      row.put("out", out);
      row.put("net", net);
      row.put("positiveNet", positive);
      row.put("eligibleIn", eligible);
      row.put("excludedIn", rapidIn.subtract(eligible));
      row.put("matchedIn", matched);
      row.put("rapidOutflowPercent", ratio(matched, eligible));
      rows.add(row);
    }
    for (var row : rows)
      row.put(
          "concentrationPercent",
          ratio((BigDecimal) row.get("positiveNet"), positives.get(row.get("currency"))));
    rows.sort(Comparator.comparing(r -> r.get("accountId").toString() + r.get("currency")));
    Set<String> currencies = new TreeSet<>(positives.keySet());
    currencies.addAll(externalIn.keySet());
    currencies.addAll(externalOut.keySet());
    var external = new ArrayList<Map<String, Object>>();
    for (var c : currencies) {
      var in = externalIn.getOrDefault(c, BigDecimal.ZERO);
      var out = externalOut.getOrDefault(c, BigDecimal.ZERO);
      external.add(Map.of("currency", c, "in", in, "out", out, "net", in.subtract(out)));
    }
    return Map.of(
        "external",
        external,
        "accounts",
        rows,
        "delayMinutes",
        delay.toMinutes(),
        "method",
        "FIFO_ESTIMATE",
        "start",
        start.toString(),
        "endExclusive",
        end.toString());
  }
}
