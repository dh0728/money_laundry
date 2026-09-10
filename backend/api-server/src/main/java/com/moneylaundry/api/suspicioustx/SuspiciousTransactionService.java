package com.moneylaundry.api.suspicioustx;

import com.moneylaundry.api.analysis.AnalysisService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SuspiciousTransactionService {
  private static final String[] NAMES = {
    "NORMAL", "FAN-OUT", "FAN-IN", "G-SCATTER", "S-GATHER", "CYCLE", "RANDOM", "BIPARTITE", "STACK"
  };
  private final JdbcTemplate jdbc;
  private final double ambiguityDelta;

  public SuspiciousTransactionService(
      JdbcTemplate jdbc,
      @org.springframework.beans.factory.annotation.Value("${app.type.ambiguity-delta:0.10}")
          double ambiguityDelta) {
    this.jdbc = jdbc;
    this.ambiguityDelta = ambiguityDelta;
  }

  public Map<String, Object> list(
      int page,
      int size,
      Long jobId,
      LocalDate date,
      Integer type,
      Double minScore,
      Integer bankId,
      String sort) {
    AnalysisService.validatePage(page, size);
    if ((type != null && (type < 0 || type > 8))
        || (minScore != null && (!Double.isFinite(minScore) || minScore < 0 || minScore > 1))
        || (bankId != null && bankId < 0)) throw AnalysisService.invalid();
    String order =
        switch (sort) {
          case "launderingScore,desc" -> "i.p_laundering desc,t.tx_id asc";
          case "launderingScore,asc" -> "i.p_laundering asc,t.tx_id asc";
          case "txId,asc" -> "t.tx_id asc";
          case "txId,desc" -> "t.tx_id desc";
          default -> throw AnalysisService.invalid();
        };
    StringBuilder from =
        new StringBuilder(
            """
        from inference_results i join batch_jobs j on j.job_id=i.job_id
        join transactions t on t.tx_id=i.tx_id
        join accounts f on f.account_id=t.from_account_id
        join accounts r on r.account_id=t.to_account_id
        cross join lateral (select ordinal-1 as code from unnest(array[i.p_0,i.p_1,i.p_2,i.p_3,i.p_4,i.p_5,i.p_6,i.p_7,i.p_8]) with ordinality as p(probability,ordinal) order by probability desc,ordinal limit 1) winner
        where j.status='COMPLETED' and j.job_type='ANALYSIS' and i.p_laundering>=j.threshold_value
        """);
    List<Object> args = new ArrayList<>();
    if (jobId != null) {
      from.append(" and j.job_id=?");
      args.add(jobId);
    }
    if (date != null) {
      from.append(" and j.analysis_date=?");
      args.add(date);
    }
    if (type != null) {
      from.append(" and winner.code=?");
      args.add(type);
    }
    if (minScore != null) {
      from.append(" and i.p_laundering>=?");
      args.add(minScore);
    }
    if (bankId != null) {
      from.append(" and (f.bank_id=? or r.bank_id=?)");
      args.add(bankId);
      args.add(bankId);
    }
    long count = jdbc.queryForObject("select count(*) " + from, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var rows =
        jdbc.queryForList(
            "select t.*,i.*,j.threshold_value,f.bank_id as from_bank,f.account_number as from_account,r.bank_id as to_bank,r.account_number as to_account "
                + from
                + " order by "
                + order
                + " limit ? offset ?",
            args.toArray());
    return AnalysisService.page(rows.stream().map(this::row).toList(), page, size, count);
  }

  private Map<String, Object> row(Map<String, Object> source) {
    Map<String, Object> out = new LinkedHashMap<>();
    String[][] mapping = {
      {"tx_id", "txId"},
      {"occurred_at", "txAt"},
      {"from_bank", "fromBank"},
      {"from_account", "fromAccount"},
      {"to_bank", "toBank"},
      {"to_account", "toAccount"},
      {"amount_received", "amountReceived"},
      {"receiving_currency", "receivingCurrency"},
      {"amount_paid", "amountPaid"},
      {"payment_currency", "paymentCurrency"},
      {"amount_usd", "amountUsd"},
      {"payment_format", "paymentFormat"},
      {"p_laundering", "launderingScore"},
      {"score_pct", "scorePercentile"},
      {"job_id", "jobId"}
    };
    for (var pair : mapping) out.put(pair[1], AnalysisService.jsonValue(source.get(pair[0])));
    double score = ((Number) source.get("p_laundering")).doubleValue();
    out.put("thresholdRatio", score / ((Number) source.get("threshold_value")).doubleValue());
    out.put("isSuspicious", true);
    List<Integer> ranking = new ArrayList<>();
    for (int code = 0; code < 9; code++) ranking.add(code);
    ranking.sort(
        Comparator.<Integer>comparingDouble(
                code -> ((Number) source.get("p_" + code)).doubleValue())
            .reversed()
            .thenComparingInt(code -> code));
    int first = ranking.get(0), second = ranking.get(1);
    double best = ((Number) source.get("p_" + first)).doubleValue();
    out.put("typeClass", first);
    out.put("typeName", NAMES[first]);
    out.put("typeScore", best);
    int count = best - ((Number) source.get("p_" + second)).doubleValue() < ambiguityDelta ? 2 : 1;
    out.put(
        "typeCandidates",
        ranking.subList(0, count).stream()
            .map(
                code -> Map.of("code", code, "name", NAMES[code], "score", source.get("p_" + code)))
            .toList());
    out.put("agreement", first == 0 ? "ATYPICAL" : "STRONG");
    return out;
  }
}
