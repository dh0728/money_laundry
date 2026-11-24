package com.moneylaundry.api.rules;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.definition.RuleDefinition;
import com.moneylaundry.api.rules.definition.RuleSentence;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 룰 목록과 상세. 한 룰은 운영 버전(ACTIVE·PAUSED) 최대 1개와 작업 중 버전(DRAFT·SHADOW·PENDING) 최대 1개를 가진다. 목록의 상태는 작업 중
 * 버전이 시험 운영·승인 대기면 그 상태, 아니면 운영 버전의 상태, 운영 버전이 없으면 작성 중이다.
 */
@Service
public class RuleQueryService {
  private static final List<String> COUNTED =
      List.of("ACTIVE", "SHADOW", "PENDING", "PAUSED", "DRAFT");
  private final JdbcTemplate jdbc;
  private final RuleCatalog catalog;

  public RuleQueryService(JdbcTemplate jdbc, RuleCatalog catalog) {
    this.jdbc = jdbc;
    this.catalog = catalog;
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

  public Map<String, Object> list() {
    var counts = new LinkedHashMap<String, Integer>();
    for (String status : COUNTED) counts.put(status, 0);
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
      // 적중·Alert 숫자는 일일 실행이 붙은 뒤(3단계)에 채운다. 그때까지는 값이 없다.
      for (String later :
          List.of(
              "hitCount",
              "lastHitDate",
              "linkedAlertCount",
              "normalRate",
              "alertedHitCount",
              "skippedBusySubjects",
              "lastRunFailed")) rule.put(later, null);
      counts.merge(rule.get("status").toString(), 1, Integer::sum);
      content.add(rule);
    }
    var out = new LinkedHashMap<String, Object>();
    out.put("content", content);
    out.put("counts", counts);
    return out;
  }

  /** 상세 패널. 운영 버전과 작업 중 버전의 조건·문장, 버전 이력, 변경 기록. */
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
      if ("ACTIVE".equals(status) || "PAUSED".equals(status)) operating = version;
      else working = version;
    }
    var events = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select e.action,e.comment,e.business_at,u.name as actor,e.snapshot->>'versionNo' as version_no
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
    out.put("versions", versions);
    out.put("events", events);
    return out;
  }
}
