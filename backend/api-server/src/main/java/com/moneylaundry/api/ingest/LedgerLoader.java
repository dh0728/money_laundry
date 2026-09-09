package com.moneylaundry.api.ingest;

import com.moneylaundry.api.bank.BankReference;
import com.moneylaundry.api.batchjob.BatchJob;
import com.moneylaundry.api.batchjob.BatchJobRepository;
import com.moneylaundry.api.batchjob.JobStatus;
import com.moneylaundry.api.storage.UploadStore;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * INGEST 작업의 적재기(kickoff §4.5 17차 결정 A — Java 단일 경로). 1차 통과: 전 행 검증·중복 판별·계좌 수집(오류가 하나라도 있으면 아무것도
 * 넣지 않음). 2차 통과: 은행·계좌 upsert 뒤 원장 삽입과 COMPLETED 상태를 한 트랜잭션으로 커밋한다. 실패 상태는 롤백 후 따로 커밋한다.
 */
@Slf4j
@Service
public class LedgerLoader {

  private static final int CHUNK = 1000;
  private static final int MAX_ERRORS = 100;

  private record Loaded(int rowCount) {}

  private record AccountKey(int bankId, String accountNumber) {}

  private final BatchJobRepository batchJobRepository;
  private final UploadStore uploadStore;
  private final Pseudonymizer pseudonymizer;
  private final BankReference bankReference;
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final ObjectMapper objectMapper;
  private final String fxRateVersion;
  private final ZoneId zone;

  public LedgerLoader(
      BatchJobRepository batchJobRepository,
      UploadStore uploadStore,
      Pseudonymizer pseudonymizer,
      BankReference bankReference,
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      ObjectMapper objectMapper,
      @Value("${app.ingest.fx-rate-version}") String fxRateVersion,
      @Value("${app.zone}") String zone) {
    this.batchJobRepository = batchJobRepository;
    this.uploadStore = uploadStore;
    this.pseudonymizer = pseudonymizer;
    this.bankReference = bankReference;
    this.jdbc = jdbc;
    this.tx = tx;
    this.objectMapper = objectMapper;
    this.fxRateVersion = fxRateVersion;
    this.zone = ZoneId.of(zone);
  }

  @Async
  public void load(long jobId) {
    BatchJob job = batchJobRepository.findById(jobId).orElseThrow();
    job.setStatus(JobStatus.RUNNING);
    job.setStartedAt(Instant.now());
    job.setAttemptCount(job.getAttemptCount() + 1);
    batchJobRepository.save(job);
    log.info("적재 시작 uploadId={} bankId={} file={}", jobId, job.getBankId(), job.getFileName());
    try {
      tx.executeWithoutResult(
          status -> {
            Loaded loaded = loadAll(job);
            job.setStatus(JobStatus.COMPLETED);
            job.setRowCount(loaded.rowCount());
            job.setMissingCount(0);
            job.setDuplicateCount(0);
            job.setFinishedAt(Instant.now());
            batchJobRepository.saveAndFlush(job);
          });
      log.info("적재 완료 uploadId={} rows={}", jobId, job.getRowCount());
      return;
    } catch (ValidationFailedException e) {
      job.setStatus(JobStatus.VALIDATION_FAILED);
      job.setErrorCode("VALIDATION_FAILED");
      job.setErrorMessage(e.getMessage());
      job.setMissingCount(e.missingCount());
      job.setRowCount(e.rowCount());
      job.setDuplicateCount(e.duplicateCount());
      job.setValidationErrors(objectMapper.writeValueAsString(e.errors()));
      log.warn("검증 실패 uploadId={} errors={}", jobId, e.errors().size());
    } catch (RuntimeException e) {
      job.setStatus(JobStatus.FAILED);
      job.setErrorCode("LOAD_FAILED");
      job.setRowCount(null);
      job.setErrorMessage("서버 적재 중 오류가 발생했습니다. 관리자에게 문의하세요.");
      log.error("적재 실패 uploadId={}", jobId, e);
    }
    job.setFinishedAt(Instant.now());
    batchJobRepository.save(job);
  }

