package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReviewService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final BusinessTime time;
  private final AlertQueryService alerts;

  public ReviewService(
      JdbcTemplate jdbc, TransactionTemplate tx, BusinessTime time, AlertQueryService alerts) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.time = time;
    this.alerts = alerts;
  }

  public Map<String, Object> actor(long id) {
    time.localOnly();
    var users =
        jdbc.queryForList(
            "select user_id as id,name,role from users where user_id=? and role in ('L1','L2')",
            id);
    if (users.isEmpty())
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "시연 직원을 선택하세요.");
    return users.getFirst();
  }

  public List<Map<String, Object>> users() {
    time.localOnly();
    return jdbc.queryForList(
        "select user_id as id,name,role from users where role in ('L1','L2') order by user_id");
  }

  private Map<String, Object> caseRow(long id) {
    var found =
        jdbc.queryForList(
            "select c.*,u.name as assignee_name from review_cases c join users u on u.user_id=c.assignee_id where c.case_id=?",
            id);
    if (found.isEmpty()) throw ApiException.notFound("사건이 없습니다.");
    return found.getFirst();
  }

  private void editable(Map<String, Object> c, long user) {
    var who = actor(user);
    if (number(c.get("assignee_id")) != user
        || !("ALERT".equals(c.get("kind")) ? "L1" : "L2").equals(who.get("role")))
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "담당 직원만 변경할 수 있습니다.");
    if (!"OPEN".equals(c.get("status"))) throw ApiException.invalidTransition("종결 사건은 변경할 수 없습니다.");
  }

  private List<Map<String, Object>> initial(Map<String, Object> c) {
    var d = alerts.detail(number(c.get("alert_id")), null);
    double threshold =
        jdbc.queryForObject(
            "select b.threshold_value from analysis_runs r join batch_jobs b on b.job_id=r.job_id where r.run_id=?::uuid",
            Double.class,
            d.get("runId").toString());
    var members = new ArrayList<Map<String, Object>>();
    for (var t : rows(d.get("transactions"))) {
      var evidence = new LinkedHashMap<>(t);
      if (evidence.get("scores") != null)
        evidence.put(
            "isSuspicious",
            CaseSummary.score(object(evidence.get("scores")), "p_laundering") >= threshold);
      else evidence.put("isSuspicious", null);
      var m = new LinkedHashMap<String, Object>();
      m.put("txId", t.get("txId"));
      m.put("reviewRole", "CONTEXT".equals(t.get("role")) ? "CONTEXT" : "SUBJECT");
      m.put("state", "PENDING");
      m.put("decision", null);
      m.put("transaction", evidence);
      m.put(
          "sources",
          new ArrayList<>(
              List.of(Map.of("alertId", c.get("alert_id"), "version", d.get("version")))));
      members.add(m);
    }
    String sourceType = CaseSummary.summarize(members).get("primaryType").toString();
    for (var m : members)
      m.put(
          "sources",
          new ArrayList<>(
              List.of(
                  Map.of(
                      "alertId",
                      c.get("alert_id"),
                      "version",
                      d.get("version"),
                      "primaryType",
                      sourceType))));
    return new ArrayList<>(
        List.of(
            new LinkedHashMap<>(
                Map.of(
                    "groupId",
                    0L,
                    "label",
                    "Alert " + c.get("alert_id"),
                    "revision",
                    0L,
                    "evidenceVersion",
                    d.get("version"),
                    "members",
                    members))));
  }

  private List<Map<String, Object>> groups(Map<String, Object> c) {
    var found =
        jdbc.queryForList(
            "select group_id as \"groupId\",label,revision,evidence_version as \"evidenceVersion\",decision,members::text as members from review_groups where case_id=? order by group_id",
            c.get("case_id"));
    for (var g : found) g.put("members", rows(g.get("members")));
    if ("ALERT".equals(c.get("kind"))) {
      var latest = initial(c);
      if (found.isEmpty()) return latest;
      if ("OPEN".equals(c.get("status"))) {
        var seen = new HashSet<Long>();
        for (var g : found) for (var m : rows(g.get("members"))) seen.add(number(m.get("txId")));
        for (var m : rows(latest.getFirst().get("members")))
          if (!seen.contains(number(m.get("txId")))) rows(found.getFirst().get("members")).add(m);
        found.getFirst().put("evidenceVersion", latest.getFirst().get("evidenceVersion"));
      }
    }
    return found;
  }

  private long revision(Map<String, Object> c) {
    long base = number(c.get("revision"));
    if ("ALERT".equals(c.get("kind")))
      return base * 1000000L
          + number(alerts.detail(number(c.get("alert_id")), null).get("version"));
    return base;
  }

  private List<Map<String, Object>> all(List<Map<String, Object>> groups) {
    var result = new ArrayList<Map<String, Object>>();
    for (var g : groups) result.addAll(rows(g.get("members")));
    return result;
  }

  public Map<String, Object> detail(long id) {
    return detail(id, true);
  }

  private Map<String, Object> detail(long id, boolean includeHistory) {
    time.localOnly();
    var c = caseRow(id);
    var gs = groups(c);
    var members = all(gs);
    var out = new LinkedHashMap<String, Object>();
    out.put("caseId", id);
    out.put("kind", c.get("kind"));
    out.put("alertId", c.get("alert_id"));
    out.put("status", c.get("status"));
    out.put("outcome", c.get("outcome"));
    out.put("revision", revision(c));
    out.put("assigneeId", c.get("assignee_id"));
    out.put("assigneeName", c.get("assignee_name"));
    for (String key : List.of("created_at", "assigned_at", "closed_at"))
      out.put(
          switch (key) {
            case "created_at" -> "createdAt";
            case "assigned_at" -> "assignedAt";
            default -> "closedAt";
          },
          c.get(key) == null ? null : ((Timestamp) c.get(key)).toInstant().toString());
    out.put(
        "ageDays",
        Math.max(
            0,
            Duration.between(((Timestamp) c.get("created_at")).toInstant(), time.now()).toDays()));
    out.put("groups", gs);
    out.put("summary", CaseSummary.summarize(members));
    out.put(
        "pendingCount",
        members.stream()
            .filter(m -> "SUBJECT".equals(m.get("reviewRole")) && "PENDING".equals(m.get("state")))
            .map(m -> number(m.get("txId")))
            .distinct()
            .count());
    var sourceIds = new TreeSet<Long>();
    for (var m : members)
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state")))
        for (var source : rows(m.get("sources"))) sourceIds.add(number(source.get("alertId")));
    out.put("sourceAlertIds", sourceIds);
    var types = new TreeSet<String>();
    for (var m : members)
      if (!Set.of("EXCLUDED", "TRANSFERRED").contains(m.get("state")))
        for (var source : rows(m.get("sources")))
          if (source.get("primaryType") != null) types.add(source.get("primaryType").toString());
    out.put("primaryTypes", types);
    if (includeHistory)
      out.put(
          "history",
          jdbc.queryForList(
              "select e.event_id as \"eventId\",e.action,e.comment,e.business_at as \"businessAt\",e.recorded_at as \"recordedAt\",u.name as actor from review_events e left join users u on u.user_id=e.actor_id where case_id=? order by event_id desc",
              id));
    if (includeHistory && !members.isEmpty()) {
      var ids = members.stream().map(m -> number(m.get("txId"))).distinct().toList();
      var args = new ArrayList<Object>(ids);
      args.add(id);
      out.put(
          "relatedDecisions",
          jdbc.queryForList(
              "select c.case_id as \"caseId\",c.kind,c.status,g.group_id as \"groupId\",m->>'txId' as \"txId\",m->>'decision' as decision "
                  + "from review_groups g join review_cases c using(case_id) cross join lateral jsonb_array_elements(g.members) m "
                  + "where m->>'state'='DECIDED' and (m->>'txId')::bigint in ("
                  + String.join(",", Collections.nCopies(ids.size(), "?"))
                  + ") and c.case_id<>? order by c.case_id,g.group_id",
              args.toArray()));
    }
    return out;
  }

  public Map<String, Object> list(
      String kind, String status, Long assignee, LocalDate from, LocalDate to, int page, int size) {
    time.localOnly();
    AnalysisService.validatePage(page, size);
    if (!Set.of("ALERT", "EPISODE").contains(kind)
        || (status != null && !Set.of("OPEN", "CLOSED").contains(status)))
      throw AnalysisService.invalid();
    var args = new ArrayList<Object>(List.of(kind));
    String sql = " from visible_review_cases c where kind=?";
    if (status != null) {
      sql += " and status=?";
      args.add(status);
    }
    if (assignee != null) {
      sql += " and assignee_id=?";
      args.add(assignee);
    }
    if (from != null) {
      sql += " and created_at>=?";
      args.add(Timestamp.from(from.atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (to != null) {
      sql += " and created_at<?";
      args.add(Timestamp.from(to.plusDays(1).atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (from != null && to != null && from.isAfter(to)) throw AnalysisService.invalid();
    long count = jdbc.queryForObject("select count(*)" + sql, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var ids =
        jdbc.queryForList(
            "select case_id"
                + sql
                + " order by risk desc,created_at desc,case_id desc limit ? offset ?",
            Long.class,
            args.toArray());
    var content = new ArrayList<Map<String, Object>>();
    for (long id : ids) {
      var d = detail(id, false);
      d.remove("groups");
      d.remove("history");
      content.add(d);
    }
    return Map.of(
        "content",
        content,
        "page",
        page,
        "size",
        size,
        "totalElements",
        count,
        "totalPages",
        (count + size - 1) / size);
  }

  private void save(long id, List<Map<String, Object>> gs) {
    for (var g : gs) {
      if (number(g.get("groupId")) == 0) {
        long gid =
            jdbc.queryForObject(
                "insert into review_groups(case_id,label,evidence_version,members) values(?,?,?,?::jsonb) returning group_id",
                Long.class,
                id,
                g.get("label"),
                g.get("evidenceVersion"),
                encode(g.get("members")));
        g.put("groupId", gid);
      } else
        jdbc.update(
            "update review_groups set members=?::jsonb,decision=?,evidence_version=?,revision=revision+1 where group_id=? and case_id=?",
            encode(g.get("members")),
            g.get("decision"),
            g.get("evidenceVersion"),
            g.get("groupId"),
            id);
    }
    jdbc.update("update review_cases set revision=revision+1 where case_id=?", id);
  }

  private void event(long id, long user, String action, String comment, Object snapshot) {
    jdbc.update(
        "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,?,?,?,?::jsonb)",
        id,
        user,
        action,
        comment,
        Timestamp.from(time.now()),
        encode(snapshot));
  }

  private Map<String, Object> moneyScope(long id) {
    var found =
        jdbc.queryForList(
            "select snapshot::text from review_events where case_id=? and action='MONEY_SCOPE' order by event_id desc limit 1",
            id);
    return found.isEmpty() ? null : object(found.getFirst().get("snapshot"));
  }

  public Map<String, Object> money(long id, int minutes) {
    time.localOnly();
    if (!Set.of(5, 15, 30, 60, 180, 360, 1440).contains(minutes)) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          var c = caseRow(id);
          if ("CLOSED".equals(c.get("status"))) {
            var fixed =
                jdbc.queryForList(
                    "select snapshot::text from review_events where case_id=? and action='MONEY_SNAPSHOT' order by event_id desc limit 1",
                    id);
            if (!fixed.isEmpty()) return object(fixed.getFirst().get("snapshot"));
            return Map.<String, Object>of(
                "available",
                false,
                "reason",
                "NO_CLOSED_SNAPSHOT",
                "selectedAccounts",
                List.of(),
                "candidateAccounts",
                List.of(),
                "delayMinutes",
                180);
          }
          return new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), minutes);
        });
  }

  public record MoneyScope(UUID requestId, long revision, List<UUID> accounts, String comment) {}

  public Map<String, Object> setMoneyScope(long id, long user, MoneyScope scope) {
    actor(user);
    if (scope.requestId() == null
        || scope.accounts() == null
        || scope.accounts().size() > 1000
        || scope.accounts().stream().anyMatch(Objects::isNull)
        || scope.comment() == null
        || scope.comment().isBlank()
        || scope.comment().length() > 4000) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          var payload = Map.of("action", "MONEY_SCOPE", "caseId", id, "body", scope);
          var cached =
              jdbc.queryForList(
                  "select payload::text,response::text from review_requests where actor_id=? and request_id=?",
                  user,
                  scope.requestId());
          if (!cached.isEmpty()) {
            if (!object(cached.getFirst().get("payload")).equals(object(encode(payload))))
              throw ApiException.invalidTransition("같은 요청 번호의 내용이 다릅니다.");
            return object(cached.getFirst().get("response"));
          }
          var c = caseRow(id);
          editable(c, user);
          if (revision(c) != scope.revision())
            throw ApiException.invalidTransition("사건이 변경됐습니다. 다시 조회하세요.");
          for (var account : new HashSet<>(scope.accounts()))
            if (!jdbc.queryForObject(
                "select exists(select 1 from private.accounts where service_account_id=?)",
                Boolean.class,
                account)) throw AnalysisService.invalid();
          event(id, user, "MONEY_SCOPE", scope.comment(), Map.of("accounts", scope.accounts()));
          jdbc.update("update review_cases set revision=revision+1 where case_id=?", id);
          var response = Map.<String, Object>of("caseId", id, "revision", revision(caseRow(id)));
          jdbc.update(
              "insert into review_requests values(?,?,?::jsonb,?::jsonb)",
              user,
              scope.requestId(),
              encode(payload),
              encode(response));
          return response;
        });
  }

  public record Selection(long caseId, long revision, long groupId, List<Long> txIds) {}

  public record Command(
      UUID requestId,
      String action,
      List<Selection> selections,
      Long targetCaseId,
      Long targetRevision,
      Long targetGroupId,
      String decision,
      String comment) {}

  public Map<String, Object> command(long user, Command cmd) {
    actor(user);
    if (cmd.requestId() == null
        || cmd.action() == null
        || cmd.comment() == null
        || cmd.comment().isBlank()
        || cmd.comment().length() > 4000
        || cmd.selections() == null
        || cmd.selections().isEmpty()
        || cmd.selections().size() > 100
        || cmd.selections().stream().anyMatch(Objects::isNull)) throw AnalysisService.invalid();
    return tx.execute(
        s -> {
          // Shared ordering serializes local clock updates and multi-case writes without deadlocks.
          jdbc.queryForList("select pg_advisory_xact_lock(?)", AnalysisService.RECEIPT_LOCK);
          jdbc.queryForList("select id from demo_business_clock where id for update");
          var cached =
              jdbc.queryForList(
                  "select payload::text,response::text from review_requests where actor_id=? and request_id=?",
                  user,
                  cmd.requestId());
          if (!cached.isEmpty()) {
            if (!object(cached.getFirst().get("payload")).equals(object(encode(cmd))))
              throw ApiException.invalidTransition("같은 요청 번호의 내용이 다릅니다.");
            return object(cached.getFirst().get("response"));
          }
          var loaded = new LinkedHashMap<Long, List<Map<String, Object>>>();
          var cases = new LinkedHashMap<Long, Map<String, Object>>();
          for (var sel : cmd.selections()) {
            var c = caseRow(sel.caseId());
            editable(c, user);
            if (revision(c) != sel.revision())
              throw ApiException.invalidTransition("사건이 변경됐습니다. 다시 조회하세요.");
            cases.put(sel.caseId(), c);
            loaded.computeIfAbsent(sel.caseId(), id -> groups(c));
          }
          String role = actor(user).get("role").toString();
          boolean transfer = "TRANSFER".equals(cmd.action()), move = "MOVE".equals(cmd.action());
          Long target = null;
          if (transfer || move) {
            if (transfer && !role.equals("L1") || move && !role.equals("L2"))
              throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "이관 권한이 없습니다.");
            if (cmd.targetCaseId() == null) {
              long assignee =
                  move
                      ? user
                      : jdbc.queryForObject(
                          "select user_id from users where role='L2' order by last_assigned_at nulls first,user_id limit 1 for update",
                          Long.class);
              target =
                  jdbc.queryForObject(
                      "insert into review_cases(kind,assignee_id,created_at,assigned_at) values('EPISODE',?,?,?) returning case_id",
                      Long.class,
                      assignee,
                      Timestamp.from(time.now()),
                      Timestamp.from(time.now()));
              if (!move)
                jdbc.update(
                    "update users set last_assigned_at=? where user_id=?",
                    Timestamp.from(time.now()),
                    assignee);
            } else {
              target = cmd.targetCaseId();
              var c = caseRow(target);
              if (!"EPISODE".equals(c.get("kind"))
                  || !"OPEN".equals(c.get("status"))
                  || cmd.targetRevision() == null
                  || number(c.get("revision")) != cmd.targetRevision())
                throw ApiException.invalidTransition("목적지 상태/버전이 변경됐습니다.");
              if (move) editable(c, user);
            }
            if (transfer && cases.containsKey(target)) throw AnalysisService.invalid();
          }
          var targetGroups =
              target == null
                  ? new ArrayList<Map<String, Object>>()
                  : loaded.containsKey(target) ? loaded.get(target) : groups(caseRow(target));
          for (var sel : cmd.selections()) {
            var gs = loaded.get(sel.caseId());
            if (Set.of("CLOSE", "COMMENT", "REVIEW_START").contains(cmd.action())) continue;
            var g =
                gs.stream()
                    .filter(x -> number(x.get("groupId")) == sel.groupId())
                    .findFirst()
                    .orElseThrow(AnalysisService::invalid);
            var members = rows(g.get("members"));
            if (sel.txIds() == null
                || sel.txIds().isEmpty()
                || new HashSet<>(sel.txIds()).size() != sel.txIds().size())
              throw AnalysisService.invalid();
            var selected =
                members.stream().filter(m -> sel.txIds().contains(number(m.get("txId")))).toList();
            if (selected.size() != sel.txIds().size()
                || selected.stream()
                    .anyMatch(
                        m ->
                            !"PENDING".equals(m.get("state"))
                                && !("RECONSIDER".equals(cmd.action())
                                    && "DECIDED".equals(m.get("state")))))
              throw ApiException.invalidTransition("선택 범위에 이미 처리된 거래가 있습니다.");
            if ("DECIDE".equals(cmd.action())) {
              if (!Set.of("NORMAL", "SUSPICIOUS").contains(Objects.toString(cmd.decision(), ""))
                  || role.equals("L1") && !"NORMAL".equals(cmd.decision()))
                throw AnalysisService.invalid();
              if (selected.stream().anyMatch(m -> !"SUBJECT".equals(m.get("reviewRole"))))
                throw AnalysisService.invalid();
              if (role.equals("L2")
                  && members.stream()
                          .filter(
                              m ->
                                  "SUBJECT".equals(m.get("reviewRole"))
                                      && "PENDING".equals(m.get("state")))
                          .count()
                      != selected.size())
                throw ApiException.invalidTransition(
                    "Episode는 묶음 단위로 판정합니다. 다른 결론이 필요하면 먼저 분리하세요.");
              for (var m : selected) {
                m.put("state", "DECIDED");
                m.put("decision", cmd.decision());
              }
              if (role.equals("L2")) g.put("decision", cmd.decision());
            } else if ("RECONSIDER".equals(cmd.action())) {
              if (!role.equals("L2")) throw AnalysisService.invalid();
              for (var m : members)
                if ("DECIDED".equals(m.get("state"))) {
                  m.put("state", "PENDING");
                  m.put("decision", null);
                }
              g.put("decision", null);
            } else if ("EXCLUDE".equals(cmd.action()))
              selected.forEach(m -> m.put("state", "EXCLUDED"));
            else if ("SUBJECT".equals(cmd.action()) || "CONTEXT".equals(cmd.action()))
              selected.forEach(m -> m.put("reviewRole", cmd.action()));
            else if (transfer || move || "SPLIT".equals(cmd.action())) {
              if ("SPLIT".equals(cmd.action()) && !role.equals("L2"))
                throw AnalysisService.invalid();
              var copied = copy(selected);
              selected.forEach(
                  m -> {
                    m.put("state", "TRANSFERRED");
                    m.put("internalMove", targetCase(cmd, sel.caseId()));
                  });
              var destination = target == null ? gs : targetGroups;
              if (cmd.targetGroupId() != null && target != null) {
                var dest =
                    destination.stream()
                        .filter(x -> number(x.get("groupId")) == cmd.targetGroupId())
                        .findFirst()
                        .orElseThrow(AnalysisService::invalid);
                if (dest == g) throw AnalysisService.invalid();
                if (dest.get("decision") != null)
                  throw ApiException.invalidTransition("판정된 묶음에는 추가할 수 없습니다. 새 묶음으로 이동하세요.");
                merge(rows(dest.get("members")), copied);
              } else
                destination.add(
                    new LinkedHashMap<>(
                        Map.of(
                            "groupId",
                            0L,
                            "label",
                            g.get("label"),
                            "revision",
                            0L,
                            "members",
                            copied)));
            } else throw AnalysisService.invalid();
          }
          if (target != null && !loaded.containsKey(target)) {
            save(target, targetGroups);
            event(target, user, cmd.action(), cmd.comment(), targetGroups);
          }
          for (var entry : loaded.entrySet()) {
            long id = entry.getKey();
            var gs = entry.getValue();
            if ("CLOSE".equals(cmd.action())) close(id, user, gs);
            else if (!Set.of(
                    "COMMENT",
                    "REVIEW_START",
                    "DECIDE",
                    "EXCLUDE",
                    "SUBJECT",
                    "CONTEXT",
                    "TRANSFER",
                    "MOVE",
                    "SPLIT",
                    "RECONSIDER")
                .contains(cmd.action())) throw AnalysisService.invalid();
            save(id, gs);
            event(id, user, cmd.action(), cmd.comment(), gs);
          }
          var response = new LinkedHashMap<String, Object>();
          response.put("caseIds", loaded.keySet());
          response.put("targetCaseId", target);
          jdbc.update(
              "insert into review_requests values(?,?,?::jsonb,?::jsonb)",
              user,
              cmd.requestId(),
              encode(cmd),
              encode(response));
          return response;
        });
  }

  private boolean targetCase(Command cmd, long source) {
    return "SPLIT".equals(cmd.action())
        || ("MOVE".equals(cmd.action()) && Objects.equals(cmd.targetCaseId(), source));
  }

  private void merge(List<Map<String, Object>> existing, List<Map<String, Object>> added) {
    for (var m : added) {
      var match =
          existing.stream()
              .filter(
                  x ->
                      number(x.get("txId")) == number(m.get("txId"))
                          && !Set.of("EXCLUDED", "TRANSFERRED").contains(x.get("state")))
              .findFirst();
      if (match.isEmpty()) existing.add(m);
      else {
        if (!"PENDING".equals(match.get().get("state")))
          throw ApiException.invalidTransition("목적지에 판정된 동일 거래가 있습니다.");
        for (var source : rows(m.get("sources")))
          if (!rows(match.get().get("sources")).contains(source))
            rows(match.get().get("sources")).add(source);
      }
    }
  }

  private void close(long id, long user, List<Map<String, Object>> gs) {
    var members = all(gs);
    if (members.stream()
        .anyMatch(m -> "SUBJECT".equals(m.get("reviewRole")) && "PENDING".equals(m.get("state"))))
      throw ApiException.invalidTransition("미판정 조사 대상이 남아 있습니다.");
    var decided = members.stream().filter(m -> "DECIDED".equals(m.get("state"))).toList();
    var verdicts = new HashMap<Long, String>();
    for (var m : decided) {
      String previous = verdicts.putIfAbsent(number(m.get("txId")), m.get("decision").toString());
      if (previous != null && !previous.equals(m.get("decision")))
        throw ApiException.invalidTransition("같은 거래의 묶음 판정이 상충합니다. 범위를 재검토하세요.");
    }
    boolean transferred =
        members.stream()
            .anyMatch(
                m ->
                    "TRANSFERRED".equals(m.get("state"))
                        && !Boolean.TRUE.equals(m.get("internalMove")));
    String result =
        decided.stream().anyMatch(m -> "SUSPICIOUS".equals(m.get("decision")))
            ? "SUSPICIOUS"
            : decided.isEmpty()
                ? (transferred ? "TRANSFERRED" : "SCOPE_CLEARED")
                : transferred && "ALERT".equals(caseRow(id).get("kind")) ? "MIXED" : "NORMAL";
    var snapshot = new MoneyQuery(jdbc, time).read(detail(id), moneyScope(id), 180);
    event(id, user, "MONEY_SNAPSHOT", "종결 시점 자금 관측 지표", snapshot);
    jdbc.update(
        "update review_cases set status='CLOSED',outcome=?,closed_at=?,closed_by=? where case_id=?",
        result,
        Timestamp.from(time.now()),
        user,
        id);
    var c = caseRow(id);
    if ("ALERT".equals(c.get("kind")))
      jdbc.update(
          "update alerts set status=?,resolution=? where alert_id=?",
          transferred ? "ESCALATED" : "CLOSED",
          result,
          c.get("alert_id"));
  }
}
