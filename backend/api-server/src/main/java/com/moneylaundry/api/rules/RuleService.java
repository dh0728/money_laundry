package com.moneylaundry.api.rules;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.definition.RuleDefinition;
import com.moneylaundry.api.rules.definition.RuleSentence;
import com.moneylaundry.api.rules.definition.RuleValidator;
import java.sql.Timestamp;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 룰을 만들고 고치는 명령: 저장 전 검증, 룰 만들기, 초안 저장, 초안 삭제. 룰은 이름표(rules.rules)이고 조건은 버전(rules.rule_versions)이
 * 갖는다. 모든 명령은 rules.events 에 한 줄씩 남는다.
 */
@Service
public class RuleService {
  public record ValidateInput(String template, Map<String, Object> definition, Long ruleId) {}

  public record CreateInput(String name, String template, Map<String, Object> definition) {}

  public record SaveInput(String name, Map<String, Object> definition, Long revision) {}

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final RuleCatalog catalog;

  public RuleService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, RuleCatalog catalog) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.catalog = catalog;
  }

  /** 화면에 보이는 룰 번호. RULE-003. */
  public static String code(long ruleId) {
    return String.format("RULE-%03d", ruleId);
  }

  private static ApiException invalid(String detail) {
    return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", detail);
  }

  private String name(String value) {
    if (value == null || value.isBlank() || value.strip().length() > catalog.limit("nameLength"))
      throw invalid("룰 이름은 1자 이상 " + catalog.limit("nameLength") + "자 이하여야 합니다.");
    return value.strip();
  }

  // ---- 검증 ----

  /** 저장 없이 검증한다. 체크리스트, 경고, 문장, 한 줄 요약을 같이 준다. */
  public Map<String, Object> validate(ValidateInput in) {
    if (in == null || in.template() == null) throw invalid("템플릿을 골라야 합니다.");
    return view(check(in.template(), in.definition(), in.ruleId()));
  }

  private RuleValidator.Result check(String template, Object definition, Long ruleId) {
    Integer ledgerDays =
        jdbc.queryForObject(
            "select max(business_date)-min(business_date)+1 from ledger.transactions where integration_status='ACTIVE'",
            Integer.class);
    Number window =
        definition instanceof Map<?, ?> map
            ? RuleDefinition.number(map.get("windowMinutes"))
            : null;
    var overlapping = new ArrayList<String>();
    // 운영 중인 다른 룰 가운데 템플릿과 기간이 같은 것. 막지는 않고 경고로 알린다.
    for (Long other :
        jdbc.queryForList(
            """
            select r.rule_id from rules.rules r join rules.rule_versions v using(rule_id)
            where v.status='ACTIVE' and r.template=? and r.rule_id<>?
              and v.definition->>'windowMinutes' is not distinct from ?::text
            order by r.rule_id
            """,
            Long.class,
            template,
            ruleId == null ? 0L : ruleId,
            window instanceof Long ? window.toString() : null)) overlapping.add(code(other));
    return RuleValidator.check(
        catalog, template, definition, new RuleValidator.Facts(ledgerDays, overlapping));
  }

  private Map<String, Object> view(RuleValidator.Result result) {
    var items = new ArrayList<Map<String, Object>>();
    for (var item : result.items()) {
      var row = new LinkedHashMap<String, Object>();
      row.put("key", item.key());
      row.put("label", item.label());
      row.put("ok", item.ok());
      row.put("message", item.message());
      row.put("errors", item.errors());
      items.add(row);
    }
    var out = new LinkedHashMap<String, Object>();
    out.put("items", items);
    out.put("warnings", result.warnings());
    out.put("canSave", result.canSave());
    out.put("canRun", result.canRun());
    boolean readable = result.definition() != null;
    out.put("sentence", readable ? RuleSentence.sentence(catalog, result.definition()) : null);
    out.put("summary", readable ? RuleSentence.summary(catalog, result.definition()) : null);
    return out;
  }

  /** 형식을 통과하지 못한 정의는 저장하지 않는다. 값이 빈 초안은 저장할 수 있다. */
  private RuleValidator.Result savable(String template, Object definition, Long ruleId) {
    var result = check(template, definition, ruleId);
    if (!result.canSave()) throw invalid(result.items().getFirst().message());
    return result;
  }

  // ---- 명령 ----

  /** 룰과 v1 초안을 만든다. 정의를 안 주면 템플릿의 기본값으로 채운다. */
  public Map<String, Object> create(long user, CreateInput in) {
    if (in == null || in.template() == null) throw invalid("템플릿을 골라야 합니다.");
    String name = name(in.name());
    Object given = in.definition() == null ? catalog.defaults(in.template()) : in.definition();
    return tx.execute(
        s -> {
          var definition = savable(in.template(), given, null).definition();
          String digest = RuleDefinition.digest(definition);
          String summary = RuleSentence.summary(catalog, definition);
          Timestamp at = Timestamp.from(time.now());
          long rule =
              jdbc.queryForObject(
                  "insert into rules.rules(name,template,owner_id,created_at) values(?,?,?,?) returning rule_id",
                  Long.class,
                  name,
                  in.template(),
                  user,
                  at);
          long version =
              jdbc.queryForObject(
                  """
                  insert into rules.rule_versions(rule_id,version_no,status,definition,definition_digest,summary,author_id,created_at)
                  values(?,1,'DRAFT',?::jsonb,?,?,?,?) returning version_id
                  """,
                  Long.class,
                  rule,
                  ReviewJson.encode(definition),
                  digest,
                  summary,
                  user,
                  at);
          event(rule, version, user, "CREATED", snapshot(1, name, summary, digest), at);
          var out = new LinkedHashMap<String, Object>();
          out.put("ruleId", rule);
          out.put("code", code(rule));
          out.put("versionId", version);
          out.put("revision", 0L);
          return out;
        });
  }

  /** 초안 저장. 작성 중(DRAFT)인 버전을 작성자만 고칠 수 있고, 기대 revision 이 다르면 409 다. 이름은 룰에, 조건은 버전에 저장한다. */
  public Map<String, Object> save(long ruleId, long versionId, long user, SaveInput in) {
    if (in == null || in.revision() == null || in.definition() == null)
      throw invalid("정의와 revision 이 필요합니다.");
    String name = name(in.name());
    return tx.execute(
        s -> {
          var found =
              jdbc.queryForList(
                  """
                  select r.template,v.status,v.author_id,v.revision,v.version_no
                  from rules.rule_versions v join rules.rules r using(rule_id)
                  where v.rule_id=? and v.version_id=? for update of v
                  """,
                  ruleId,
                  versionId);
          if (found.isEmpty()) throw ApiException.notFound("룰 버전이 없습니다.");
          var row = found.getFirst();
          if (ReviewJson.number(row.get("author_id")) != user)
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "작성자만 저장할 수 있습니다.");
          if (!"DRAFT".equals(row.get("status")))
            throw ApiException.invalidTransition("작성 중인 버전만 고칠 수 있습니다.");
          if (ReviewJson.number(row.get("revision")) != in.revision())
            throw ApiException.invalidTransition("다른 곳에서 먼저 저장했습니다. 다시 조회하세요.");
          var result = savable(row.get("template").toString(), in.definition(), ruleId);
          String digest = RuleDefinition.digest(result.definition());
          String summary = RuleSentence.summary(catalog, result.definition());
          int versionNo = ((Number) row.get("version_no")).intValue();
          jdbc.update(
              "update rules.rule_versions set definition=?::jsonb,definition_digest=?,summary=?,revision=revision+1 where version_id=?",
              ReviewJson.encode(result.definition()),
              digest,
              summary,
              versionId);
          jdbc.update("update rules.rules set name=? where rule_id=?", name, ruleId);
          event(
              ruleId,
              versionId,
              user,
              "EDITED",
              snapshot(versionNo, name, summary, digest),
              Timestamp.from(time.now()));
          var out = new LinkedHashMap<String, Object>();
          out.put("ruleId", ruleId);
          out.put("code", code(ruleId));
          out.put("name", name);
          out.put("versionId", versionId);
          out.put("versionNo", versionNo);
          out.put("status", "DRAFT");
          out.put("revision", in.revision() + 1);
          out.put("definition", result.definition());
          out.putAll(view(result));
          return out;
        });
  }

  /**
   * 초안 삭제. 한 번도 시험 운영·승인 요청을 하지 않은 작성 중 버전만, 작성자와 관리자가 지울 수 있다. 그 룰에 다른 버전이 없으면 룰과 변경 기록도 같이 지운다.
   * 다른 버전이 있으면 버전만 지우고 변경 기록에 삭제를 남긴다.
   */
  public void delete(long ruleId, long versionId, long user, boolean admin) {
    tx.executeWithoutResult(
        s -> {
          var found =
              jdbc.queryForList(
                  "select status,author_id,version_no,summary from rules.rule_versions where rule_id=? and version_id=? for update",
                  ruleId,
                  versionId);
          if (found.isEmpty()) throw ApiException.notFound("룰 버전이 없습니다.");
          var row = found.getFirst();
          if (!admin && ReviewJson.number(row.get("author_id")) != user)
            throw new ApiException(
                HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "작성자와 관리자만 초안을 지울 수 있습니다.");
          if (!"DRAFT".equals(row.get("status")))
            throw ApiException.invalidTransition("작성 중인 버전만 지울 수 있습니다.");
          if (Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "select exists(select 1 from rules.events where version_id=? and action in ('SHADOW_STARTED','SUBMITTED'))",
                  Boolean.class,
                  versionId)))
            throw ApiException.invalidTransition("시험 운영이나 승인 요청을 한 적이 있는 버전은 지울 수 없습니다.");
          boolean last =
              jdbc.queryForObject(
                      "select count(*) from rules.rule_versions where rule_id=? and version_id<>?",
                      Long.class,
                      ruleId,
                      versionId)
                  == 0;
          jdbc.update("delete from rules.backtests where version_id=?", versionId);
          if (last) jdbc.update("delete from rules.events where rule_id=?", ruleId);
          jdbc.update("delete from rules.rule_versions where version_id=?", versionId);
          if (last) jdbc.update("delete from rules.rules where rule_id=?", ruleId);
          else {
            var snapshot = new LinkedHashMap<String, Object>();
            snapshot.put("versionNo", row.get("version_no"));
            snapshot.put("summary", row.get("summary"));
            event(ruleId, null, user, "DRAFT_DELETED", snapshot, Timestamp.from(time.now()));
          }
        });
  }

  // ---- 변경 기록 ----

  private static Map<String, Object> snapshot(
      int versionNo, String name, String summary, String digest) {
    var snapshot = new LinkedHashMap<String, Object>();
    snapshot.put("versionNo", versionNo);
    snapshot.put("name", name);
    snapshot.put("summary", summary);
    snapshot.put("digest", digest);
    return snapshot;
  }

  private void event(
      long rule,
      Long version,
      long user,
      String action,
      Map<String, Object> snapshot,
      Timestamp at) {
    jdbc.update(
        "insert into rules.events(rule_id,version_id,actor_id,action,snapshot,business_at) values(?,?,?,?,?::jsonb,?)",
        rule,
        version,
        user,
        action,
        ReviewJson.encode(snapshot),
        at);
  }
}
