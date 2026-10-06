package com.moneylaundry.api.ingest;

import com.moneylaundry.api.batchjob.*;
import com.moneylaundry.api.storage.UploadStore;
import java.io.*;
import java.nio.charset.*;
import java.sql.Timestamp;
import java.time.ZoneId;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Ingestion stores immutable encrypted bank reports; integration is a separate boundary. */
@Service
public class LedgerLoader {
  private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LedgerLoader.class);
  private final BatchJobRepository jobs;
  private final UploadStore store;
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final ObjectMapper mapper;
  private final PrivateDataProtector protector;
  private final ZoneId zone;

  public LedgerLoader(
      BatchJobRepository jobs,
      UploadStore store,
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      ObjectMapper mapper,
      PrivateDataProtector protector,
      @Value("${app.zone}") String zone) {
    this.jobs = jobs;
    this.store = store;
    this.jdbc = jdbc;
    this.tx = tx;
    this.mapper = mapper;
    this.protector = protector;
    this.zone = ZoneId.of(zone);
  }

  @Async
  public void load(long id) {
    try {
      BatchJob job = jobs.findById(id).orElseThrow();
      if (jdbc.queryForObject(
              "select count(*) from report_versions where upload_id=?", Integer.class, id)
          > 0) return;
      protector.requireKeys();
      jdbc.update(
          "update correction_requests c set status='VALIDATING' from correction_uploads u where u.correction_id=c.correction_id and u.upload_id=? and c.status<>'RESOLVED' and not exists(select 1 from correction_uploads newer where newer.correction_id=c.correction_id and newer.upload_id>u.upload_id)",
          id);
      job.setStartedAt(java.time.Instant.now());
      job.setAttemptCount(job.getAttemptCount() + 1);
      List<ValidationError> errors = new ArrayList<>();
      List<TransactionRow> rows = new ArrayList<>();
      int missing = 0, count = 0;
      boolean incompleteRead = false;
      if (job.getBusinessDate() == null)
        errors.add(new ValidationError(0, "businessDate", "거래 기준일 없음"));
      if (!Boolean.TRUE.equals(
          jdbc.queryForObject(
              "select exists(select 1 from banks b join bank_reporting_periods p using(bank_id)"
                  + " where b.bank_id=? and b.is_reporting and p.effective_from_date<=? and"
                  + " (p.effective_to_date is null or p.effective_to_date>=?))",
              Boolean.class,
              job.getBankId(),
              job.getBusinessDate(),
              job.getBusinessDate())))
        errors.add(new ValidationError(0, "bankId", "REPORTING_NOT_REGISTERED"));
      try (BufferedReader reader =
          new BufferedReader(
              new InputStreamReader(
                  store.open(job.getS3Key()),
                  StandardCharsets.UTF_8
                      .newDecoder()
                      .onMalformedInput(CodingErrorAction.REPORT)
                      .onUnmappableCharacter(CodingErrorAction.REPORT)))) {
        CsvTransactionReader csv = readerForBank(job.getBankId(), reader);
        while (true) {
          try {
            TransactionRow row = csv.next();
            if (row == null) break;
            count++;
            if (!row.occurredAt().atZone(zone).toLocalDate().equals(job.getBusinessDate()))
              add(
                  errors,
                  new ValidationError(row.fileRow(), "Timestamp", "BUSINESS_DATE_MISMATCH"));
            if (row.fromBank() != job.getBankId() && row.toBank() != job.getBankId())
              add(errors, new ValidationError(row.fileRow(), "bankId", "REPORTING_BANK_MISMATCH"));
            rows.add(row);
          } catch (CsvTransactionReader.RowException e) {
            count++;
            if (e.missing()) missing++;
            add(errors, e.error());
            if (e.fatal()) {
              incompleteRead = true;
              break;
            }
          }
        }
      } catch (ValidationFailedException e) {
        incompleteRead = true;
        for (var error : e.errors()) add(errors, error);
      } catch (CharacterCodingException e) {
        incompleteRead = true;
        add(errors, new ValidationError(0, "", "INVALID_UTF8"));
      } catch (IOException e) {
        throw new IllegalStateException("REPORT_READ_FAILED");
      }
      if (count == 0 && !incompleteRead) add(errors, new ValidationError(1, "", "EMPTY_FILE"));
      Set<Long> conflicts =
          ReportMatcher.identityConflicts(
              rows.stream().map(r -> new ReportMatcher.Report(0, 0, job.getBankId(), r)).toList());
      if (!conflicts.isEmpty()) add(errors, new ValidationError(0, "", "IDENTITY_CONFLICT"));
      final int preparedMissing = missing;
      final Integer preparedCount = incompleteRead ? null : count;
      tx.executeWithoutResult(
          status -> {
            jdbc.query("select pg_advisory_xact_lock(?)", ps -> ps.setLong(1, 17004000L), rs -> {});
            if (jdbc.queryForObject(
                    "select count(*) from report_versions where upload_id=?", Integer.class, id)
                > 0) return;
            if (!Boolean.TRUE.equals(
                jdbc.queryForObject(
                    "select exists(select 1 from banks b join bank_reporting_periods p"
                        + " using(bank_id) where b.bank_id=? and b.is_reporting and"
                        + " p.effective_from_date<=? and (p.effective_to_date is null or"
                        + " p.effective_to_date>=?))",
                    Boolean.class,
                    job.getBankId(),
                    job.getBusinessDate(),
                    job.getBusinessDate())))
              throw new IllegalStateException("REPORTING_NOT_REGISTERED");
            jdbc.update(
                "insert into report_sets(bank_id,business_date) values(?,?) on conflict do nothing",
                job.getBankId(),
                job.getBusinessDate());
            long setId =
                jdbc.queryForObject(
                    "select set_id from report_sets where bank_id=? and business_date=?",
                    Long.class,
                    job.getBankId(),
                    job.getBusinessDate());
            var correctionIds =
                jdbc.queryForList(
                    "select correction_id from correction_uploads where upload_id=?",
                    Long.class,
                    id);
            int versionNo =
                jdbc.queryForObject(
                    "select count(*) from batch_jobs where job_type='INGEST' and bank_id=? and business_date=? and job_id<=?",
                    Integer.class,
                    job.getBankId(),
                    job.getBusinessDate(),
                    id);
            if (jdbc.queryForObject(
                        "select count(*) from report_versions where set_id=?", Integer.class, setId)
                    > 0
                && correctionIds.isEmpty())
              throw new IllegalStateException("EXPLICIT_CORRECTION_REQUIRED");
            Long correctionOf =
                correctionIds.isEmpty()
                    ? null
                    : jdbc.queryForObject(
                        "select version_id from correction_requests where correction_id=?",
                        Long.class,
                        correctionIds.getFirst());
            long version =
                jdbc.queryForObject(
                    "insert into report_versions(set_id,upload_id,version_no,received_at,stage_status,error_code,row_count,correction_of_version_id,self_valid) values(?,?,?,?,?,?,?,?,?) returning version_id",
                    Long.class,
                    setId,
                    id,
                    versionNo,
                    Timestamp.from(job.getReceivedAt()),
                    errors.isEmpty() ? "VALIDATED_WAITING_INTEGRATION" : "HELD",
                    errors.isEmpty() ? null : "INVALID_SELF",
                    preparedCount,
                    correctionOf,
                    errors.isEmpty());
            if (!correctionIds.isEmpty())
              jdbc.update(
                  "update correction_requests c set replacement_version_id=case when ? then ? else c.replacement_version_id end,status=?,revision=revision+1 where correction_id=? and status<>'RESOLVED' and not exists(select 1 from correction_uploads u where u.correction_id=c.correction_id and u.upload_id>?)",
                  errors.isEmpty(),
                  version,
                  errors.isEmpty() ? "WAITING_COUNTERPART" : "OPEN",
                  correctionIds.getFirst(),
                  id);
            if (!errors.isEmpty()
                && (correctionIds.isEmpty()
                    || jdbc.queryForObject(
                            "select count(*) from correction_uploads where correction_id=? and upload_id>?",
                            Integer.class,
                            correctionIds.getFirst(),
                            id)
                        == 0)) {
              long correction =
                  correctionIds.isEmpty()
                      ? com.moneylaundry.api.correction.CorrectionService.open(
                          jdbc, job.getBankId(), job.getBusinessDate(), version, "INVALID_SELF", 1)
                      : correctionIds.getFirst();
              jdbc.update("delete from correction_errors where correction_id=?", correction);
              for (int i = 0; i < errors.size(); i++) {
                ValidationError error = errors.get(i);
                jdbc.update(
                    "insert into correction_errors values(?,?,?,?,?,?)",
                    correction,
                    i,
                    error.row() == 0 ? null : error.row(),
                    error.column(),
                    "INVALID_SELF",
                    error.reason());
              }
            }
            List<Object[]> reportValues = new ArrayList<>();
            for (TransactionRow row : rows) {
              TransactionRow protectedRow =
                  new TransactionRow(
                      row.fileRow(),
                      row.occurredAt(),
                      row.fromBank(),
                      row.fromAccount(),
                      row.toBank(),
                      row.toAccount(),
                      row.amountReceived(),
                      row.receivingCurrency(),
                      row.amountPaid(),
                      row.paymentCurrency(),
                      row.paymentFormat(),
                      null,
                      row.rowHash(),
                      row.fromBankName(),
                      row.toBankName(),
                      row.fromEntityId(),
                      row.fromEntityName(),
                      row.toEntityId(),
                      row.toEntityName());
              reportValues.add(
                  new Object[] {
                    version,
                    row.fileRow(),
                    protector.token("match", ReportMatcher.key(row).toString()),
                    protector.encrypt(
                        "report:" + version + ":" + row.fileRow(),
                        mapper.writeValueAsString(protectedRow)),
                    protector.version(),
                    errors.isEmpty() ? "WAITING" : "HELD",
                    errors.isEmpty() ? null : "INVALID_SELF"
                  });
            }
            jdbc.batchUpdate(
                "insert into"
                    + " private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status,error_code)"
                    + " values(?,?,?,?,?,?,?)",
                reportValues,
                500,
                (ps, a) -> {
                  for (int i = 0; i < a.length; i++) ps.setObject(i + 1, a[i]);
                });
            List<Object[]> labels =
                rows.stream()
                    .filter(r -> r.isLaundering() != null)
                    .map(r -> new Object[] {r.isLaundering(), version, r.fileRow()})
                    .toList();
            jdbc.batchUpdate(
                "insert into evaluation.report_labels(report_id,is_laundering) select report_id,?"
                    + " from private.bank_reports where version_id=? and source_row=?",
                labels,
                500,
                (ps, a) -> {
                  ps.setBoolean(1, (Boolean) a[0]);
                  ps.setLong(2, (Long) a[1]);
                  ps.setInt(3, (Integer) a[2]);
                });
            job.setStatus(errors.isEmpty() ? JobStatus.COMPLETED : JobStatus.VALIDATION_FAILED);
            job.setRowCount(preparedCount);
            job.setMissingCount(preparedMissing);
            job.setDuplicateCount(0);
            job.setFinishedAt(java.time.Instant.now());
            job.setErrorCode(errors.isEmpty() ? null : "VALIDATION_FAILED");
            job.setErrorMessage(errors.isEmpty() ? null : "파일 전체가 보류되었습니다.");
            job.setValidationErrors(mapper.writeValueAsString(errors));
            jobs.saveAndFlush(job);
          });
    } catch (RuntimeException e) {
      // Exception messages and stack traces can contain SQL parameters or source data.
      String reason =
          switch (String.valueOf(e.getMessage())) {
            case "PRIVATE_DATA_KEYS_REQUIRED",
                "PRIVATE_DATA_KEY_INVALID",
                "REPORT_READ_FAILED",
                "REPORT_FORMAT_NOT_CONFIGURED" ->
                e.getMessage();
            default -> "LOAD_FAILED";
          };
      log.error(
          "Report load failed uploadId={} reason={} exceptionType={}",
          id,
          reason,
          e.getClass().getName());
      tx.executeWithoutResult(
          status -> {
            BatchJob job = jobs.findById(id).orElseThrow();
            if (jdbc.queryForObject(
                    "select count(*) from report_versions where upload_id=?", Integer.class, id)
                > 0) return;
            job.setStatus(JobStatus.FAILED);
            job.setErrorCode("LOAD_FAILED");
            job.setErrorMessage("보고 저장 실패. 관리자 확인이 필요합니다.");
            job.setFinishedAt(java.time.Instant.now());
            jobs.saveAndFlush(job);
          });
    }
  }

  private CsvTransactionReader readerForBank(int bank, BufferedReader reader) throws IOException {
    String format =
        jdbc.queryForObject(
            "select report_format from banks where bank_id=? and is_reporting", String.class, bank);
    if (!"AML17".equals(format)) throw new IllegalStateException("REPORT_FORMAT_NOT_CONFIGURED");
    return new CsvTransactionReader(reader, zone);
  }

  private static void add(List<ValidationError> errors, ValidationError error) {
    if (errors.size() < 100) errors.add(error);
  }
}
