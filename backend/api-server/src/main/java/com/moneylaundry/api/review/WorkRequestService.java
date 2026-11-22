package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보관함의 업무 요청. 분석가는 관리자에게 요청하고 관리자는 분석가에게 지시한다. 관리자가 보낸 지시와 관리자가 승인한 요청은 사건에 바로 적용된다(다시 열기, 담당 변경,
 * 처리 상태, 처리 기한).
 */
@Service
public class WorkRequestService {
  private static final int TEXT_LIMIT = 2000;
  private static final int RELATED_LIMIT = 50;

  /** 요청 유형: 보내는 역할, 사건에 적용되는 효과(없으면 의견 교환), 기한 입력 여부. */
  private record Type(String role, String effect, boolean deadline) {}

  private static final Map<String, Type> TYPES =
      Map.ofEntries(
          Map.entry("reopen", new Type("STAFF", "reopen", false)),
          Map.entry("changeAssignee", new Type("STAFF", "assign", false)),
          Map.entry("opinion", new Type("STAFF", null, false)),
          Map.entry("relationReview", new Type("STAFF", null, false)),
          Map.entry("evidenceRequest", new Type("STAFF", null, false)),
          Map.entry("extension", new Type("STAFF", "deadline", true)),
          Map.entry("assign", new Type("ADMIN", "assign", false)),
          Map.entry("reviewAgain", new Type("ADMIN", "reopen", false)),
          Map.entry("changeStatus", new Type("ADMIN", "status", false)),
          Map.entry("investigate", new Type("ADMIN", null, false)),
          Map.entry("evidence", new Type("ADMIN", null, false)),
          Map.entry("deadline", new Type("ADMIN", "deadline", true)));

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final ReviewService reviews;

