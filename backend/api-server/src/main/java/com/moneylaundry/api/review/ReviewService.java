package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 새 화면의 Alert·Episode 조회와 조사 동작(열람, 처리 시작, 판정, 거래 제외·이동, Episode 묶기·편입·연결 해제). */
@Service
public class ReviewService {
  private static final Set<String> REASON_CATEGORIES =
      Set.of("pattern", "rule", "normal-business", "etc");
  private static final int JUDGMENT_TEXT_LIMIT = 2000;
  private static final int EDIT_REASON_LIMIT = 2000;
  private static final int EPISODE_REASON_LIMIT = 4000;

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final org.springframework.context.ApplicationEventPublisher events;

  /** 판정이 저장되어 커밋된 뒤 알리는 이벤트. AI 분석 보고서가 '의심' 판정을 받아 뒤에서 보고서를 만든다. */
  public record JudgmentRecorded(long judgmentId, String verdict, long reviewerId) {}

  public ReviewService(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      BusinessTime time,
      org.springframework.context.ApplicationEventPublisher events) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.events = events;
  }

  public long userId(java.security.Principal principal) {
    if (principal == null)
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
    var ids =
        jdbc.queryForList(
            "select user_id from core.users where username=? and role in ('STAFF','ADMIN')",
            Long.class,
            principal.getName());
    if (ids.isEmpty())
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "로그인이 필요합니다.");
    return ids.getFirst();
  }

  public Map<String, Object> actor(long id) {
    time.workbenchOnly();
    var users =
        jdbc.queryForList(
            "select user_id as id,name,role from core.users where user_id=? and role in ('STAFF','ADMIN')",
            id);
    if (users.isEmpty())
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "시연 직원을 선택하세요.");
    return users.getFirst();
  }

  public List<Map<String, Object>> users() {
    time.workbenchOnly();
    return jdbc.queryForList(
        "select user_id as id,name,role from core.users where role in ('STAFF','ADMIN') order by user_id");
  }

  // ---- 조회 ----

  /** 화면이 한 번에 읽는 사건 전체: 사건, 현재 거래, 판정, 거래 편집 이력, Episode 연결. */
  public Map<String, Object> board() {
    time.workbenchOnly();
    Instant now = time.now();
    var members = new HashMap<Long, List<Map<String, Object>>>();
    var txIds = new TreeSet<Long>();
    for (var m :
        jdbc.queryForList(
            """
            select case_id as "caseId",tx_id as "txId",review_role as "reviewRole",state,decision
            from review.current_members where state in ('PENDING','DECIDED') order by case_id,tx_id
            """)) {
      members.computeIfAbsent(number(m.remove("caseId")), key -> new ArrayList<>()).add(m);
      txIds.add(number(m.get("txId")));
    }
    var linked = new HashMap<Long, List<Long>>();
    for (var row :
        jdbc.queryForList(
            "select episode_id,alert_id from review.episode_alerts order by alert_id"))
      linked
          .computeIfAbsent(number(row.get("episode_id")), key -> new ArrayList<>())
          .add(number(row.get("alert_id")));
    var judged = judgments();
    var edits = edits();
    // 빠진 거래도 편집 이력에 코드로 보여야 하므로 거래 정보에 포함한다.
    for (var list : edits.values())
      for (var edit : list) for (Object tx : (List<?>) edit.get("txIds")) txIds.add(number(tx));
    var cases = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            "select "
                + ReviewCaseSql.LIST_COLUMNS
                + ",c.read_at,(c.summary->>'typeShare')::double precision as type_share,u.name as assignee_name,u.username as assignee_username,c.due_on,(select ea.episode_id from review.episode_alerts ea where ea.alert_id=c.alert_id) as linked_episode_id from "
                + ReviewCaseSql.PUBLISHED
                + " c join core.users u on u.user_id=c.assignee_id order by c.created_at desc,case_id desc")) {
      long id = number(row.get("case_id"));
      boolean alert = "ALERT".equals(row.get("kind"));
      var item = new LinkedHashMap<String, Object>();
      item.put("caseId", id);
      item.put("kind", row.get("kind"));
      item.put("status", row.get("status"));
      item.put("outcome", row.get("outcome"));
      item.put("assigneeId", row.get("assignee_id"));
      item.put("assigneeName", row.get("assignee_name"));
      item.put("assigneeUsername", row.get("assignee_username"));
      item.put("dueOn", row.get("due_on") == null ? null : row.get("due_on").toString());
      item.put("createdAt", instant(row.get("created_at")));
      item.put("assignedAt", instant(row.get("assigned_at")));
      item.put("closedAt", instant(row.get("closed_at")));
      item.put(
          "ageDays",
          Math.max(
              0, Duration.between(((Timestamp) row.get("created_at")).toInstant(), now).toDays()));
      if (alert) {
        item.put("readAt", instant(row.get("read_at")));
        item.put("reviewStartedAt", instant(row.get("review_started_at")));
        item.put("episodeId", row.get("linked_episode_id"));
      } else item.put("linkedAlertIds", linked.getOrDefault(id, List.of()));
      var summary = object(row.get("summary"));
      for (String key : List.of("pendingCount", "sourceAlertIds", "primaryTypes"))
        item.put(key, summary.remove(key));
      summary.put("typeShare", row.get("type_share"));
      item.put("summary", summary);
      item.put("members", members.getOrDefault(id, List.of()));
      item.put("judgment", judged.get(id));
      item.put("edits", edits.getOrDefault(id, List.of()));
      cases.add(item);
    }
    var transactions =
        txIds.isEmpty()
            ? List.<Map<String, Object>>of()
            : jdbc.queryForList(BOARD_TRANSACTIONS, (Object) txIds.toArray(Long[]::new));
    for (var t : transactions) t.put("occurredAt", instant(t.get("occurredAt")));
    // 화면이 새 Episode의 ID를 만들기 전에 보여 주므로 번호를 미리 하나 잡아 준다.
    long nextEpisodeId = jdbc.queryForObject("select nextval('review.case_id')", Long.class);
    return Map.of(
        "businessAt",
        now.toString(),
        "cases",
        cases,
        "transactions",
        transactions,
        "nextEpisodeId",
        nextEpisodeId);
  }

  private static final String BOARD_TRANSACTIONS =
      """
      select t.tx_id as "txId",t.occurred_at as "occurredAt",
        f.service_account_id::text as "fromAccountId",r.service_account_id::text as "toAccountId",
        fe.display_name as "fromOwnerName",re.display_name as "toOwnerName",
        t.amount_paid as "amountPaid",t.payment_currency as "paymentCurrency",
        t.payment_format as "paymentFormat",s.p_laundering as "launderingScore",
        coalesce(s.p_laundering>=j.threshold_value,false) as "suspicious"
      from ledger.transactions t
      join core.accounts f on f.account_id=t.from_account_id
      join core.accounts r on r.account_id=t.to_account_id
      join core.owners fe on fe.owner_id=f.owner_id
      join core.owners re on re.owner_id=r.owner_id
      left join analysis.current_scores cs on cs.tx_id=t.tx_id
      left join analysis.scores s on s.run_id=cs.run_id and s.tx_id=cs.tx_id
      left join analysis.runs ar on ar.run_id=s.run_id
      left join analysis.jobs j on j.job_id=ar.job_id
      where t.tx_id=any(?::bigint[]) order by t.tx_id
      """;

  private static String instant(Object value) {
    return value == null ? null : ((Timestamp) value).toInstant().toString();
  }

  /** 사건별 판정 기록. 판정 ID는 J-{업무일 yyMMdd}-{판정 번호 6자리}. */
  private Map<Long, Map<String, Object>> judgments() {
    var out = new HashMap<Long, Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            "select j.*,u.name as reviewer from review.judgments j join core.users u on u.user_id=j.reviewer_id where j.superseded_at is null"))
      out.put(
          number(row.get("alert_id") == null ? row.get("episode_id") : row.get("alert_id")),
          judgment(row));
    return out;
  }

  static Map<String, Object> judgment(Map<String, Object> row) {
    Instant at = ((Timestamp) row.get("judged_at")).toInstant();
    var out = new LinkedHashMap<String, Object>();
    out.put(
        "id",
        "J-"
            + java.time.format.DateTimeFormatter.ofPattern("yyMMdd")
                .format(at.atZone(BusinessTime.KST))
            + "-"
            + String.format("%06d", number(row.get("judgment_id"))));
    out.put("verdict", row.get("verdict"));
    out.put("reasonCategory", row.get("reason_category"));
    out.put("evidence", row.get("evidence"));
    out.put("observations", row.get("observations"));
    out.put("reason", row.get("rationale"));
    out.put("at", at.toString());
    out.put("reviewer", row.get("reviewer"));
    return out;
  }

  /** Alert별 거래 편집 이력. 거래를 내보낸 Alert와 받은 Alert 양쪽에 같은 기록이 보인다. */
  private Map<Long, List<Map<String, Object>>> edits() {
    var out = new HashMap<Long, List<Map<String, Object>>>();
    for (var row :
        jdbc.queryForList(
            "select e.alert_id,e.action,e.comment,e.business_at,e.snapshot::text as snapshot,u.name as editor from review.events e join core.users u on u.user_id=e.actor_id where e.action in ('EXCLUDE','MOVE') order by e.event_id")) {
      var detail = object(row.get("snapshot"));
      var edit = new LinkedHashMap<String, Object>();
      edit.put("action", row.get("action"));
      edit.put("sourceAlertId", row.get("alert_id"));
      edit.put("targetAlertId", detail.get("targetAlertId"));
      edit.put("txIds", detail.get("txIds"));
      edit.put("reason", row.get("comment"));
      edit.put("editor", row.get("editor"));
      edit.put("at", instant(row.get("business_at")));
      out.computeIfAbsent(number(row.get("alert_id")), key -> new ArrayList<>()).add(edit);
      if (detail.get("targetAlertId") != null)
        out.computeIfAbsent(number(detail.get("targetAlertId")), key -> new ArrayList<>())
            .add(edit);
    }
    return out;
  }

  // ---- 공통 확인 ----

  Map<String, Object> lockAlert(long id) {
    var found = jdbc.queryForList("select * from review.alerts where alert_id=? for update", id);
    if (found.isEmpty() || found.getFirst().get("published_version") == null)
      throw ApiException.notFound("Alert가 없습니다.");
    var alert = found.getFirst();
    if (alert.get("merged_into_alert_id") != null)
      throw ApiException.invalidTransition(
          "병합된 Alert입니다. 현재 Alert " + alert.get("merged_into_alert_id") + "를 조회하세요.");
    return alert;
  }

  Map<String, Object> lockEpisode(long id) {
    var found =
        jdbc.queryForList("select * from review.episodes where episode_id=? for update", id);
    if (found.isEmpty()) throw ApiException.notFound("Episode가 없습니다.");
    return found.getFirst();
  }

  boolean episode(long id) {
    return jdbc.queryForObject(
        "select exists(select 1 from review.episodes where episode_id=?)", Boolean.class, id);
  }

  private static void open(Map<String, Object> c) {
    if (!"OPEN".equals(c.get("status")))
      throw ApiException.invalidTransition("처리 완료된 사건은 변경할 수 없습니다.");
  }

  private static void assigned(Map<String, Object> c, long user) {
    if (number(c.get("assignee_id")) != user)
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "담당 직원만 변경할 수 있습니다.");
  }

  static String text(String value, int limit, boolean required) {
    String out = value == null ? "" : value.strip();
    if ((required && out.isEmpty()) || out.length() > limit) throw AnalysisService.invalid();
    return out;
  }

  void event(boolean episode, long id, long user, String action, String comment, Object snapshot) {
    Timestamp at = Timestamp.from(time.now());
    jdbc.update(
        "insert into review.events("
            + (episode ? "episode_id" : "alert_id")
            + ",actor_id,action,comment,business_at,recorded_at,snapshot) values(?,?,?,?,?,?,?::jsonb)",
        id,
        user,
        action,
        comment,
        at,
        at,
        encode(snapshot));
  }

  void touch(boolean episode, long id) {
    jdbc.update(
        "update review."
            + (episode
                ? "episodes set revision=revision+1 where episode_id=?"
                : "alerts set revision=revision+1 where alert_id=?"),
        id);
    new CaseSummaryStore(jdbc).refresh(id);
  }

  // ---- 조사 동작 ----

  /** 담당자가 Alert 상세를 처음 연 시각을 남긴다. 담당자가 아니면 아무것도 바꾸지 않는다. */
  public Map<String, Object> read(long id, long user) {
    actor(user);
    return tx.execute(
        s -> {
          var alert = lockAlert(id);
          if (alert.get("read_at") == null && number(alert.get("assignee_id")) == user)
            jdbc.update(
                "update review.alerts set read_at=? where alert_id=?",
                Timestamp.from(time.now()),
                id);
          return Map.of("caseId", id);
        });
  }

  /** 처리 전 Alert를 처리 중으로 바꾼다. */
  public Map<String, Object> start(long id, long user) {
    actor(user);
    return tx.execute(
        s -> {
          var alert = lockAlert(id);
          open(alert);
          assigned(alert, user);
          if (alert.get("review_started_at") == null) {
            Timestamp at = Timestamp.from(time.now());
            jdbc.update(
                "update review.alerts set review_started_at=?,review_started_by=?,read_at=coalesce(read_at,?) where alert_id=?",
                at,
                user,
                at,
                id);
            event(false, id, user, "REVIEW_START", "조사 착수", Map.of());
            touch(false, id);
          }
          return Map.of("caseId", id);
        });
  }

  public record Judgment(
      String verdict,
      String reasonCategory,
      String evidence,
      String observations,
      String rationale) {}

  /** 사건 하나에 판정을 한 번 남기고 처리 완료로 닫는다. */
  public Map<String, Object> judge(long id, long user, Judgment in) {
    actor(user);
    if (in == null
        || !Set.of("NORMAL", "SUSPICIOUS").contains(Objects.toString(in.verdict(), ""))
        || !REASON_CATEGORIES.contains(Objects.toString(in.reasonCategory(), "")))
      throw AnalysisService.invalid();
    String evidence = text(in.evidence(), JUDGMENT_TEXT_LIMIT, false);
    String observations = text(in.observations(), JUDGMENT_TEXT_LIMIT, false);
    String rationale = text(in.rationale(), JUDGMENT_TEXT_LIMIT, true);
    return tx.execute(
        s -> {
          boolean episode = episode(id);
          var c = episode ? lockEpisode(id) : lockAlert(id);
          open(c);
          assigned(c, user);
          if (!episode && c.get("review_started_at") == null)
            throw ApiException.invalidTransition("처리 중 상태로 바꾼 뒤 판정할 수 있습니다.");
          Timestamp at = Timestamp.from(time.now());
          long judgment =
              jdbc.queryForObject(
                  "insert into review.judgments("
                      + (episode ? "episode_id" : "alert_id")
                      + ",verdict,reason_category,evidence,observations,rationale,reviewer_id,judged_at) values(?,?,?,?,?,?,?,?) returning judgment_id",
                  Long.class,
                  id,
                  in.verdict(),
                  in.reasonCategory(),
                  evidence,
                  observations,
                  rationale,
                  user,
                  at);
          jdbc.update(
              "update review."
                  + (episode ? "episodes" : "alerts")
                  + " set status='CLOSED',outcome=?,closed_at=?,closed_by=? where "
                  + (episode ? "episode_id" : "alert_id")
                  + "=?",
              in.verdict(),
              at,
              user,
              id);
          event(
              episode,
              id,
              user,
              "CLOSE",
              rationale,
              Map.of("judgmentId", judgment, "verdict", in.verdict()));
          touch(episode, id);
          // 커밋된 뒤에만 듣는 쪽(@TransactionalEventListener AFTER_COMMIT)이 받는다
          events.publishEvent(new JudgmentRecorded(judgment, in.verdict(), user));
          return judgment(
              jdbc.queryForMap(
                  "select j.*,u.name as reviewer from review.judgments j join core.users u on u.user_id=j.reviewer_id where j.judgment_id=?",
                  judgment));
        });
  }

  public record TransactionEdit(List<Long> txIds, Long targetAlertId, String reason) {}

  /** 열린 Alert에서 거래를 제외하거나 다른 열린 Alert로 옮긴다. 직원은 자기 Alert만, 관리자는 모든 열린 Alert를 고친다. */
  public Map<String, Object> editTransactions(long id, long user, TransactionEdit in) {
    boolean admin = "ADMIN".equals(actor(user).get("role"));
    if (in == null
        || in.txIds() == null
        || in.txIds().isEmpty()
        || in.txIds().stream().anyMatch(java.util.Objects::isNull)
        || new HashSet<>(in.txIds()).size() != in.txIds().size()
        || Objects.equals(in.targetAlertId(), id)) throw AnalysisService.invalid();
    String reason = text(in.reason(), EDIT_REASON_LIMIT, true);
    return tx.execute(
        s -> {
          // 두 Alert를 번호 순서로 잠가 서로 기다리는 일이 없게 한다.
          var locked = new TreeMap<Long, Map<String, Object>>();
          for (long alert :
              new TreeSet<>(
                  Arrays.asList(id, in.targetAlertId() == null ? id : in.targetAlertId()))) {
            var row = lockAlert(alert);
            open(row);
            if (!admin) assigned(row, user);
            if (jdbc.queryForObject(
                "select exists(select 1 from review.episode_alerts where alert_id=?)",
                Boolean.class,
                alert)) throw ApiException.invalidTransition("Episode에 묶인 Alert는 변경할 수 없습니다.");
            locked.put(alert, row);
          }
          // 현재 이 Alert에 남아 있는 거래와 그 거래의 원래 Alert.
          var origins = new HashMap<Long, Long>();
          for (var row :
              jdbc.queryForList(
                  "select tx_id,alert_id from review.current_members where case_id=? and state='PENDING'",
                  id)) origins.put(number(row.get("tx_id")), number(row.get("alert_id")));
          if (!origins.keySet().containsAll(in.txIds()))
            throw ApiException.invalidTransition("선택한 거래가 이 Alert의 현재 구성에 없습니다. 다시 조회해 주세요.");
          Timestamp at = Timestamp.from(time.now());
          for (long txId : in.txIds()) {
            long origin = origins.get(txId);
            if (Objects.equals(in.targetAlertId(), origin))
              // 원래 Alert로 되돌리면 편집 기록이 필요 없다.
              jdbc.update(
                  "delete from review.alert_tx_edits where alert_id=? and tx_id=?", origin, txId);
            else
              jdbc.update(
                  """
                  insert into review.alert_tx_edits(alert_id,tx_id,target_alert_id,reason,editor_id,edited_at)
                  values(?,?,?,?,?,?) on conflict(alert_id,tx_id) do update set
                    target_alert_id=excluded.target_alert_id,reason=excluded.reason,
                    editor_id=excluded.editor_id,edited_at=excluded.edited_at
                  """,
                  origin,
                  txId,
                  in.targetAlertId(),
                  reason,
                  user,
                  at);
          }
          var snapshot = new LinkedHashMap<String, Object>();
          snapshot.put("txIds", in.txIds());
          snapshot.put("targetAlertId", in.targetAlertId());
          event(false, id, user, in.targetAlertId() == null ? "EXCLUDE" : "MOVE", reason, snapshot);
          for (long alert : locked.keySet()) touch(false, alert);
          return Map.of("caseId", id, "txIds", in.txIds());
        });
  }

  /** episodeId는 새 Episode를 만들 때만 쓴다. 목록 조회가 미리 잡아 준 번호다. */
  public record EpisodeChange(List<Long> alertIds, String reason, Long episodeId) {}

  private List<Long> alertIds(EpisodeChange in) {
    if (in == null
        || in.alertIds() == null
        || in.alertIds().isEmpty()
        || in.alertIds().stream().anyMatch(java.util.Objects::isNull)
        || new HashSet<>(in.alertIds()).size() != in.alertIds().size())
      throw AnalysisService.invalid();
    return new ArrayList<>(new TreeSet<>(in.alertIds()));
  }

  /** 내 담당의 열린 미판정 Alert를 Episode에 넣는다. episodeId가 없으면 새 Episode를 만든다(2건 이상). */
  public Map<String, Object> linkAlerts(Long episodeId, long user, EpisodeChange in) {
    actor(user);
    var alertIds = alertIds(in);
    String reason = text(in.reason(), EPISODE_REASON_LIMIT, true);
    if (episodeId == null && alertIds.size() < 2)
      throw ApiException.invalidTransition("새 Episode는 Alert가 2건 이상 필요합니다.");
    return tx.execute(
        s -> {
          Timestamp at = Timestamp.from(time.now());
          long episode;
          if (episodeId == null) {
            if (in.episodeId() == null)
              episode =
                  jdbc.queryForObject(
                      "insert into review.episodes(assignee_id,created_at,assigned_at) values(?,?,?) returning episode_id",
                      Long.class,
                      user,
                      at,
                      at);
            else {
              // 미리 잡아 둔 번호만 받는다. 이미 쓰였거나 발급된 적 없는 번호는 거절한다.
              if (!jdbc.queryForObject(
                  "select ?<=(select last_value from review.case_id) and not exists(select 1 from review.cases where case_id=?)",
                  Boolean.class,
                  in.episodeId(),
                  in.episodeId()))
                throw ApiException.invalidTransition("생성 예정 ID가 바뀌었습니다. 내용을 다시 확인해 주세요.");
              jdbc.update(
                  "insert into review.episodes(episode_id,assignee_id,created_at,assigned_at) values(?,?,?,?)",
                  in.episodeId(),
                  user,
                  at,
                  at);
              episode = in.episodeId();
            }
          } else {
            open(lockEpisode(episodeId));
            episode = episodeId;
          }
          for (long alertId : alertIds) {
            var alert = lockAlert(alertId);
            if (!"OPEN".equals(alert.get("status")) || number(alert.get("assignee_id")) != user)
              throw ApiException.invalidTransition("내 담당 진행 중 Alert를 다시 선택해 주세요.");
            jdbc.update(
                "insert into review.episode_alerts(alert_id,episode_id,alert_version) values(?,?,?)",
                alertId,
                episode,
                alert.get("published_version"));
            jdbc.update(
                "update review.alerts set status='CLOSED',outcome='TRANSFERRED',closed_at=?,closed_by=? where alert_id=?",
                at,
                user,
                alertId);
            event(false, alertId, user, "TRANSFER", reason, Map.of("episodeId", episode));
            touch(false, alertId);
          }
          event(true, episode, user, "TRANSFER", reason, Map.of("alertIds", alertIds));
          touch(true, episode);
          return Map.of("episodeId", episode, "alertIds", alertIds);
        });
  }

  /** Episode 담당자가 Alert 연결을 푼다. 남는 Alert가 2건보다 적으면 Episode를 해체하고 모두 되돌린다. */
  public Map<String, Object> unlinkAlerts(long episodeId, long user, EpisodeChange in) {
    actor(user);
    var alertIds = alertIds(in);
    String reason = text(in.reason(), EPISODE_REASON_LIMIT, true);
    return tx.execute(
        s -> {
          var episode = lockEpisode(episodeId);
          open(episode);
          assigned(episode, user);
          var linked =
              jdbc.queryForList(
                  "select alert_id from review.episode_alerts where episode_id=? order by alert_id",
                  Long.class,
                  episodeId);
          if (!linked.containsAll(alertIds))
            throw ApiException.invalidTransition("연결된 Alert를 다시 선택해 주세요.");
          boolean dissolve = linked.size() - alertIds.size() < 2;
          var released = dissolve ? linked : alertIds;
          Timestamp at = Timestamp.from(time.now());
          for (long alertId : released) {
            jdbc.queryForList("select 1 from review.alerts where alert_id=? for update", alertId);
            jdbc.update("delete from review.episode_alerts where alert_id=?", alertId);
            jdbc.update(
                "update review.alerts set status='OPEN',outcome=null,closed_at=null,closed_by=null where alert_id=?",
                alertId);
            event(false, alertId, user, "UNLINK", reason, Map.of("episodeId", episodeId));
            touch(false, alertId);
          }
          if (dissolve)
            jdbc.update(
                "update review.episodes set status='CLOSED',outcome='DISSOLVED',closed_at=?,closed_by=? where episode_id=?",
                at,
                user,
                episodeId);
          event(
              true,
              episodeId,
              user,
              dissolve ? "DISSOLVE" : "UNLINK",
              reason,
              Map.of("alertIds", released));
          touch(true, episodeId);
          return Map.of("episodeId", episodeId, "alertIds", released, "dissolved", dissolve);
        });
  }
}
