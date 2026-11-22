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

/** 의심 거래 목록 조회: 분석 작업·날짜·유형 필터와 페이지 처리. */
@Service
public class SuspiciousTransactionService {
  private static final String[] NAMES = {
    "NON_PATTERN",
    "FAN-OUT",
    "FAN-IN",
    "G-SCATTER",
    "S-GATHER",
    "CYCLE",
    "RANDOM",
    "BIPARTITE",
    "STACK"
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
            from analysis.scores i join analysis.runs ar using(run_id)
            join analysis.jobs j on j.job_id=ar.job_id and j.current_run_id=ar.run_id
            join ledger.transactions t on t.tx_id=i.tx_id
            join core.accounts f on f.account_id=t.from_account_id
            join core.accounts r on r.account_id=t.to_account_id
            where j.status='COMPLETED' and ar.status='COMPLETED' and i.p_laundering>=j.threshold_value
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
      from.append(" and i.type_class=?");
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
            "select t.*,i.*,j.job_id,j.threshold_value,f.bank_id as from_bank,f.service_account_id::text as"
                + " from_account,r.bank_id as to_bank,r.service_account_id::text as to_account "
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
