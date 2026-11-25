package com.moneylaundry.api.rules;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.definition.RuleDefinition;
import com.moneylaundry.api.rules.definition.RuleSentence;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 룰 목록과 상세. 한 룰은 운영 버전(ACTIVE·PAUSED) 최대 1개와 작업 중 버전(DRAFT·SHADOW·PENDING) 최대 1개를 가진다. 목록의 상태는 작업 중
 * 버전이 시험 운영·승인 대기면 그 상태, 아니면 운영 버전의 상태, 운영 버전이 없으면 작성 중이다.
 *
 * <p>적중 숫자는 끝난 실행, 끝난 분석의 것만 센다. Alert 와의 연결은 저장하지 않고 "적중의 근거 거래와 Alert 의 공개된 거래에 같은 거래가 있는가"로 센다.
 */
@Service
public class RuleQueryService {
  private static final List<String> COUNTED =
      List.of("ACTIVE", "SHADOW", "PENDING", "PAUSED", "DRAFT");

  /** 상세에 보여 주는 최근 일일 실행 수. 백테스트 실행 기록과 같은 수다. */
  private static final int RECENT_EXECUTIONS = 20;

  // 끝난 실행, 끝난 분석의 적중. h = rules.hits, v = 그 버전.
  private static final String VALID_HITS =
      """
      rules.hits h
      join rules.executions e on e.execution_id=h.execution_id and e.status='COMPLETED'
      join analysis.runs n on n.run_id=e.run_id and n.status='COMPLETED'
      join rules.rule_versions v on v.version_id=h.version_id
      """;

  private final JdbcTemplate jdbc;
  private final RuleCatalog catalog;
  private final boolean selfApproval;

  public RuleQueryService(
      JdbcTemplate jdbc,
      RuleCatalog catalog,
      @Value("${app.rules.self-approval:true}") boolean selfApproval) {
    this.jdbc = jdbc;
    this.catalog = catalog;
    this.selfApproval = selfApproval;
  }

  private static String text(Object timestamp) {
    return timestamp == null ? null : ((Timestamp) timestamp).toInstant().toString();
  }

  private String templateName(Object key) {
    var template = catalog.template(String.valueOf(key));
    return template == null ? String.valueOf(key) : template.get("name").toString();
  }

  /** 목록에 보여 줄 버전: 시험 운영·승인 대기 중인 작업 버전 → 운영 버전 → 작성 중인 버전. */
  private static String shown(Object operating, Object working) {
    if ("SHADOW".equals(working) || "PENDING".equals(working)) return "w";
    return operating != null ? "o" : "w";
  }

  /** 룰마다 한 줄씩 나오는 집계를 rule_id 로 찾게 모은다. */
  private Map<Long, Map<String, Object>> byRule(String sql) {
    var out = new HashMap<Long, Map<String, Object>>();
    for (var row : jdbc.queryForList(sql)) out.put(ReviewJson.number(row.get("rule_id")), row);
    return out;
  }

