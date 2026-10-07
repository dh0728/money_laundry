package com.moneylaundry.api.review;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.analysis.AnalysisService;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class NotificationService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;

  public NotificationService(JdbcTemplate jdbc, TransactionTemplate tx) {
    this.jdbc = jdbc;
    this.tx = tx;
  }

  private void paging(int page, int size) {
    if (page < 0 || page > 100000 || size < 1 || size > 100) throw AnalysisService.invalid();
  }

  public Map<String, Object> list(
      long user, LocalDate from, LocalDate to, String query, int page, int size) {
    paging(page, size);
    if (from != null && to != null && from.isAfter(to) || query != null && query.length() > 200)
      throw AnalysisService.invalid();
    StringBuilder where = new StringBuilder(" where n.user_id=?");
    List<Object> args = new ArrayList<>(List.of(user));
    if (from != null) {
      where.append(" and n.at>=?");
      args.add(Timestamp.from(from.atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (to != null) {
      where.append(" and n.at<?");
      args.add(Timestamp.from(to.plusDays(1).atStartOfDay(BusinessTime.KST).toInstant()));
    }
    if (query != null && !query.isBlank()) {
      where.append(" and strpos(lower(n.title||' '||n.description||' '||n.code),lower(?))>0");
      args.add(query.trim());
    }
    String base =
        " from review.notifications n left join review.notification_reads r on r.user_id=n.user_id and r.notification_id=n.notification_id"
            + where;
    long total = jdbc.queryForObject("select count(*)" + base, Long.class, args.toArray());
    long unread =
        jdbc.queryForObject(
            "select count(*)" + base + " and r.user_id is null", Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var content =
        jdbc.query(
            "select n.*,r.read_at"
                + base
                + " order by n.at desc,n.notification_id desc limit ? offset ?",
            (rs, index) -> {
              Map<String, Object> row = new LinkedHashMap<>();
              row.put("id", rs.getString("notification_id"));
              row.put("kind", rs.getString("kind"));
              row.put("title", rs.getString("title"));
              row.put("description", rs.getString("description"));
              row.put("code", rs.getString("code"));
              row.put("count", rs.getLong("item_count"));
              row.put(
                  "at",
                  rs.getTimestamp("at")
                      .toInstant()
                      .atZone(BusinessTime.KST)
                      .toOffsetDateTime()
                      .format(java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME));
              row.put("read", rs.getTimestamp("read_at") != null);
              row.put("caseId", rs.getObject("case_id"));
              row.put("caseKind", rs.getString("case_kind"));
              return row;
            },
            args.toArray());
    return Map.of(
        "content",
        content,
        "totalElements",
        total,
        "unreadCount",
        unread,
        "number",
        page,
        "size",
        size,
        "totalPages",
        (total + size - 1) / size);
  }

  private Map<String, Object> owned(long user, String id) {
    var rows =
        jdbc.queryForList(
            "select * from review.notifications where user_id=? and notification_id=?", user, id);
    if (rows.isEmpty()) throw ApiException.notFound("알림을 찾을 수 없습니다.");
    return rows.getFirst();
  }

  public Map<String, Object> cases(long user, String id, int page, int size) {
    paging(page, size);
    var notification = owned(user, id);
    String base;
    Object ref;
    if (notification.get("batch_run_id") != null) {
      base =
          " from review.cases c join review.alert_versions v on v.alert_id=c.alert_id and v.version=1 where c.assignee_id=? and v.run_id=?";
      ref = notification.get("batch_run_id");
    } else {
      base = " from review.cases c where c.assignee_id=? and c.case_id=?";
      ref = notification.get("case_id");
    }
    long total = jdbc.queryForObject("select count(*)" + base, Long.class, user, ref);
    var rows =
        jdbc.queryForList(
            "select c.case_id as \"caseId\",c.kind,c.alert_id as \"alertId\",c.status"
                + base
                + " order by c.case_id desc limit ? offset ?",
            user,
            ref,
            size,
            (long) page * size);
    return Map.of(
        "content",
        rows,
        "totalElements",
        total,
        "number",
        page,
        "size",
        size,
        "totalPages",
        (total + size - 1) / size);
  }

  public record ReadInput(List<String> ids, Boolean read) {}

  public Map<String, Object> read(long user, ReadInput input) {
    if (input.ids() == null
        || input.ids().isEmpty()
        || input.ids().size() > 100
        || input.read() == null
        || input.ids().stream().anyMatch(id -> id == null || id.length() > 100))
      throw AnalysisService.invalid();
    return tx.execute(
        status -> {
          var ids = new LinkedHashSet<>(input.ids());
          for (String id : ids) owned(user, id);
          for (String id : ids) {
            if (input.read())
              jdbc.update(
                  "insert into review.notification_reads(user_id,notification_id) values(?,?) on conflict(user_id,notification_id) do nothing",
                  user,
                  id);
            else
              jdbc.update(
                  "delete from review.notification_reads where user_id=? and notification_id=?",
                  user,
                  id);
          }
          return Map.of("updated", ids.size());
        });
  }
}
