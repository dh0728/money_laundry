package com.moneylaundry.api.alert;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.analysis.AnalysisService;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
@Transactional(
    readOnly = true,
    isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
public class AlertQueryService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper mapper;
  private static final String VISIBLE =
      """
      from alerts a join lateral (select v.* from alert_versions v
        join analysis_runs r using(run_id) join batch_jobs b on b.job_id=r.job_id
        where v.alert_id=a.alert_id and r.status='COMPLETED' and b.status='COMPLETED'
        order by v.version desc limit 1) v on true
      """;

  public AlertQueryService(JdbcTemplate jdbc, ObjectMapper mapper) {
    this.jdbc = jdbc;
    this.mapper = mapper;
  }

  public Map<String, Object> list(int page, int size, String status, Long assigneeId, Long jobId) {
    AnalysisService.validatePage(page, size);
    String where = " where true";
    List<Object> args = new ArrayList<>();
    if (status != null) {
      if (!List.of("OPEN", "CLOSED", "ESCALATED").contains(status))
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "지원하지 않는 Alert 상태입니다.");
      where += " and a.status=?";
      args.add(status);
    }
    if (assigneeId != null) {
      if (assigneeId < 1)
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "담당자 ID는 양수입니다.");
      where += " and a.assignee_id=?";
      args.add(assigneeId);
    }
    if (jobId != null) {
      if (jobId < 1)
        throw new ApiException(
            HttpStatus.BAD_REQUEST, "INVALID_PARAMETER", "jobId must be positive");
      where += " and exists(select 1 from analysis_runs r where r.run_id=v.run_id and r.job_id=?)";
      args.add(jobId);
    }
    long count =
        jdbc.queryForObject("select count(*) " + VISIBLE + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var rows =
        jdbc.queryForList(
            "select a.*,v.version,v.run_id,v.evidence "
                + VISIBLE
                + where
                + " order by (v.evidence->'summary'->>'scoreMax')::double precision desc nulls last,a.alert_id limit ? offset ?",
            args.toArray());
    return AnalysisService.page(rows.stream().map(r -> view(r, false)).toList(), page, size, count);
  }

  public Map<String, Object> detail(long id, Integer version) {
    if (id < 1 || (version != null && version < 1))
      throw ApiException.notFound("Alert 근거를 찾을 수 없습니다.");
    var rows =
        jdbc.queryForList(
            """
        select a.*,v.version,v.run_id,v.evidence from alerts a join alert_versions v using(alert_id)
        join analysis_runs r using(run_id) join batch_jobs b on b.job_id=r.job_id
        where a.alert_id=? and r.status='COMPLETED' and b.status='COMPLETED'
        """
                + (version == null ? " order by v.version desc limit 1" : " and v.version=?"),
            version == null ? new Object[] {id} : new Object[] {id, version});
    if (rows.isEmpty()) throw ApiException.notFound("완료된 Alert 근거를 찾을 수 없습니다.");
    Map<String, Object> result = view(rows.getFirst(), true);
    var coverage =
        jdbc.queryForList(
            """
        select c.coverage::text,c.forward_complete,c.run_id from alert_coverage_checks c
        join analysis_runs r using(run_id) join batch_jobs b on b.job_id=r.job_id
        where c.alert_id=? and r.status='COMPLETED' and b.status='COMPLETED'
        """
                + (version == null
                    ? " order by b.analysis_cutoff_at desc,b.job_id desc limit 1"
                    : " and c.run_id=?"),
            version == null ? new Object[] {id} : new Object[] {id, rows.getFirst().get("run_id")});
    result.put(
        "coverage",
        coverage.isEmpty()
            ? List.of()
            : mapper.readValue(coverage.getFirst().get("coverage").toString(), List.class));
    result.put(
        "forwardComplete",
        !coverage.isEmpty() && Boolean.TRUE.equals(coverage.getFirst().get("forward_complete")));
    return result;
  }

  public List<Map<String, Object>> versions(long id) {
    detail(id, null);
    return jdbc.queryForList(
        """
        select v.version,v.run_id as "runId",v.created_at as "createdAt" from alert_versions v
        join analysis_runs r using(run_id) join batch_jobs b on b.job_id=r.job_id
        where v.alert_id=? and r.status='COMPLETED' and b.status='COMPLETED' order by v.version
        """,
        id);
  }

  private Map<String, Object> view(Map<String, Object> row, boolean detail) {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("alertId", row.get("alert_id"));
    result.put("status", row.get("status"));
    result.put("resolution", row.get("resolution"));
    result.put("assigneeId", row.get("assignee_id"));
    result.put("parentAlertId", row.get("parent_alert_id"));
    result.put("createdAt", row.get("created_at"));
    result.put("version", row.get("version"));
    result.put("runId", row.get("run_id"));
    Map<String, Object> evidence = mapper.readValue(row.get("evidence").toString(), Map.class);
    if (detail) result.putAll(evidence);
    else result.put("summary", evidence.get("summary"));
    return result;
  }
}