  public WorkRequestService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, ReviewService reviews) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.reviews = reviews;
  }

  // ---- 조회 ----

  /** 내가 보냈거나 받았거나, 담당 변경으로 내 담당이 바뀐 요청과 요청 화면이 고를 직원 목록. */
  public Map<String, Object> list(long user) {
    reviews.actor(user);
    var names = new HashMap<Long, String>();
    for (var row : jdbc.queryForList("select user_id,username from core.users"))
      names.put(number(row.get("user_id")), row.get("username").toString());
    var requests = new ArrayList<Map<String, Object>>();
    for (var row :
        jdbc.queryForList(
            """
            select w.*,array_to_json(w.unread_user_ids)::text as unread_json,w.related::text as related_json,w.before::text as before_json,
              c.kind as case_kind,c.created_at as case_created_at
            from review.work_requests w join review.cases c on c.case_id=coalesce(w.alert_id,w.episode_id)
            where w.sender_id=? or w.recipient_id=? or w.new_assignee_id=?
              or (w.new_assignee_id is not null and (w.before->>'assigneeId')::bigint=?)
            order by w.updated_at desc,w.request_id desc
            """,
            user,
            user,
            user,
            user)) {
      var item = new LinkedHashMap<String, Object>();
      item.put("id", row.get("request_id"));
      item.put("type", row.get("type"));
      item.put("caseId", row.get("alert_id") == null ? row.get("episode_id") : row.get("alert_id"));
      item.put("caseKind", row.get("case_kind"));
      item.put("caseCreatedAt", instant(row.get("case_created_at")));
      item.put("sender", names.get(number(row.get("sender_id"))));
      item.put("recipient", names.get(number(row.get("recipient_id"))));
      item.put("related", row.get("related_json") == null ? null : rows(row.get("related_json")));
      item.put("reason", row.get("reason"));
      item.put("deadline", row.get("due_on") == null ? null : row.get("due_on").toString());
      item.put("sentAt", instant(row.get("sent_at")));
      item.put("at", instant(row.get("updated_at")));
      item.put("state", row.get("state"));
      var unread = new ArrayList<String>();
      for (long id : ids(row.get("unread_json"))) unread.add(names.get(id));
      item.put("unreadFor", unread);
      item.put("appliedAt", instant(row.get("applied_at")));
      item.put("reviewStatus", row.get("review_status"));
      item.put(
          "assignee",
          row.get("new_assignee_id") == null
              ? null
              : names.get(number(row.get("new_assignee_id"))));
      item.put("before", row.get("before_json") == null ? null : object(row.get("before_json")));
      item.put("note", row.get("note"));
      requests.add(item);
    }
    var people =
        jdbc.queryForList(
            "select username,name,role from core.users where role in ('STAFF','ADMIN') order by user_id");
    return Map.of(
        "admin",
        people.stream().filter(p -> "ADMIN".equals(p.get("role"))).findFirst().orElseThrow(),
        "staff",
        people.stream().filter(p -> "STAFF".equals(p.get("role"))).toList(),
        "requests",
        requests);
  }

  private static String instant(Object value) {
    return value == null ? null : ((Timestamp) value).toInstant().toString();
  }

  // ---- 보내기 ----

  public record Send(
      String type,
      Long caseId,
      String recipient,
      String reason,
      String deadline,
      String reviewStatus,
      List<Map<String, Object>> related) {}

  public Map<String, Object> send(long user, Send in) {
    var actor = reviews.actor(user);
    Type type = in == null ? null : TYPES.get(Objects.toString(in.type(), ""));
    if (type == null || in.caseId() == null) throw AnalysisService.invalid();
    if (!type.role().equals(actor.get("role"))) throw forbidden("이 요청을 보낼 수 있는 역할이 아닙니다.");
    boolean admin = "ADMIN".equals(actor.get("role"));
    boolean relation = "relationReview".equals(in.type());
    String reason = ReviewService.text(in.reason(), TEXT_LIMIT, true);
    LocalDate due = type.deadline() ? date(in.deadline()) : null;
    List<String> relatedCodes = relation ? relatedCodes(in.related()) : null;
    boolean setsStatus = admin && oneOf(type.effect(), "reopen", "status");
    if (setsStatus && !oneOf(in.reviewStatus(), "PENDING", "IN_PROGRESS"))
      throw ApiException.invalidTransition("변경할 처리 상태를 선택해 주세요.");
    return tx.execute(
        s -> {
          boolean episode = reviews.episode(in.caseId());
          var c = episode ? reviews.lockEpisode(in.caseId()) : reviews.lockAlert(in.caseId());
          long assignee = number(c.get("assignee_id"));
          boolean open = "OPEN".equals(c.get("status"));
          if (!relation) {
            if (!admin && assignee != user) throw forbidden("담당 직원만 요청할 수 있습니다.");
            if ("reopen".equals(type.effect()) ? !judged(c) : !open)
              throw ApiException.invalidTransition("대상 업무와 사유를 확인해 주세요.");
          }
          long recipient;
          if (!admin)
            recipient =
                jdbc.queryForObject(
                    "select min(user_id) from core.users where role='ADMIN'", Long.class);
          else {
            recipient = staff(in.recipient(), "받는 분석가를 선택해 주세요.");
            boolean assign = "assign".equals(type.effect());
            if (!assign && recipient != assignee)
              throw ApiException.invalidTransition("현재 담당자에게 보내 주세요.");
            if (assign && recipient == assignee)
              throw ApiException.invalidTransition("새 담당자를 선택해 주세요.");
          }
          for (var pending :
              jdbc.queryForList(
                  "select related::text as related from review.work_requests where state='pending' and type=? and sender_id=? and coalesce(alert_id,episode_id)=?",
                  in.type(),
                  user,
                  in.caseId()))
            if (!relation || relatedCodes.equals(codes(rows(pending.get("related")))))
              throw ApiException.invalidTransition("같은 유형의 요청이 이미 처리 대기 중입니다.");
          Timestamp at = Timestamp.from(time.now());
          String effect = admin ? type.effect() : null;
          Map<String, Object> before =
              effect == null
                  ? null
                  : apply(effect, episode, c, user, in.reviewStatus(), recipient, due, reason, at);
          var unread = new LinkedHashSet<Long>(List.of(recipient));
          if ("assign".equals(effect)) unread.add(assignee);
          long id =
              jdbc.queryForObject(
                  "insert into review.work_requests("
                      + (episode ? "episode_id" : "alert_id")
                      + ",type,sender_id,recipient_id,reason,due_on,related,review_status,new_assignee_id,before,applied_at,unread_user_ids,sent_at,updated_at)"
                      + " values(?,?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?,?,?) returning request_id",
                  Long.class,
                  in.caseId(),
                  in.type(),
                  user,
                  recipient,
                  reason,
                  due,
                  relation ? encode(in.related()) : null,
                  setsStatus ? in.reviewStatus() : null,
                  "assign".equals(effect) ? recipient : null,
                  before == null ? null : encode(before),
                  effect == null ? null : at,
                  unread.toArray(Long[]::new),
                  at,
                  at);
          return Map.of("id", id);
        });
  }

  // ---- 처리 ----

  public record Resolve(String action, String note, String assignee, String reviewStatus) {}

  /** 보낸 사람은 아직 적용되지 않은 요청을 취소하고, 받은 사람은 처리 내용을 적어 결과를 보낸다. */
  public Map<String, Object> resolve(long user, long id, Resolve in) {
    var actor = reviews.actor(user);
    if (in == null) throw AnalysisService.invalid();
    boolean admin = "ADMIN".equals(actor.get("role"));
    return tx.execute(
        s -> {
          var found =
              jdbc.queryForList(
                  "select *,array_to_json(unread_user_ids)::text as unread_json from review.work_requests where request_id=? for update",
                  id);
          if (found.isEmpty()) throw ApiException.notFound("요청이 없습니다.");
          var item = found.getFirst();
          boolean pending = "pending".equals(item.get("state"));
          boolean cancel =
              "cancelled".equals(in.action())
                  && number(item.get("sender_id")) == user
                  && item.get("applied_at") == null;
          String note = in.note() == null ? "" : in.note().strip();
          if (!pending
              || (!cancel
                  && (number(item.get("recipient_id")) != user
                      || note.isEmpty()
                      || note.length() > TEXT_LIMIT)))
            throw ApiException.invalidTransition("처리 대기 중인 받은 요청과 처리 내용을 확인해 주세요.");
          if (!cancel
              && !(admin
                      ? List.of("approved", "declined")
                      : List.of("completed", "needs-discussion"))
                  .contains(Objects.toString(in.action(), "")))
            throw ApiException.invalidTransition("처리 방법을 확인해 주세요.");
          String effect =
              admin && "approved".equals(in.action())
                  ? TYPES.get(item.get("type").toString()).effect()
                  : null;
          Timestamp at = Timestamp.from(time.now());
          var unread = new LinkedHashSet<Long>();
          for (long unreadId : ids(item.get("unread_json")))
            if (unreadId != user) unread.add(unreadId);
          unread.add(number(item.get(cancel ? "recipient_id" : "sender_id")));
          Map<String, Object> before = null;
          String reviewStatus = null;
          Long newAssignee = null;
          if (effect != null) {
            boolean episode = item.get("episode_id") != null;
            long caseId = number(item.get(episode ? "episode_id" : "alert_id"));
            var c = episode ? reviews.lockEpisode(caseId) : reviews.lockAlert(caseId);
            if ("reopen".equals(effect)) {
              reviewStatus = in.reviewStatus() == null ? "IN_PROGRESS" : in.reviewStatus();
              if (!oneOf(reviewStatus, "PENDING", "IN_PROGRESS"))
                throw ApiException.invalidTransition("변경할 처리 상태를 선택해 주세요.");
            }
            if ("assign".equals(effect)) {
              newAssignee = staff(in.assignee(), "진행 중인 업무와 새 담당자를 확인해 주세요.");
              unread.add(number(c.get("assignee_id")));
              unread.add(newAssignee);
            }
            java.sql.Date due = (java.sql.Date) item.get("due_on");
            before =
                apply(
                    effect,
                    episode,
                    c,
                    user,
                    reviewStatus,
                    newAssignee,
                    due == null ? null : due.toLocalDate(),
                    note,
                    at);
          }
          jdbc.update(
              "update review.work_requests set state=?,note=?,updated_at=?,unread_user_ids=?,"
                  + "applied_at=coalesce(?,applied_at),before=coalesce(?::jsonb,before),"
                  + "review_status=coalesce(?,review_status),new_assignee_id=coalesce(?,new_assignee_id) where request_id=?",
              in.action(),
              cancel ? "" : note,
              at,
              unread.toArray(Long[]::new),
              effect == null ? null : at,
              before == null ? null : encode(before),
              reviewStatus,
              newAssignee,
              id);
          return Map.of("id", id);
        });
  }

  public record Read(List<Long> ids) {}

  public Map<String, Object> read(long user, Read in) {
    reviews.actor(user);
    if (in == null || in.ids() == null || in.ids().stream().anyMatch(Objects::isNull))
      throw AnalysisService.invalid();
    jdbc.update(
        "update review.work_requests set unread_user_ids=array_remove(unread_user_ids,?) where request_id=any(?::bigint[]) and ?=any(unread_user_ids)",
        user,
        in.ids().toArray(Long[]::new),
        user);
    return Map.of("ids", in.ids());
  }

  // ---- 사건에 적용 ----

  /** 잠근 사건에 효과를 적용하고 적용 전 상태를 돌려준다. 사건 상태가 그 사이 바뀌었으면 거절한다. */
  private Map<String, Object> apply(
      String effect,
      boolean episode,
      Map<String, Object> c,
      long actor,
      String reviewStatus,
      Long newAssignee,
      LocalDate due,
      String comment,
      Timestamp at) {
    long id = number(c.get(episode ? "episode_id" : "alert_id"));
    long assignee = number(c.get("assignee_id"));
    boolean open = "OPEN".equals(c.get("status"));
    // Episode는 직원이 Alert를 묶어 만든 사건이라 열려 있는 동안 항상 처리 중이다.
    String current =
        !open
            ? "CLOSED"
            : episode || c.get("review_started_at") != null ? "IN_PROGRESS" : "PENDING";
    String key = episode ? "episode_id" : "alert_id";
    String table = episode ? "review.episodes" : "review.alerts";
    var judged =
        jdbc.queryForList(
            "select j.*,u.name as reviewer from review.judgments j join core.users u on u.user_id=j.reviewer_id where j."
                + key
                + "=? and j.superseded_at is null",
            id);
    var before = new LinkedHashMap<String, Object>();
    before.put("outcome", c.get("outcome"));
    before.put("reviewStatus", current);
    before.put("assigneeId", assignee);
    before.put(
        "assignee",
        jdbc.queryForObject(
            "select username from core.users where user_id=?", String.class, assignee));
    before.put("judgment", judged.isEmpty() ? null : ReviewService.judgment(judged.getFirst()));
    before.put("completedAt", instant(c.get("closed_at")));
    var snapshot = new LinkedHashMap<String, Object>();
    switch (effect) {
      case "reopen" -> {
        if (!judged(c)) throw ApiException.invalidTransition("업무 상태가 바뀌었습니다. 최신 판정 상태를 확인해 주세요.");
        if (episode && !"IN_PROGRESS".equals(reviewStatus))
          throw ApiException.invalidTransition("Episode는 처리 중으로만 다시 열 수 있습니다.");
        // 닫힌 뒤 새 분석이 후속 Alert를 만들었으면 조사는 후속 Alert에서 이어진다.
        if (!episode
            && jdbc.queryForObject(
                "select exists(select 1 from review.alert_lineage where target_alert_id=? and kind='FOLLOWUP_OF')",
                Boolean.class,
                id))
          throw ApiException.invalidTransition(
              "후속 Alert가 이미 만들어져 다시 열 수 없습니다. 후속 Alert에서 조사해 주세요.");
        jdbc.update(
            "update review.judgments set superseded_at=? where "
                + key
                + "=? and superseded_at is null",
            at,
            id);
        jdbc.update(
            "update "
                + table
                + " set status='OPEN',outcome=null,closed_at=null,closed_by=null where "
                + key
                + "=?",
            id);
        if (!episode) started(id, "IN_PROGRESS".equals(reviewStatus), assignee, at);
        snapshot.put("reviewStatus", reviewStatus);
      }
      case "status" -> {
        if (episode) throw ApiException.invalidTransition("Episode는 처리 상태를 바꿀 수 없습니다.");
        if (!open || current.equals(reviewStatus))
          throw ApiException.invalidTransition("변경할 처리 상태를 선택해 주세요.");
        started(id, "IN_PROGRESS".equals(reviewStatus), assignee, at);
        snapshot.put("reviewStatus", reviewStatus);
      }
      case "assign" -> {
        if (!open || newAssignee == null || newAssignee == assignee)
          throw ApiException.invalidTransition("진행 중인 업무와 새 담당자를 확인해 주세요.");
        jdbc.update(
            "update " + table + " set assignee_id=?,assigned_at=? where " + key + "=?",
            newAssignee,
            at,
            id);
        // 새 담당자는 아직 열어 보지 않았다.
        if (!episode) jdbc.update("update review.alerts set read_at=null where alert_id=?", id);
        snapshot.put("assigneeId", newAssignee);
      }
      case "deadline" -> {
        if (!open) throw ApiException.invalidTransition("진행 중인 업무만 기한을 변경할 수 있습니다.");
        jdbc.update("update " + table + " set due_on=? where " + key + "=?", due, id);
        snapshot.put("dueOn", due.toString());
      }
      default -> throw new IllegalStateException(effect);
    }
    reviews.event(
        episode,
        id,
        actor,
        Map.of("reopen", "REOPEN", "status", "STATUS", "assign", "ASSIGN", "deadline", "DEADLINE")
            .get(effect),
        comment,
        snapshot);
    reviews.touch(episode, id);
    return before;
  }

  private void started(long alert, boolean inProgress, long assignee, Timestamp at) {
    jdbc.update(
        "update review.alerts set review_started_at=?,review_started_by=? where alert_id=?",
        inProgress ? at : null,
        inProgress ? assignee : null,
        alert);
  }

  /** 판정으로 닫힌 사건만 다시 열 수 있다. Episode로 옮겨진 Alert나 해체된 Episode는 아니다. */
  private static boolean judged(Map<String, Object> c) {
    return "CLOSED".equals(c.get("status")) && oneOf(c.get("outcome"), "NORMAL", "SUSPICIOUS");
  }

  private long staff(String username, String message) {
    var ids =
        jdbc.queryForList(
            "select user_id from core.users where username=? and role='STAFF'",
            Long.class,
            username);
    if (ids.isEmpty()) throw ApiException.invalidTransition(message);
    return ids.getFirst();
  }

  private static LocalDate date(String value) {
    try {
      return LocalDate.parse(value);
    } catch (RuntimeException e) {
      throw ApiException.invalidTransition("처리 기한을 선택해 주세요.");
    }
  }

  private static List<String> relatedCodes(List<Map<String, Object>> related) {
    if (related == null || related.isEmpty() || related.size() > RELATED_LIMIT)
      throw ApiException.invalidTransition("비교 후보를 선택해 주세요.");
    var codes = codes(related);
    if (codes.stream().anyMatch(String::isBlank) || new HashSet<>(codes).size() != codes.size())
      throw ApiException.invalidTransition("비교 후보를 선택해 주세요.");
    return codes;
  }

  private static List<String> codes(List<Map<String, Object>> related) {
    return related.stream()
        .map(r -> Objects.toString(r == null ? null : r.get("code"), ""))
        .toList();
  }

  private static List<Long> ids(Object json) {
    return ((List<?>) JSON.readValue(json.toString(), List.class))
        .stream().map(ReviewJson::number).toList();
  }

  /** List.of(...).contains(null)은 예외를 내므로 값이 비어 있을 수 있는 비교는 여기로 모은다. */
  private static boolean oneOf(Object value, String... options) {
    return Arrays.asList(options).contains(value);
  }

  private static ApiException forbidden(String detail) {
    return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", detail);
  }
}
