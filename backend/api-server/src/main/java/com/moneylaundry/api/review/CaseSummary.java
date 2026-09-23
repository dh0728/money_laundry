package com.moneylaundry.api.review;

import java.math.BigDecimal;
import java.util.*;

/** Summaries of observed evidence, never probabilities of an entire case. */
public final class CaseSummary {
  private CaseSummary() {}

  public static final String[] TYPES = {
    "패턴아님",
    "Fan-out",
    "Fan-in",
    "Gather-scatter",
    "Scatter-gather",
    "Cycle",
    "Random",
    "Bipartite",
    "Stack"
  };

  public static int type(Map<String, Object> scores) {
    int best = 0;
    for (int i = 1; i < 9; i++) if (score(scores, "p_" + i) > score(scores, "p_" + best)) best = i;
    return best;
  }

  static double score(Map<String, Object> s, String name) {
    return s.get(name) instanceof Number n ? n.doubleValue() : 0;
  }

  static BigDecimal amount(Object n) {
    return n == null ? BigDecimal.ZERO : new BigDecimal(n.toString());
  }

  public static Map<String, Object> summarize(List<Map<String, Object>> members) {
    Map<Long, Map<String, Object>> unique = new LinkedHashMap<>();
    for (var m : members)
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(m.getOrDefault("state", "PENDING")))
        unique.merge(
            ReviewJson.number(m.get("txId")),
            m,
            (a, b) -> "SUBJECT".equals(b.get("reviewRole")) ? b : a);
    Map<String, BigDecimal> totals = new TreeMap<>();
    Map<String, BigDecimal> received = new HashMap<>(), paid = new HashMap<>();
    Map<String, Integer> formats = new TreeMap<>(), types = new TreeMap<>(), days = new TreeMap<>();
    Map<String, BigDecimal> dayAmounts = new TreeMap<>();
    int seeds = 0;
    double risk = 0;
    int[] votes = new int[9];
    String first = null, last = null;
    for (var m : unique.values()) {
      var t = ReviewJson.object(m.get("transaction"));
      var scores = t.get("scores") == null ? null : ReviewJson.object(t.get("scores"));
      if ("SEED".equals(t.get("role"))) {
        seeds++;
        if (scores != null) {
          risk = Math.max(risk, score(scores, "p_laundering"));
          votes[type(scores)]++;
        }
      }
      if (!"SUBJECT".equals(m.get("reviewRole"))) continue;
      String at = t.get("occurredAt").toString();
      if (first == null || at.compareTo(first) < 0) first = at;
      if (last == null || at.compareTo(last) > 0) last = at;
      String pc = t.get("paymentCurrency").toString().trim(),
          rc = t.get("receivingCurrency").toString().trim();
      BigDecimal p = amount(t.get("amountPaid")), r = amount(t.get("amountReceived"));
      totals.merge(pc, p, BigDecimal::add);
      paid.merge(t.get("fromAccountId") + "|" + pc, p, BigDecimal::add);
      received.merge(t.get("toAccountId") + "|" + rc, r, BigDecimal::add);
      formats.merge(t.get("paymentFormat").toString(), 1, Integer::sum);
      if (Boolean.TRUE.equals(t.get("isSuspicious"))) {
        String day = java.time.Instant.parse(at).atZone(BusinessTime.KST).toLocalDate().toString();
        days.merge(day, 1, Integer::sum);
        dayAmounts.merge(day + "|" + pc, p, BigDecimal::add);
        if (scores != null) types.merge(TYPES[type(scores)], 1, Integer::sum);
      }
    }
    int top = 0;
    for (int i = 1; i < 9; i++) top = Math.max(top, votes[i]);
    List<String> winners = new ArrayList<>();
    for (int i = 1; i < 9; i++) if (votes[i] > 0 && votes[i] == top) winners.add(TYPES[i]);
    var net = new TreeMap<String, BigDecimal>(received);
    paid.forEach((k, v) -> net.merge(k, v.negate(), BigDecimal::add));
    var concentrations = new TreeMap<String, Double>();
    Set<String> currencies = new TreeSet<>();
    received.keySet().forEach(k -> currencies.add(k.split("\\|")[1]));
    for (String c : currencies) {
      var values =
          received.entrySet().stream()
              .filter(e -> e.getKey().endsWith("|" + c))
              .map(Map.Entry::getValue)
              .sorted(Comparator.reverseOrder())
              .toList();
      double all = values.stream().mapToDouble(BigDecimal::doubleValue).sum();
      if (all > 0)
        concentrations.put(
            c, values.stream().limit(3).mapToDouble(BigDecimal::doubleValue).sum() / all);
    }
    var out = new LinkedHashMap<String, Object>();
    out.put("txCount", unique.size());
    out.put(
        "subjectCount",
        unique.values().stream().filter(m -> "SUBJECT".equals(m.get("reviewRole"))).count());
    out.put("seedCount", seeds);
    out.put("riskScore", risk);
    out.put(
        "primaryType",
        winners.isEmpty() ? "패턴 미특정" : winners.size() > 1 ? "혼합" : winners.getFirst());
    out.put("typeShare", seeds == 0 ? null : (double) top / seeds);
    out.put("amountsByCurrency", totals);
    out.put("firstTxAt", first);
    out.put("lastTxAt", last);
    out.put("netFlows", net);
    out.put("topReceiverShare", concentrations);
    out.put(
        "topSenders",
        paid.entrySet().stream()
            .collect(
                java.util.stream.Collectors.groupingBy(
                    e -> e.getKey().split("\\|")[1],
                    TreeMap::new,
                    java.util.stream.Collectors.toList()))
            .values()
            .stream()
            .flatMap(
                entries ->
                    entries.stream()
                        .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                        .limit(10))
            .map(e -> Map.of("accountCurrency", e.getKey(), "amount", e.getValue()))
            .toList());
    out.put("paymentFormats", formats);
    out.put("dailySuspiciousCount", days);
    out.put("dailySuspiciousAmount", dayAmounts);
    out.put("typeDistribution", types);
    return out;
  }
}
