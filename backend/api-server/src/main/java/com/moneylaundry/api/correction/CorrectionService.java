package com.moneylaundry.api.correction;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.analysis.AnalysisService;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class CorrectionService {
  private final JdbcTemplate jdbc;

  public CorrectionService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public static final List<String> STATES =
      List.of(
          "OPEN",
          "REPLACEMENT_RECEIVED",
          "VALIDATING",
          "WAITING_COUNTERPART",
          "WAITING_ANALYSIS_RELEASE",
          "RESOLVED");

  public static void requireReporting(JdbcTemplate jdbc, int bank, LocalDate date) {
    boolean allowed =
        Boolean.TRUE.equals(
            jdbc.queryForObject(
                "select exists(select 1 from banks b join bank_reporting_periods p using(bank_id) where b.bank_id=? and b.is_reporting and p.effective_from_date<=? and (p.effective_to_date is null or p.effective_to_date>=?))",
                Boolean.class,
                bank,
                date,
                date));
    if (!allowed)
      throw new ApiException(
          HttpStatus.FORBIDDEN, "REPORTING_NOT_REGISTERED", "사전 등록된 보고 은행/기준일만 수집합니다.");
  }

  public Map<String, Object> list(int bank, String state, int page, int size) {
    AnalysisService.validatePage(page, size);
    if (state != null && !STATES.contains(state)) throw AnalysisService.invalid();
    if (!Boolean.TRUE.equals(
        jdbc.queryForObject(
            "select exists(select 1 from banks b join bank_reporting_periods p using(bank_id) where b.bank_id=? and b.is_reporting)",
            Boolean.class,
            bank)))
      throw new ApiException(
          HttpStatus.FORBIDDEN, "REPORTING_NOT_REGISTERED", "사전 등록된 보고 은행만 조회합니다.");
    String filter = state == null ? "c.status<>'RESOLVED'" : "c.status=?";
    List<Object> args = new ArrayList<>();
    args.add(bank);
    if (state != null) args.add(state);
    String where =
        " from correction_requests c where c.bank_id=? and "
            + filter
            + " and exists(select 1 from bank_reporting_periods p where p.bank_id=c.bank_id and p.effective_from_date<=c.business_date and (p.effective_to_date is null or p.effective_to_date>=c.business_date))";
    long count = jdbc.queryForObject("select count(*)" + where, Long.class, args.toArray());
    args.add(size);
    args.add((long) page * size);
    var ids =
        jdbc.queryForList(
            "select correction_id" + where + " order by correction_id desc limit ? offset ?",
            Long.class,
            args.toArray());
    return AnalysisService.page(
        ids.stream().map(id -> detail(bank, id)).toList(), page, size, count);
  }

  public Map<String, Object> detail(int bank, long id) {
    var rows =
        jdbc.queryForList(
            "select c.correction_id as \"correctionRequestId\",c.business_date as \"businessDate\",v.upload_id as \"uploadId\",c.version_id as \"reportVersionId\",c.status,c.revision,c.replacement_version_id as \"replacementVersionId\",rv.upload_id as \"replacementUploadId\" from correction_requests c left join report_versions v on v.version_id=c.version_id left join report_versions rv on rv.version_id=c.replacement_version_id where c.bank_id=? and c.correction_id=?",
            bank,
            id);
    if (rows.isEmpty()) throw ApiException.notFound("정정 요청 없음");
    var row = rows.getFirst();
    requireReporting(jdbc, bank, ((java.sql.Date) row.get("businessDate")).toLocalDate());
    row.replaceAll((k, v) -> AnalysisService.jsonValue(v));
    row.put(
        "errors",
        jdbc.queryForList(
            "select source_row as row,column_name as \"column\",code,reason from correction_errors where correction_id=? order by ordinal",
            id));
    return row;
  }

  public static long open(
      JdbcTemplate jdbc, int bank, LocalDate date, Long version, String code, long revision) {
    long id =
        jdbc.queryForObject(
            "insert into correction_requests(bank_id,business_date,version_id,reason_code,source_revision) values(?,?,?,?,?) on conflict(bank_id,business_date,version_id,reason_code,source_revision) do update set reason_code=excluded.reason_code returning correction_id",
            Long.class,
            bank,
            date,
            version,
            code,
            revision);
    jdbc.update(
        "insert into correction_errors(correction_id,ordinal,source_row,column_name,code,reason) values(?,0,null,'',?,'보고 내용을 확인하고 전체 파일을 제출하세요.') on conflict do nothing",
        id,
        code);
    return id;
  }
}
