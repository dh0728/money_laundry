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

  // Match the same effective evidence as ReviewService.groups: persisted decisions take
  // precedence, new Alert evidence is appended only while that case remains OPEN.
  static final String TYPES =
      """
      with effective as (
        select m.alert_id,m.evidence_version,t
        from review.effective_members m join review.alert_versions v
          on v.alert_id=m.alert_id and v.version=m.evidence_version
        cross join lateral jsonb_array_elements(v.evidence->'transactions') t
        where m.case_id=c.case_id and m.state not in ('EXCLUDED','TRANSFERRED')
          and (t->>'txId')::bigint=m.tx_id
      ), inputs as (
        select 0::bigint as source,0 as version,t from effective where c.kind='ALERT'
        union all
        select e.alert_id,e.evidence_version,t
        from (select distinct alert_id,evidence_version from effective) e
        join review.alert_versions v on v.alert_id=e.alert_id and v.version=e.evidence_version
        cross join lateral jsonb_array_elements(v.evidence->'transactions') t where c.kind='EPISODE'
      ), codes as (
        select distinct on(source,version,t->>'txId') source,version,t->>'txId' as id,
          (select i from generate_series(0,8) i order by
            coalesce((t->'scores'->>('p_'||i))::double precision,0) desc,i limit 1) code
        from inputs where t->>'role'='SEED' and t->'scores' is not null
      ), votes as (
        select source,version,code,count(*) n from codes where code>0 group by source,version,code
      ), winners as (
        select source,version,code from (select *,max(n) over(partition by source,version) best from votes) x
        where n=best
      ), sources as (
        select distinct source,version from inputs
        union select 0::bigint,0 where c.kind='ALERT'
      )
      select case when count(w.code)=0 then '패턴 미특정' when count(w.code)>1 then '혼합'
        else (array['NON_PATTERN','Fan-out','Fan-in','Gather-scatter','Scatter-gather','Cycle','Random','Bipartite','Stack'])[max(w.code)+1] end as name
      from sources s left join winners w using(source,version) group by s.source,s.version
      """;
}
