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
      String linked = "exists(select 1 from episode_alerts ea where ea.alert_id=c.alert_id)";
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
          " and ((c.kind='ALERT' and ('A-'||c.alert_id::text) ilike ? escape '!') or (c.kind='EPISODE' and ('E-'||c.case_id::text) ilike ? escape '!') or exists(select 1 from users u where u.user_id=c.assignee_id and u.name ilike ? escape '!')");
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

  // Match the same effective evidence as ReviewService.groups: persisted decisions take
  // precedence, new Alert evidence is appended only while that case remains OPEN.
  static final String TYPES =
      """
    with saved as (
      select m from review_groups g cross join lateral jsonb_array_elements(g.members) m
      where g.case_id=c.case_id
    ), latest as (
      select v.evidence from alert_versions v join analysis_runs r using(run_id)
      join batch_jobs b on b.job_id=r.job_id where v.alert_id=c.alert_id
      and r.status='COMPLETED' and b.status='COMPLETED' order by v.version desc limit 1
    ), effective as (
      select m->'transaction' as t, m->'sources' as sources from saved
      where m->>'state' not in ('EXCLUDED','TRANSFERRED')
      union all
      select t, '[]'::jsonb from latest cross join lateral jsonb_array_elements(evidence->'transactions') t
      where c.kind='ALERT' and (c.status='OPEN' or not exists(select 1 from saved))
      and not exists(select 1 from saved where m->>'txId'=t->>'txId')
    ), votes as (
      select code,count(*) as n from (
        select distinct on(t->>'txId') t->>'txId' as id,
          (select i from generate_series(0,8) i
           order by coalesce((t->'scores'->>('p_'||i))::double precision,0) desc,i limit 1) code
        from effective where t->>'role'='SEED' and t->'scores' is not null
      ) x where code>0 group by code
    ), winners as (select code from votes where n=(select max(n) from votes))
    select case when count(*)=0 then '패턴 미특정' when count(*)>1 then '혼합'
      else (array['NON_PATTERN','Fan-out','Fan-in','Gather-scatter','Scatter-gather','Cycle','Random','Bipartite','Stack'])[max(code)+1] end as name
      from winners where c.kind='ALERT'
    having c.kind='ALERT'
    union
    select distinct source->>'primaryType' from effective cross join lateral jsonb_array_elements(coalesce(sources,'[]'::jsonb)) source
      where c.kind='EPISODE' and source->>'primaryType' is not null
    """;
}
