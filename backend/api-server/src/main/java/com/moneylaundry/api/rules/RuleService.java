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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 룰을 만들고 고치는 명령: 저장 전 검증, 룰 만들기, 초안 저장, 초안 삭제, 새 버전 만들기, 상태 명령(시험 운영 · 승인 요청 · 승인 · 반려 · 중지 · 재개).
 * 룰은 이름표(rules.rules)이고 조건은 버전(rules.rule_versions)이 갖는다. 모든 명령은 rules.events 에 한 줄씩 남는다.
 */
@Service
public class RuleService {
  public record ValidateInput(String template, Map<String, Object> definition, Long ruleId) {}

  public record CreateInput(String name, String template, Map<String, Object> definition) {}

  /** 복제 요청. 둘 다 비워도 된다. versionId 가 없으면 운영 버전(없으면 작업 중 버전)을, name 이 없으면 "원래 이름 복사본" 을 쓴다. */
  public record CloneInput(Long versionId, String name) {}

  /** 복제한 룰의 이름 뒤에 붙는 말. */
  static final String COPY_SUFFIX = " 복사본";

  public record SaveInput(String name, Map<String, Object> definition, Long revision) {}

  /**
   * 상태 명령. action 은 START_SHADOW · SUBMIT · WITHDRAW · APPROVE · REJECT · PAUSE · RESUME. requestId
   * 를 주면 같은 요청이 두 번 와도 한 번만 적용한다.
   */
  public record CommandInput(
      String requestId, String action, Long versionId, Long revision, String comment) {}

  /** 사유의 길이. 조사 화면의 판정 사유와 같은 값이다. */
  private static final int COMMENT_LIMIT = 2000;

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final RuleCatalog catalog;
  private final boolean selfApproval;

  public RuleService(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      RuleCatalog catalog,
      @Value("${app.rules.self-approval:true}") boolean selfApproval) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.catalog = catalog;
    this.selfApproval = selfApproval;
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