  private Loaded loadAll(BatchJob job) {
    try {
      if (job.getBusinessDate() == null)
        throw new ValidationFailedException(
            List.of(new ValidationError(0, "businessDate", "거래 기준일이 필요합니다. 기준일을 지정해 재업로드하세요.")), 0);
      jdbc.query(
          "select pg_advisory_xact_lock(17001, ?)", ps -> ps.setInt(1, job.getBankId()), rs -> {});
      Map<String, BigDecimal> unitsPerUsd = loadFxRates();
      // 1차 통과: 검증·중복·계좌 수집
      List<ValidationError> errors = new ArrayList<>();
      int missing = 0;
      int rowCount = 0;
      int duplicateInFile = 0;
      Set<String> hashes = new HashSet<>();
      Map<String, Integer> fileRows = new HashMap<>();
      Set<AccountKey> accounts = new HashSet<>();
      try (BufferedReader reader = open(job.getS3Key())) {
        CsvTransactionReader csv = new CsvTransactionReader(reader, pseudonymizer, zone);
        while (true) {
          try {
            TransactionRow row = csv.next();
            if (row == null) {
              break;
            }
            rowCount++;
            if (!unitsPerUsd.containsKey(row.paymentCurrency()) && errors.size() < MAX_ERRORS) {
              errors.add(
                  new ValidationError(
                      row.fileRow(), "Payment Currency", "환율 없음: " + row.paymentCurrency()));
            }
            if (!hashes.add(row.rowHash())) {
              duplicateInFile++;
              if (errors.size() < MAX_ERRORS)
                errors.add(new ValidationError(row.fileRow(), "", "파일 내부 중복 거래"));
            }
            fileRows.putIfAbsent(row.rowHash(), row.fileRow());
            if (!row.occurredAt().atZone(zone).toLocalDate().equals(job.getBusinessDate())
                && errors.size() < MAX_ERRORS) {
              errors.add(new ValidationError(row.fileRow(), "Timestamp", "거래 기준일과 일치하지 않음"));
            }
            accounts.add(new AccountKey(row.fromBank(), row.fromAccount()));
            accounts.add(new AccountKey(row.toBank(), row.toAccount()));
          } catch (CsvTransactionReader.RowException e) {
            rowCount++;
            if (e.missing()) {
              missing++;
            }
            if (errors.size() < MAX_ERRORS) {
              errors.add(e.error());
            }
          }
        }
      }
      int duplicateInLedger = 0;
      List<String> allHashes = new ArrayList<>(hashes);
      for (int from = 0; from < allHashes.size(); from += CHUNK) {
        String[] part =
            allHashes
                .subList(from, Math.min(from + CHUNK, allHashes.size()))
                .toArray(String[]::new);
        List<String> existing =
            jdbc.query(
                "select row_hash from transactions where bank_id = ? and row_hash = any (?::text[])",
                ps -> {
                  ps.setInt(1, job.getBankId());
                  ps.setArray(2, ps.getConnection().createArrayOf("text", part));
                },
                (rs, n) -> rs.getString(1));
        duplicateInLedger += existing.size();
        for (String hash : existing) {
          if (errors.size() < MAX_ERRORS)
            errors.add(new ValidationError(fileRows.get(hash), "", "원장에 이미 존재하는 거래"));
        }
      }
      if (rowCount == 0) {
        errors.add(new ValidationError(1, "", "데이터 행 없음"));
      }
      if (!errors.isEmpty()) {
        throw new ValidationFailedException(
            errors, missing, rowCount, duplicateInFile + duplicateInLedger);
      }
      // 2차 통과: 은행·계좌 upsert → 배치 삽입
      upsertBanks(accounts);
      Map<AccountKey, Long> accountIds = upsertAccounts(accounts);
      int inserted = 0;
      hashes.clear();
      try (BufferedReader reader = open(job.getS3Key())) {
        CsvTransactionReader csv = new CsvTransactionReader(reader, pseudonymizer, zone);
        List<TransactionRow> chunk = new ArrayList<>(CHUNK);
        while (true) {
          TransactionRow row = csv.next();
          if (row == null || chunk.size() == CHUNK) {
            inserted += insertChunk(job, chunk, accountIds, unitsPerUsd, csv.hasLabelColumn());
            chunk.clear();
            if (row == null) {
              break;
            }
          }
          if (hashes.add(row.rowHash())) {
            chunk.add(row);
          }
        }
      }
      if (inserted != rowCount) throw new IllegalStateException("원장 삽입 행 수 불일치");
      return new Loaded(rowCount);
    } catch (org.springframework.dao.DuplicateKeyException e) {
      throw new ValidationFailedException(
          List.of(new ValidationError(0, "", "동시에 등록된 중복 거래: 파일을 확인하세요.")), 0);
    } catch (IOException e) {
      throw new IllegalStateException("파일 읽기 실패: " + e.getMessage(), e);
    } catch (CsvTransactionReader.RowException e) {
      throw new IllegalStateException("1차 통과에서 잡히지 않은 행 오류", e);
    }
  }

  private BufferedReader open(String key) throws IOException {
    return new BufferedReader(new InputStreamReader(uploadStore.open(key), StandardCharsets.UTF_8));
  }

  private Map<String, BigDecimal> loadFxRates() {
    Map<String, BigDecimal> rates = new HashMap<>();
    jdbc.query(
        "select currency, units_per_usd from fx_rates where fx_rate_version = ?",
        rs -> {
          rates.put(rs.getString(1).trim(), rs.getBigDecimal(2));
        },
        fxRateVersion);
    if (rates.isEmpty()) {
      throw new IllegalStateException("환율 버전 없음: " + fxRateVersion);
    }
    return rates;
  }