  public Map<String, Object> list() {
    var counts = new LinkedHashMap<String, Integer>();
    for (String status : COUNTED) counts.put(status, 0);
    // 운영 적중(LIVE): 대상 × 날짜 수와 가장 최근 거래 기준일
    var live =
        byRule(
            "select v.rule_id,count(*) as hits,max(h.hit_date)::text as last_hit from "
                + VALID_HITS
                + " where h.mode='LIVE' group by v.rule_id");
    // 지금 시험 운영 중인 버전이 쌓은 적중
    var shadow =
        byRule(
            "select v.rule_id,count(*) as hits from "
                + VALID_HITS
                + " where h.mode='SHADOW' and v.status in ('SHADOW','PENDING') group by v.rule_id");
    // 운영 적중과 거래가 겹치는 Alert. Episode 에 편입된 Alert 는 그 Episode 의 판정을 따른다.
    var linked =
        byRule(
            """
            select rule_id,count(*) as alerts,
              count(*) filter (where outcome='NORMAL') as normal,
              count(*) filter (where outcome='SUSPICIOUS') as suspicious
            from (
              select distinct v.rule_id,a.alert_id,
                case when a.outcome='TRANSFERRED' then ep.outcome else a.outcome end as outcome
              from %s
              join rules.hit_transactions ht on ht.hit_id=h.hit_id
              join review.alert_transactions at on at.tx_id=ht.tx_id
              join review.alerts a on a.alert_id=at.alert_id and a.published_version=at.version
               and a.merged_into_alert_id is null
              left join review.episode_alerts ea on ea.alert_id=a.alert_id
              left join review.episodes ep on ep.episode_id=ea.episode_id
              where h.mode='LIVE'
            ) per_alert group by rule_id
            """
                .formatted(VALID_HITS));
    // 가장 최근 일일 실행
    var lastRun =
        byRule(
            """
            select distinct on (v.rule_id) v.rule_id,e.status,e.skipped_subjects
            from rules.executions e join rules.rule_versions v on v.version_id=e.version_id
            join analysis.runs n on n.run_id=e.run_id
            where e.status in ('COMPLETED','FAILED')
            order by v.rule_id,n.input_seq desc,e.execution_id desc
            """);
    var content = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select r.rule_id,r.name,r.template,u.name as owner,
              o.version_id as o_id,o.version_no as o_no,o.status as o_status,o.summary as o_summary,o.definition->>'then' as o_then,
              w.version_id as w_id,w.version_no as w_no,w.status as w_status,w.summary as w_summary,w.definition->>'then' as w_then,
              (select max(e.business_at) from rules.events e where e.rule_id=r.rule_id) as changed_at
            from rules.rules r join core.users u on u.user_id=r.owner_id
            left join rules.rule_versions o on o.rule_id=r.rule_id and o.status in ('ACTIVE','PAUSED')
            left join rules.rule_versions w on w.rule_id=r.rule_id and w.status in ('DRAFT','SHADOW','PENDING')
            order by r.rule_id
            """)) {
      String shown = shown(row.get("o_status"), row.get("w_status"));
      if (row.get(shown + "_id") == null) continue; // 버전이 하나도 없는 룰은 만들어지지 않는다.
      long id = ReviewJson.number(row.get("rule_id"));
      var rule = new LinkedHashMap<String, Object>();
      rule.put("ruleId", id);
      rule.put("code", RuleService.code(id));
      rule.put("name", row.get("name"));
      rule.put("template", row.get("template"));
      rule.put("templateName", templateName(row.get("template")));
      rule.put("summary", row.get(shown + "_summary"));
      rule.put("status", row.get(shown + "_status"));
      rule.put("then", row.get(shown + "_then"));
      rule.put("versionNo", row.get(shown + "_no"));
      rule.put("versionId", row.get(shown + "_id"));
      rule.put("operatingVersionNo", row.get("o_no"));
      rule.put("operatingStatus", row.get("o_status"));
      rule.put("operatingSummary", row.get("o_summary"));
      rule.put("workingVersionNo", row.get("w_no"));
      rule.put("workingStatus", row.get("w_status"));
      rule.put("owner", row.get("owner"));
      rule.put("changedAt", text(row.get("changed_at")));
      var hits = live.get(id);
      var alerts = linked.get(id);
      var run = lastRun.get(id);
      rule.put("hitCount", hits == null ? 0L : hits.get("hits"));
      rule.put("lastHitDate", hits == null ? null : hits.get("last_hit"));
      rule.put("shadowHitCount", shadow.get(id) == null ? null : shadow.get(id).get("hits"));
      rule.put("linkedAlertCount", alerts == null ? 0L : alerts.get("alerts"));
      rule.put("normalRate", alerts == null ? null : normalRate(alerts));
      // "Alert 생성" 룰의 운영 적중 중 Alert 가 된 수. Alert 생성을 아직 제공하지 않는다.
      rule.put("alertedHitCount", null);
      rule.put("skippedBusySubjects", run == null ? null : run.get("skipped_subjects"));
      rule.put("lastRunFailed", run == null ? null : "FAILED".equals(run.get("status")));
      counts.merge(rule.get("status").toString(), 1, Integer::sum);
      content.add(rule);
    }
    var out = new LinkedHashMap<String, Object>();
    out.put("content", content);
    out.put("counts", counts);
    return out;
  }

  /** 정상 판정(오탐) 비율(%). 연결 Alert 가운데 사람이 종결한 것에서 정상 ÷ (정상 + 의심). 종결한 것이 없으면 null. */
  private static Double normalRate(Map<String, Object> alerts) {
    long normal = ReviewJson.number(alerts.get("normal"));
    long judged = normal + ReviewJson.number(alerts.get("suspicious"));
    return judged == 0 ? null : Math.round(normal * 1000.0 / judged) / 10.0;
  }

  /** 상세 패널. 운영 버전과 작업 중 버전의 조건·문장·최근 백테스트, 지금 할 수 있는 명령, 버전 이력, 최근 일일 실행, 변경 기록. */
  public Map<String, Object> detail(long ruleId, long user, boolean admin) {
    var rules =
        jdbc.queryForList(
            "select r.rule_id,r.name,r.template,r.created_at,u.name as owner from rules.rules r join core.users u on u.user_id=r.owner_id where r.rule_id=?",
            ruleId);
    if (rules.isEmpty()) throw ApiException.notFound("룰이 없습니다.");
    var rule = rules.getFirst();
    var touched = new HashSet<Long>();
    // 시험 운영·승인 요청을 한 적이 있는 버전은 지울 수 없다.
    touched.addAll(
        jdbc.queryForList(
            "select distinct version_id from rules.events where rule_id=? and version_id is not null and action in ('SHADOW_STARTED','SUBMITTED')",
            Long.class,
            ruleId));
    Map<String, Object> operating = null;
    Map<String, Object> working = null;
    var commands = new ArrayList<Map<String, Object>>();
    var versions = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select v.version_id,v.version_no,v.status,v.definition::text as definition,v.definition_digest,
              v.summary,v.revision,v.author_id,a.name as author,v.created_at,v.submitted_at,v.decided_at,d.name as decided_by
            from rules.rule_versions v join core.users a on a.user_id=v.author_id
            left join core.users d on d.user_id=v.decided_by
            where v.rule_id=? order by v.version_no desc
            """,
            ruleId)) {
      String status = row.get("status").toString();
      long versionId = ReviewJson.number(row.get("version_id"));
      boolean mine = ReviewJson.number(row.get("author_id")) == user;
      boolean draft = "DRAFT".equals(status);
      var line = new LinkedHashMap<String, Object>();
      line.put("versionId", versionId);
      line.put("versionNo", row.get("version_no"));
      line.put("status", status);
      line.put("summary", row.get("summary"));
      line.put("author", row.get("author"));
      line.put("createdAt", text(row.get("created_at")));
      line.put("submittedAt", text(row.get("submitted_at")));
      line.put("decidedAt", text(row.get("decided_at")));
      line.put("decidedBy", row.get("decided_by"));
      versions.add(line);
      if ("RETIRED".equals(status)) continue;
      var definition = RuleDefinition.canonical(row.get("definition"));
      var version = new LinkedHashMap<String, Object>(line);
      version.put("revision", row.get("revision"));
      version.put("definition", definition);
      version.put("digest", row.get("definition_digest"));
      version.put("sentence", RuleSentence.sentence(catalog, definition));
      version.put("editable", draft && mine);
      version.put("deletable", draft && (mine || admin) && !touched.contains(versionId));
      version.put("backtest", latestBacktest(versionId, row.get("definition_digest").toString()));
      boolean backtested =
          Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "select exists(select 1 from rules.backtests where version_id=? and definition_digest=? and status='COMPLETED')",
                  Boolean.class,
                  versionId,
                  row.get("definition_digest")));
      for (String action : RuleTransitions.ACTIONS) {
        var transition = RuleTransitions.of(action);
        if (!transition.from().contains(status)) continue;
        String reason = RuleTransitions.forbidden(action, transition, mine, admin, selfApproval);
        if (reason == null && transition.backtest() && !backtested)
          reason = RuleTransitions.NEEDS_BACKTEST;
        var command = new LinkedHashMap<String, Object>();
        command.put("action", action);
        command.put("versionId", versionId);
        command.put("revision", row.get("revision"));
        command.put("enabled", reason == null);
        command.put("reason", reason);
        command.put("commentRequired", transition.comment());
        commands.add(command);
      }
      if ("ACTIVE".equals(status) || "PAUSED".equals(status)) operating = version;
      else working = version;
    }
    // 운영 버전을 복사해 새 초안 만들기(POST /rules/{ruleId}/versions)
    if (operating != null) {
      var command = new LinkedHashMap<String, Object>();
      command.put("action", "NEW_VERSION");
      command.put("versionId", operating.get("versionId"));
      command.put("revision", operating.get("revision"));
      command.put("enabled", working == null);
      command.put("reason", working == null ? null : "작업 중인 버전이 이미 있습니다.");
      command.put("commentRequired", false);
      commands.add(command);
    }
    // 복제(POST /rules/{ruleId}/clone). 버전이 하나라도 있으면 언제나 된다. versionId 는 복제될 버전이다.
    var copied = operating != null ? operating : working;
    if (copied != null) {
      var command = new LinkedHashMap<String, Object>();
      command.put("action", "CLONE");
      command.put("versionId", copied.get("versionId"));
      command.put("revision", copied.get("revision"));
      command.put("enabled", true);
      command.put("reason", null);
      command.put("commentRequired", false);
      commands.add(command);
    }
    var executions = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select v.version_no,e.mode,e.status,j.analysis_date::text as analysis_date,e.trigger_count,e.hit_count,
              e.skipped_subjects,e.error_code,e.finished_at
            from rules.executions e join rules.rule_versions v on v.version_id=e.version_id
            join analysis.runs n on n.run_id=e.run_id join analysis.jobs j on j.job_id=n.job_id
            where v.rule_id=? and e.status in ('COMPLETED','FAILED')
            order by n.input_seq desc,e.execution_id desc limit ?
            """,
            ruleId,
            RECENT_EXECUTIONS)) {
      var execution = new LinkedHashMap<String, Object>();
      execution.put("versionNo", row.get("version_no"));
      execution.put("mode", row.get("mode"));
      execution.put("status", row.get("status"));
      execution.put("analysisDate", row.get("analysis_date"));
      execution.put("triggerCount", row.get("trigger_count"));
      execution.put("hitCount", row.get("hit_count"));
      execution.put("skippedBusySubjects", row.get("skipped_subjects"));
      execution.put("errorCode", row.get("error_code"));
      execution.put("finishedAt", text(row.get("finished_at")));
      executions.add(execution);
    }
    var events = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select e.action,e.comment,e.business_at,u.name as actor,e.snapshot->>'versionNo' as version_no,
              coalesce((e.snapshot->>'selfApproved')::boolean,false) as self_approved,
              e.snapshot->'clonedFrom'->>'code' as cloned_code,e.snapshot->'clonedFrom'->>'versionNo' as cloned_version
            from rules.events e left join core.users u on u.user_id=e.actor_id
            where e.rule_id=? order by e.event_id desc limit 200
            """,
            ruleId)) {
      var event = new LinkedHashMap<String, Object>();
      event.put("at", text(row.get("business_at")));
      event.put("actor", row.get("actor"));
      event.put("action", row.get("action"));
      event.put("comment", row.get("comment"));
      event.put(
          "versionNo",
          row.get("version_no") == null ? null : Integer.valueOf(row.get("version_no").toString()));
      // 작성자가 자기 버전을 승인했다
      event.put("selfApproved", row.get("self_approved"));
      // 다른 룰을 복제해 만든 룰이면 첫 기록에 그 룰과 버전이 온다
      event.put("clonedFrom", clonedFrom(row));
      events.add(event);
    }
    long id = ReviewJson.number(rule.get("rule_id"));
    var out = new LinkedHashMap<String, Object>();
    out.put("ruleId", id);
    out.put("code", RuleService.code(id));
    out.put("name", rule.get("name"));
    out.put("template", rule.get("template"));
    out.put("templateName", templateName(rule.get("template")));
    out.put("owner", rule.get("owner"));
    out.put("createdAt", text(rule.get("created_at")));
    boolean testing =
        working != null
            && ("SHADOW".equals(working.get("status")) || "PENDING".equals(working.get("status")));
    var shown = testing || operating == null ? working : operating;
    out.put("status", shown == null ? null : shown.get("status"));
    out.put("operating", operating);
    out.put("working", working);
    out.put("commands", commands);
    out.put("versions", versions);
    out.put("executions", executions);
    out.put("events", events);
    return out;
  }

  /** 변경 기록 한 줄의 복제 출처 {code, versionNo}. 복제로 만든 기록이 아니면 null. */
  private static Map<String, Object> clonedFrom(Map<String, Object> row) {
    if (row.get("cloned_code") == null) return null;
    var out = new LinkedHashMap<String, Object>();
    out.put("code", row.get("cloned_code"));
    out.put(
        "versionNo",
        row.get("cloned_version") == null
            ? null
            : Integer.valueOf(row.get("cloned_version").toString()));
    return out;
  }

  /** 그 버전의 가장 최근 백테스트. currentDefinition 이 false 면 돌린 뒤에 조건을 고친 것이다. 없으면 null. */
  private Map<String, Object> latestBacktest(long versionId, String digest) {
    var rows =
        jdbc.queryForList(
            "select backtest_id,status,definition_digest,finished_at from rules.backtests where version_id=? order by backtest_id desc limit 1",
            versionId);
    if (rows.isEmpty()) return null;
    var row = rows.getFirst();
    var out = new LinkedHashMap<String, Object>();
    out.put("backtestId", row.get("backtest_id"));
    out.put("status", row.get("status"));
    out.put("currentDefinition", digest.equals(row.get("definition_digest").toString().strip()));
    out.put("finishedAt", text(row.get("finished_at")));
    return out;
  }
}