  /** 저장 전 검증. 원장에 쌓인 기간과 겹치는 운영 룰을 같이 본다. */
  public RuleValidator.Result check(String template, Object definition, Long ruleId) {
    Integer ledgerDays =
        jdbc.queryForObject(
            "select max(business_date)-min(business_date)+1 from ledger.transactions",
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
                  select r.template,v.status,v.author_id,v.revision,v.version_no,v.definition_digest
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
          // 조건이 바뀌면 예전 조건으로 시험 운영하며 쌓은 적중은 이 버전의 것이 아니다
          if (!digest.equals(row.get("definition_digest").toString().strip()))
            jdbc.update("delete from rules.hits where version_id=? and mode='SHADOW'", versionId);
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

  /**
   * 룰을 복제한다. 그 룰의 한 버전의 조건을 그대로 가진 <b>새 룰</b>의 v1 초안이 생기고 복제한 사람이 담당자가 된다. 원래 룰은 건드리지 않는다. 같은 룰의 다음
   * 버전을 만드는 {@link #newVersion} 과 다르다.
   *
   * <p>어느 상태의 버전이든 복제할 수 있다. versionId 를 주지 않으면 운영 버전, 없으면 작업 중 버전, 그것도 없으면 가장 나중 버전이다. 조건은 다시 검증하지
   * 않고 그대로 옮긴다(저장할 때 검증한다). 백테스트 · 적중 · 변경 기록은 옮기지 않는다.
   */
  public Map<String, Object> clone(long ruleId, long user, CloneInput in) {
    return tx.execute(
        s -> {
          var rules =
              jdbc.queryForList("select name,template from rules.rules where rule_id=?", ruleId);
          if (rules.isEmpty()) throw ApiException.notFound("룰이 없습니다.");
          var source =
              jdbc.queryForList(
                  """
                  select version_no,definition::text as definition,definition_digest,summary
                  from rules.rule_versions
                  where rule_id=? and (?::bigint is null or version_id=?)
                  order by case when status in ('ACTIVE','PAUSED') then 0
                                when status in ('DRAFT','SHADOW','PENDING') then 1 else 2 end,
                           version_no desc
                  limit 1
                  """,
                  ruleId,
                  in == null ? null : in.versionId(),
                  in == null ? null : in.versionId());
          if (source.isEmpty()) throw ApiException.notFound("복제할 버전이 없습니다.");
          var base = source.getFirst();
          String name =
              in == null || in.name() == null
                  ? copyName(rules.getFirst().get("name").toString())
                  : name(in.name());
          Timestamp at = Timestamp.from(time.now());
          String digest = base.get("definition_digest").toString();
          String summary = base.get("summary").toString();
          long rule =
              jdbc.queryForObject(
                  "insert into rules.rules(name,template,owner_id,created_at) values(?,?,?,?) returning rule_id",
                  Long.class,
                  name,
                  rules.getFirst().get("template"),
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
                  base.get("definition"),
                  digest,
                  summary,
                  user,
                  at);
          // 새 룰의 첫 기록에 어디서 복제했는지 남긴다
          var snapshot = snapshot(1, name, summary, digest);
          var origin = new LinkedHashMap<String, Object>();
          origin.put("ruleId", ruleId);
          origin.put("code", code(ruleId));
          origin.put("versionNo", base.get("version_no"));
          snapshot.put("clonedFrom", origin);
          event(rule, version, user, "CREATED", "", snapshot, at);
          var out = new LinkedHashMap<String, Object>();
          out.put("ruleId", rule);
          out.put("code", code(rule));
          out.put("name", name);
          out.put("versionId", version);
          out.put("revision", 0L);
          return out;
        });
  }

  /** "원래 이름 복사본". 이름 길이 한도를 넘으면 원래 이름의 뒤를 잘라 맞춘다. */
  private String copyName(String original) {
    int room = catalog.limit("nameLength") - COPY_SUFFIX.length();
    return (original.length() > room ? original.substring(0, room).stripTrailing() : original)
        + COPY_SUFFIX;
  }

  /** 운영 버전을 복사해 새 초안을 만든다. 운영 중인 조건은 직접 고치지 못하므로 고치려면 이 버전을 고쳐 승인받는다. 작업 중 버전이 이미 있으면 409 다. */
  public Map<String, Object> newVersion(long ruleId, long user) {
    return tx.execute(
        s -> {
          String name = lock(ruleId);
          var operating =
              jdbc.queryForList(
                  "select version_no,definition::text as definition,definition_digest,summary from rules.rule_versions where rule_id=? and status in ('ACTIVE','PAUSED')",
                  ruleId);
          if (operating.isEmpty())
            throw ApiException.invalidTransition("운영 버전이 있는 룰만 새 버전을 만들 수 있습니다.");
          if (Boolean.TRUE.equals(
              jdbc.queryForObject(
                  "select exists(select 1 from rules.rule_versions where rule_id=? and status in ('DRAFT','SHADOW','PENDING'))",
                  Boolean.class,
                  ruleId))) throw ApiException.invalidTransition("작업 중인 버전이 이미 있습니다.");
          var base = operating.getFirst();
          int versionNo =
              jdbc.queryForObject(
                  "select max(version_no)+1 from rules.rule_versions where rule_id=?",
                  Integer.class,
                  ruleId);
          Timestamp at = Timestamp.from(time.now());
          String digest = base.get("definition_digest").toString();
          String summary = base.get("summary").toString();
          long version =
              jdbc.queryForObject(
                  """
                  insert into rules.rule_versions(rule_id,version_no,status,definition,definition_digest,summary,author_id,created_at)
                  values(?,?,'DRAFT',?::jsonb,?,?,?,?) returning version_id
                  """,
                  Long.class,
                  ruleId,
                  versionNo,
                  base.get("definition"),
                  digest,
                  summary,
                  user,
                  at);
          var snapshot = snapshot(versionNo, name, summary, digest);
          snapshot.put("basedOnVersionNo", base.get("version_no"));
          event(ruleId, version, user, "CREATED", "", snapshot, at);
          var out = new LinkedHashMap<String, Object>();
          out.put("ruleId", ruleId);
          out.put("code", code(ruleId));
          out.put("versionId", version);
          out.put("versionNo", versionNo);
          out.put("revision", 0L);
          return out;
        });
  }

  /**
   * 상태 명령 하나를 적용한다. 누가 무엇을 할 수 있는지는 {@link RuleTransitions} 의 표를 따른다.
   *
   * <ul>
   *   <li>시험 운영 시작 · 승인 요청은 지금 조건으로 끝낸 백테스트가 있어야 한다
   *   <li>승인하면 같은 트랜잭션에서 기존 운영 버전(운영 중 · 중지)은 RETIRED 가 된다
   *   <li>매일 실행할지는 eval_from_seq 로 정한다. 시험 운영 · 운영이 되는 순간의 가장 큰 분석 순번을 적고, 그 뒤에 입력이 고정된 분석부터 돈다. 작성
   *       중으로 돌아가거나 중지하면 비운다
   * </ul>
   */
  public void command(long ruleId, long user, boolean admin, CommandInput in) {
    var transition = in == null ? null : RuleTransitions.of(in.action());
    if (transition == null) throw invalid("알 수 없는 명령입니다.");
    if (in.versionId() == null || in.revision() == null) throw invalid("버전과 revision 이 필요합니다.");
    String comment = in.comment() == null ? "" : in.comment().strip();
    if (comment.length() > COMMENT_LIMIT) throw invalid("사유는 " + COMMENT_LIMIT + "자 이하여야 합니다.");
    if (transition.comment() && comment.isEmpty()) throw invalid("사유를 적어야 합니다.");
    String requestId = in.requestId() == null || in.requestId().isBlank() ? null : in.requestId();
    if (requestId != null && requestId.length() > 100) throw invalid("requestId 가 너무 깁니다.");
    tx.executeWithoutResult(
        s -> {
          String name = lock(ruleId);
          if (requestId != null
              && Boolean.TRUE.equals(
                  jdbc.queryForObject(
                      "select exists(select 1 from rules.events where rule_id=? and snapshot->>'requestId'=?)",
                      Boolean.class,
                      ruleId,
                      requestId))) return; // 같은 요청이 다시 왔다
          var found =
              jdbc.queryForList(
                  "select status,author_id,revision,version_no,definition_digest,summary from rules.rule_versions where rule_id=? and version_id=? for update",
                  ruleId,
                  in.versionId());
          if (found.isEmpty()) throw ApiException.notFound("룰 버전이 없습니다.");
          var row = found.getFirst();
          boolean author = ReviewJson.number(row.get("author_id")) == user;
          String refused =
              RuleTransitions.forbidden(in.action(), transition, author, admin, selfApproval);
          if (refused != null)
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", refused);
          if (!transition.from().contains(row.get("status").toString()))
            throw ApiException.invalidTransition("지금 상태에서는 할 수 없는 명령입니다.");
          if (ReviewJson.number(row.get("revision")) != in.revision())
            throw ApiException.invalidTransition("다른 곳에서 먼저 바꿨습니다. 다시 조회하세요.");
          String digest = row.get("definition_digest").toString();
          if (transition.backtest() && !backtested(in.versionId(), digest))
            throw ApiException.invalidTransition(RuleTransitions.NEEDS_BACKTEST);

          Timestamp at = Timestamp.from(time.now());
          int versionNo = ((Number) row.get("version_no")).intValue();
          var snapshot = snapshot(versionNo, name, row.get("summary").toString(), digest);
          if (requestId != null) snapshot.put("requestId", requestId);
          // 이 순번 뒤에 입력이 고정된 분석부터 매일 돈다
          long seq =
              jdbc.queryForObject(
                  "select coalesce(max(input_seq),0) from analysis.runs", Long.class);
          switch (in.action()) {
            case "START_SHADOW" ->
                jdbc.update(
                    "update rules.rule_versions set status='SHADOW',eval_from_seq=coalesce(eval_from_seq,?),revision=revision+1 where version_id=?",
                    seq,
                    in.versionId());
            case "SUBMIT" ->
                jdbc.update(
                    "update rules.rule_versions set status='PENDING',submitted_at=?,revision=revision+1 where version_id=?",
                    at,
                    in.versionId());
            case "WITHDRAW", "REJECT" ->
                jdbc.update(
                    "update rules.rule_versions set status='DRAFT',eval_from_seq=null,submitted_at=null,revision=revision+1 where version_id=?",
                    in.versionId());
            case "APPROVE" -> {
              // 운영 버전은 룰마다 하나라서 기존 것을 먼저 물린다
              var retired =
                  jdbc.queryForList(
                      "update rules.rule_versions set status='RETIRED',eval_from_seq=null,revision=revision+1 where rule_id=? and status in ('ACTIVE','PAUSED') returning version_no",
                      Integer.class,
                      ruleId);
              if (!retired.isEmpty()) snapshot.put("retiredVersionNo", retired.getFirst());
              if (author) snapshot.put("selfApproved", true);
              jdbc.update(
                  "update rules.rule_versions set status='ACTIVE',eval_from_seq=coalesce(eval_from_seq,?),decided_at=?,decided_by=?,revision=revision+1 where version_id=?",
                  seq,
                  at,
                  user,
                  in.versionId());
            }
            case "PAUSE" ->
                jdbc.update(
                    "update rules.rule_versions set status='PAUSED',eval_from_seq=null,revision=revision+1 where version_id=?",
                    in.versionId());
            case "RESUME" ->
                jdbc.update(
                    "update rules.rule_versions set status='ACTIVE',eval_from_seq=?,revision=revision+1 where version_id=?",
                    seq,
                    in.versionId());
            default -> throw invalid("알 수 없는 명령입니다.");
          }
          long event =
              event(ruleId, in.versionId(), user, transition.event(), comment, snapshot, at);
          recipients(
              event, ruleId, in.versionId(), user, in.action(), row.get("status").toString());
        });
  }

  /**
   * 이 일을 알림으로 받을 사람을 지금의 관리자 · 담당자 · 작성자로 정해 적어 둔다(알림은 V3 의 rules.notifications 뷰가 읽는다). 승인 요청과 그
   * 철회는 관리자 전원, 승인 · 반려 · 중지 · 재개 · 시험 운영 시작은 룰 담당자와 그 버전 작성자다. 그 일을 한 본인은 뺀다.
   *
   * @param from 명령 전의 버전 상태. 시험 운영만 하다 거둔 것(SHADOW → DRAFT)은 승인 요청을 거둔 것이 아니라 알리지 않는다.
   */
  private void recipients(
      long event, long ruleId, long versionId, long actor, String action, String from) {
    switch (action) {
      case "SUBMIT" -> admins(event, actor);
      case "WITHDRAW" -> {
        if ("PENDING".equals(from)) admins(event, actor);
      }
      default ->
          jdbc.update(
              """
              insert into rules.event_recipients(event_id,user_id)
              select ?,who from (
                select owner_id as who from rules.rules where rule_id=?
                union select author_id from rules.rule_versions where version_id=?) people
              where who<>?
              """,
              event,
              ruleId,
              versionId,
              actor);
    }
  }

  private void admins(long event, long actor) {
    jdbc.update(
        "insert into rules.event_recipients(event_id,user_id) select ?,user_id from core.users where role='ADMIN' and user_id<>?",
        event,
        actor);
  }

  /** 룰 한 줄을 잠그고 이름을 돌려준다. 한 룰의 버전을 바꾸는 명령끼리 순서를 세운다. */
  private String lock(long ruleId) {
    var names =
        jdbc.queryForList(
            "select name from rules.rules where rule_id=? for update", String.class, ruleId);
    if (names.isEmpty()) throw ApiException.notFound("룰이 없습니다.");
    return names.getFirst();
  }

  /** 지금 조건(digest)으로 끝낸 백테스트가 있는가. */
  boolean backtested(long versionId, String digest) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from rules.backtests where version_id=? and definition_digest=? and status='COMPLETED')",
            Boolean.class,
            versionId,
            digest));
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
    event(rule, version, user, action, "", snapshot, at);
  }

  /** 변경 기록 한 줄. event_id 를 돌려준다. */
  private long event(
      long rule,
      Long version,
      long user,
      String action,
      String comment,
      Map<String, Object> snapshot,
      Timestamp at) {
    return jdbc.queryForObject(
        "insert into rules.events(rule_id,version_id,actor_id,action,comment,snapshot,business_at) values(?,?,?,?,?,?::jsonb,?) returning event_id",
        Long.class,
        rule,
        version,
        user,
        action,
        comment,
        ReviewJson.encode(snapshot),
        at);
  }
}
