package com.moneylaundry.api.review;

import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/** Bound parameters only. Conditions run before count and pagination. */
public record ReviewCaseFilter(
    String query,
    List<String> types,
    Integer minAgeDays,
    String risk,
    List<String> statuses,
    List<Long> assignees) {
  public static final ReviewCaseFilter EMPTY =
      new ReviewCaseFilter(null, null, null, null, null, null);

  public String append(List<Object> args, Instant now) {
    if ((query != null && query.length() > 200)
        || (minAgeDays != null && (minAgeDays < 0 || minAgeDays > 36500))
        || (risk != null
            && !Set.of("high", "medium", "low").containsAll(Arrays.asList(risk.split(",", -1)))))
      throw AnalysisService.invalid();
    var sql = new StringBuilder();
    if (statuses != null && !statuses.isEmpty()) {
      if (statuses.size() > 3 || !Set.of("OPEN", "CLOSED", "ESCALATED").containsAll(statuses))
        throw AnalysisService.invalid();
      var clauses = new ArrayList<String>();
      String linked = "exists(select 1 from review.episode_alerts ea where ea.alert_id=c.alert_id)";
      for (String state : statuses)
        clauses.add(
            state.equals("ESCALATED")
                ? "(c.kind='ALERT' and " + linked + ")"
                : "(c.status='" + state + "' and not " + linked + ")");
      sql.append(" and (").append(String.join(" or ", clauses)).append(")");
    }
    if (assignees != null && !assignees.isEmpty()) {
      if (assignees.size() > 100 || assignees.stream().anyMatch(id -> id == null || id < 1))
        throw AnalysisService.invalid();
      sql.append(" and c.assignee_id in (")
          .append(String.join(",", Collections.nCopies(assignees.size(), "?")))
          .append(")");
      args.addAll(assignees);
    }
    if (minAgeDays != null) {
      sql.append(" and c.created_at<=?");
      args.add(Timestamp.from(now.minus(Duration.ofDays(minAgeDays))));
    }
    if (risk != null) {
      var bands =
          Arrays.stream(risk.split(","))
              .distinct()
              .map(
                  value ->
                      switch (value) {
                        case "high" -> "c.risk>=0.8";
                        case "medium" -> "(c.risk>=0.5 and c.risk<0.8)";
                        default -> "c.risk<0.5";
                      })
              .toList();
      sql.append(" and (").append(String.join(" or ", bands)).append(")");
    }
    if (types != null && !types.isEmpty()) {
      var allowed = new HashSet<>(List.of(CaseSummary.TYPES));
      allowed.add("패턴 미특정");
      allowed.add("혼합");
      if (types.size() > 11 || !allowed.containsAll(types)) throw AnalysisService.invalid();
      sql.append(" and exists(select 1 from (")
          .append(TYPES)
          .append(") ct where ct.name in (")
          .append(String.join(",", Collections.nCopies(types.size(), "?")))
          .append("))");
      args.addAll(types);
    }
    if (query != null && !query.isBlank()) {
      String q = query.strip();
      String like = "%" + q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
      sql.append(
          " and ((c.kind='ALERT' and ('A-'||c.alert_id::text) ilike ? escape '!') or (c.kind='EPISODE' and ('E-'||c.case_id::text) ilike ? escape '!') or exists(select 1 from core.users u where u.user_id=c.assignee_id and u.name ilike ? escape '!')");
      args.addAll(List.of(like, like, like));
      var names = new ArrayList<>(List.of(CaseSummary.TYPES));
      names.addAll(List.of("패턴 미특정", "혼합"));
      if (names.stream()
          .anyMatch(name -> name.toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT)))) {
        sql.append(" or exists(select 1 from (")
            .append(TYPES)
            .append(") ct where ct.name ilike ? escape '!')");
        args.add(like);
      }
      sql.append(")");
    }
    return sql.toString();
  }

  // Current summaries are rebuilt in the same transaction as scope publication.
  // Episodes match the fixed source Alert types; Alerts match their current scope.
  static final String TYPES =
      """
      select c.summary->>'primaryType' as name where c.kind='ALERT'
      union all
      select jsonb_array_elements_text(c.summary->'primaryTypes') where c.kind='EPISODE'
      """;
}