  private void upsertBanks(Set<AccountKey> accounts) {
    Set<Integer> bankIds = new java.util.TreeSet<>();
    for (AccountKey key : accounts) {
      bankIds.add(key.bankId());
    }
    List<Object[]> args = new ArrayList<>();
    for (int bankId : bankIds) {
      BankReference.Entry ref = bankReference.find(bankId).orElse(null);
      args.add(
          new Object[] {
            bankId, ref == null ? null : ref.name(), ref == null ? null : ref.country()
          });
    }
    jdbc.batchUpdate(
        "insert into banks (bank_id, name, country) values (?, ?, ?)"
            + " on conflict (bank_id) do update set"
            + " name = coalesce(banks.name, excluded.name),"
            + " country = coalesce(banks.country, excluded.country),"
            + " updated_at = now()",
        args,
        CHUNK,
        (ps, a) -> {
          ps.setInt(1, (Integer) a[0]);
          ps.setString(2, (String) a[1]);
          ps.setString(3, (String) a[2]);
        });
  }

  private Map<AccountKey, Long> upsertAccounts(Set<AccountKey> accounts) {
    List<AccountKey> keys =
        accounts.stream()
            .sorted(
                java.util.Comparator.comparingInt(AccountKey::bankId)
                    .thenComparing(AccountKey::accountNumber))
            .toList();
    jdbc.batchUpdate(
        "insert into accounts (bank_id, account_number) values (?, ?) on conflict do nothing",
        keys,
        CHUNK,
        (ps, k) -> {
          ps.setInt(1, k.bankId());
          ps.setString(2, k.accountNumber());
        });
    Map<AccountKey, Long> ids = new HashMap<>(keys.size() * 2);
    for (int from = 0; from < keys.size(); from += CHUNK) {
      List<AccountKey> part = keys.subList(from, Math.min(from + CHUNK, keys.size()));
      Integer[] banks = part.stream().map(AccountKey::bankId).toArray(Integer[]::new);
      String[] numbers = part.stream().map(AccountKey::accountNumber).toArray(String[]::new);
      jdbc.query(
          "select a.account_id, a.bank_id, a.account_number from accounts a"
              + " join unnest(?::int[], ?::text[]) as u(b, n)"
              + " on a.bank_id = u.b and a.account_number = u.n",
          ps -> {
            ps.setArray(1, ps.getConnection().createArrayOf("integer", banks));
            ps.setArray(2, ps.getConnection().createArrayOf("text", numbers));
          },
          rs -> {
            ids.put(new AccountKey(rs.getInt(2), rs.getString(3)), rs.getLong(1));
          });
    }
    return ids;
  }

  private int insertChunk(
      BatchJob job,
      List<TransactionRow> rows,
      Map<AccountKey, Long> accountIds,
      Map<String, BigDecimal> unitsPerUsd,
      boolean withLabels) {
    if (rows.isEmpty()) {
      return 0;
    }
    int[][] counts =
        jdbc.batchUpdate(
            "insert into transactions (bank_id, occurred_at, from_account_id, to_account_id,"
                + " amount_received, receiving_currency, amount_paid, payment_currency,"
                + " payment_format, amount_usd, fx_rate_version, row_hash, ingest_job_id)"
                + " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
            rows.size(),
            (ps, r) -> {
              ps.setInt(1, job.getBankId());
              ps.setTimestamp(2, Timestamp.from(r.occurredAt()));
              ps.setLong(3, accountIds.get(new AccountKey(r.fromBank(), r.fromAccount())));
              ps.setLong(4, accountIds.get(new AccountKey(r.toBank(), r.toAccount())));
              ps.setBigDecimal(5, r.amountReceived());
              ps.setString(6, r.receivingCurrency());
              ps.setBigDecimal(7, r.amountPaid());
              ps.setString(8, r.paymentCurrency());
              ps.setString(9, r.paymentFormat());
              ps.setBigDecimal(
                  10,
                  r.amountPaid()
                      .divide(unitsPerUsd.get(r.paymentCurrency()), 6, RoundingMode.HALF_UP));
              ps.setString(11, fxRateVersion);
              ps.setString(12, r.rowHash());
              ps.setLong(13, job.getId());
            });
    int inserted = 0;
    for (int[] batch : counts) {
      for (int count : batch) {
        inserted += count;
      }
    }
    if (withLabels) {
      insertLabels(job.getBankId(), rows);
    }
    return inserted;
  }

  /** 평가 스키마에만 적재(API.md §1.4). 라벨이 비어 있는 행은 건너뛴다. */
  private void insertLabels(int bankId, List<TransactionRow> rows) {
    List<TransactionRow> labeled = rows.stream().filter(r -> r.isLaundering() != null).toList();
    if (labeled.isEmpty()) {
      return;
    }
    String[] hashes = labeled.stream().map(TransactionRow::rowHash).toArray(String[]::new);
    Boolean[] labels = labeled.stream().map(TransactionRow::isLaundering).toArray(Boolean[]::new);
    jdbc.update(
        "insert into evaluation.transaction_labels (tx_id, is_laundering)"
            + " select t.tx_id, u.lab from unnest(?::text[], ?::boolean[]) as u(h, lab)"
            + " join transactions t on t.bank_id = ? and t.row_hash = u.h"
            + " on conflict (tx_id) do nothing",
        ps -> {
          ps.setArray(1, ps.getConnection().createArrayOf("text", hashes));
          ps.setArray(2, ps.getConnection().createArrayOf("boolean", labels));
          ps.setInt(3, bankId);
        });
  }
}
