package com.moneylaundry.api.upload;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.*;
import com.moneylaundry.api.analysis.*;
import com.moneylaundry.api.ingest.*;
import com.moneylaundry.api.storage.*;
import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Real PostgreSQL with byte-preserving storage double. No real S3 connection is claimed. */
@SpringBootTest(properties = "spring.profiles.active=local")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class BankUploadApiTests {
  static final LocalDate DATE = LocalDate.of(2026, 9, 15);
  static final String HEADER =
      "Timestamp,From Bank,From Account,To Bank,To Account,Amount Received,Receiving"
          + " Currency,Amount Paid,Payment Currency,Payment Format,From Bank Name,To Bank Name,From"
          + " Entity ID,From Entity Name,To Entity ID,To Entity Name,Is Laundering\n";

  static String secret() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getEncoder().encodeToString(bytes);
  }

  static final String ENC = secret(), SEARCH = secret();

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) {
    r.add("app.ingest.encryption-key", () -> ENC);
    r.add("app.ingest.search-key", () -> SEARCH);
    r.add("app.ingest.key-version", () -> "test");
  }

  @Autowired JdbcTemplate jdbc;
  @Autowired UploadService service;
  @Autowired TransactionIntegrationService integration;
  @Autowired PrivateDataProtector protector;
  @Autowired MockMvc mvc;
  @MockitoBean UploadStore store;
  @MockitoBean AnalysisScheduler scheduler;
  Map<String, byte[]> files = new ConcurrentHashMap<>();

  @BeforeEach
  void setup() throws Exception {
    reset(store);
    files.clear();
    jdbc.execute(
        "truncate banks,batch_jobs,private.entities,reporting_scopes,integration_attempts restart"
            + " identity cascade");
    for (int bank : new int[] {10, 20, 30}) {
      jdbc.update("insert into banks(bank_id,is_reporting) values(?,true)", bank);
      jdbc.update(
          "insert into bank_reporting_periods(bank_id,effective_from_date,effective_to_date)"
              + " values(?,?,?)",
          bank,
          DATE.minusDays(1),
          DATE.plusDays(1));
    }
    when(store.issue(anyString(), any(), anyString()))
        .thenAnswer(i -> new UploadTarget(i.getArgument(0), "PUT", Map.of()));
    when(store.open(anyString()))
        .thenAnswer(i -> new ByteArrayInputStream(files.get(i.getArgument(0))));
    when(store.sizeOf(anyString()))
        .thenAnswer(
            i ->
                files.containsKey(i.getArgument(0))
                    ? OptionalLong.of(files.get(i.getArgument(0)).length)
                    : OptionalLong.empty());
    when(store.checksumOf(anyString())).thenAnswer(i -> digest(files.get(i.getArgument(0))));
  }

  static String digest(byte[] bytes) throws Exception {
    return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes));
  }

  static String row(
      int from,
      String a,
      int to,
      String b,
      String received,
      String rc,
      String paid,
      String pc,
      String format,
      String e1,
      String e2) {
    return "2026/09/15 12:00,"
        + from
        + ","
        + a
        + ","
        + to
        + ","
        + b
        + ","
        + received
        + ","
        + inputCurrency(rc)
        + ","
        + paid
        + ","
        + inputCurrency(pc)
        + ","
        + format
        + ",Bank"
        + from
        + ",Bank"
        + to
        + ","
        + e1
        + ",Name"
        + e1
        + ","
        + e2
        + ",Name"
        + e2
        + ",0\n";
  }

  static String inputCurrency(String iso) {
    return Map.of("USD", "US Dollar", "EUR", "Euro", "JPY", "Yen").get(iso);
  }

  long submit(int bank, String csv) throws Exception {
    return submit(bank, csv.getBytes(StandardCharsets.UTF_8));
  }

  long submit(int bank, byte[] bytes) throws Exception {
    var issued =
        service.issue(
            bank,
            new IssueUploadRequest(UUID.randomUUID() + ".csv", bytes.length, digest(bytes), DATE));
    String key =
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, issued.uploadId());
    files.put(key, bytes);
    assertThat(service.complete(bank, issued.uploadId()).status().name()).isEqualTo("RECEIVED");
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
    while (System.nanoTime() < deadline) {
      String state = service.status(bank, issued.uploadId()).status().name();
      if (Set.of("COMPLETED", "VALIDATION_FAILED", "FAILED").contains(state))
        return issued.uploadId();
      Thread.sleep(20);
    }
    throw new AssertionError("ingestion timeout");
  }

  TransactionIntegrationService.Outcome integrate(long... ids) {
    Set<Long> values = new HashSet<>();
    for (long id : ids) values.add(id);
    return integration.integrate(DATE, Instant.now().plusSeconds(1), values);
  }

  int count(String table) {
    return jdbc.queryForObject("select count(*) from " + table, Integer.class);
  }

  @Test
  void independent_source_multiset_restores_counts_amounts_and_relationships() throws Exception {
    String ach = row(10, "A", 20, "B", "100", "USD", "100", "USD", "ACH", "E1", "E2");
    String wire = ach.replace(",ACH,", ",Wire,");
    String cross = row(20, "C", 30, "D", "11", "USD", "10", "EUR", "ACH", "E1", "E3");
    String internal = row(10, "A", 10, "Z", "5", "USD", "5", "USD", "ACH", "E1", "E4");
    String externalIn = row(40, "X", 20, "B", "2", "JPY", "2", "JPY", "ACH", "E5", "E2");
    String externalOut = row(20, "B", 50, "Y", "3.5", "EUR", "3.5", "EUR", "ACH", "E2", "E6");
    long a = submit(10, HEADER + ach + wire + ach + internal),
        b = submit(20, HEADER + wire + ach + cross + ach + externalIn + externalOut),
        c = submit(30, HEADER + cross);
    assertThat(count("transactions")).isZero();
    assertThat(service.status(10, a).integrationStatus())
        .isEqualTo("VALIDATED_WAITING_INTEGRATION");
    assertThat(integrate(a, b, c).transactions()).isEqualTo(7);
    assertThat(count("private.bank_reports")).isEqualTo(11);
    assertThat(count("transaction_reports")).isEqualTo(11);
    assertThat(count("private.accounts")).isEqualTo(7);
    assertThat(count("private.entities")).isEqualTo(6);
    assertAmounts(
        "amount_paid", "payment_currency", Map.of("USD", "305", "EUR", "13.5", "JPY", "2"));
    assertAmounts(
        "amount_received", "receiving_currency", Map.of("USD", "316", "EUR", "3.5", "JPY", "2"));
    long e1 =
        jdbc.queryForObject(
            "select entity_id from private.entities where entity_lookup_token=?",
            Long.class,
            protector.token("entity", "E1"));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from private.accounts where entity_id=?", Integer.class, e1))
        .isEqualTo(2);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transactions t join private.accounts f on"
                    + " f.account_id=t.from_account_id join private.accounts r on"
                    + " r.account_id=t.to_account_id where f.account_lookup_token=? and"
                    + " r.account_lookup_token=?",
                Integer.class,
                protector.token("account", "10", "A"),
                protector.token("account", "20", "B")))
        .isEqualTo(3);
    List<String> relationships =
        jdbc.query(
            "select f.bank_id as fb,f.identity_cipher as fc,f.key_version as fv,fe.identity_cipher"
                + " as fec,fe.key_version as fev,r.bank_id as rb,r.identity_cipher as"
                + " rc,r.key_version as rv,re.identity_cipher as rec,re.key_version as"
                + " rev,t.payment_format from transactions t join private.accounts f on"
                + " f.account_id=t.from_account_id join private.entities fe on"
                + " fe.entity_id=f.entity_id join private.accounts r on"
                + " r.account_id=t.to_account_id join private.entities re on"
                + " re.entity_id=r.entity_id",
            (rs, n) ->
                rs.getInt("fb")
                    + ":"
                    + protector.decrypt(
                        "account:" + rs.getInt("fb"), rs.getString("fc"), rs.getString("fv"))
                    + ":"
                    + protector.decrypt("entity-id", rs.getString("fec"), rs.getString("fev"))
                    + ">"
                    + rs.getInt("rb")
                    + ":"
                    + protector.decrypt(
                        "account:" + rs.getInt("rb"), rs.getString("rc"), rs.getString("rv"))
                    + ":"
                    + protector.decrypt("entity-id", rs.getString("rec"), rs.getString("rev"))
                    + ":"
                    + rs.getString("payment_format"));
    assertThat(relationships)
        .containsExactlyInAnyOrder(
            "10:A:E1>20:B:E2:ACH",
            "10:A:E1>20:B:E2:ACH",
            "10:A:E1>20:B:E2:Wire",
            "20:C:E1>30:D:E3:ACH",
            "10:A:E1>10:Z:E4:ACH",
            "40:X:E5>20:B:E2:ACH",
            "20:B:E2>50:Y:E6:ACH");
    var ids =
        jdbc.queryForList(
            "select service_account_id from private.accounts order by account_id", UUID.class);
    assertThat(integrate(a, b, c).transactions()).isEqualTo(7);
    assertThat(count("transactions")).isEqualTo(7);
    assertThat(
            jdbc.queryForList(
                "select service_account_id from private.accounts order by account_id", UUID.class))
        .isEqualTo(ids);
    assertThat(jdbc.queryForList("select payload_cipher from private.bank_reports", String.class))
        .allMatch(v -> !v.contains("NameE"));
    mvc.perform(get("/api/uploads/{id}", a)).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/bank/uploads/{id}", a).header("X-Bank-Id", 20))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/bank/uploads/{id}", a).header("X-Bank-Id", 10))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.integrationStatus").value("ACTIVE"));
  }

  void assertAmounts(String amount, String currency, Map<String, String> expected) {
    var actual =
        jdbc.queryForList(
            "select trim("
                + currency
                + ") as currency,sum("
                + amount
                + ") as amount from transactions group by "
                + currency);
    assertThat(actual).hasSize(expected.size());
    for (var item : actual)
      assertThat((BigDecimal) item.get("amount"))
          .isEqualByComparingTo(expected.get(item.get("currency")));
  }

  @Test
  void old_header_invalid_utf8_missing_and_unrelated_bank_hold_whole_file() throws Exception {
    String valid = row(10, "A", 40, "B", "1", "USD", "1", "USD", "ACH", "E1", "E2");
    for (byte[] content :
        List.of(
            "Timestamp,From Bank,Account\n2026/09/15,10,A\n".getBytes(StandardCharsets.UTF_8),
            (HEADER + valid + valid.replace(",E1,", ",,")).getBytes(StandardCharsets.UTF_8),
            (HEADER + valid.replace("10,A,40,B", "20,A,40,B")).getBytes(StandardCharsets.UTF_8),
            (HEADER + valid.replace(",A,", ",A\"oops,")).getBytes(StandardCharsets.UTF_8),
            new byte[] {(byte) 0xc3, 0x28})) {
      // Separate dates/sets are unnecessary: invalid submissions use a fresh reporting bank DB
      // fixture.
      setup();
      long id = submit(10, content);
      assertThat(service.status(10, id).status().name()).isEqualTo("VALIDATION_FAILED");
      assertThat(service.status(10, id).integrationStatus()).isEqualTo("HELD");
      String text = new String(content, StandardCharsets.UTF_8);
      if (content.length == 2 || text.contains("Account\n") || text.contains("oops")) {
        assertThat(service.status(10, id).rowCount()).isNull();
        assertThat(service.status(10, id).errors()).noneMatch(e -> e.reason().equals("EMPTY_FILE"));
      }
      assertThat(count("transactions")).isZero();
      assertThat(count("private.entities")).isZero();
      assertThat(count("private.accounts")).isZero();
    }
  }

  @Test
  void identity_conflict_holds_both_files_without_first_arrival_winner() throws Exception {
    String a = row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2");
    String b =
        row(20, "B", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2").replace("NameE1", "Other");
    long x = submit(10, HEADER + a), y = submit(20, HEADER + b);
    assertThat(integrate(y, x).heldFiles()).isEqualTo(2);
    assertThat(count("transactions")).isZero();
    assertThat(count("private.entities")).isZero();
  }

  @Test
  void broken_file_only_blocks_dependent_rows_of_other_file() throws Exception {
    String ab = row(10, "A", 20, "B", "1", "USD", "1", "USD", "ACH", "E1", "E2");
    String bc = row(20, "B", 30, "C", "2", "USD", "2", "USD", "ACH", "E2", "E3");
    long a = submit(10, HEADER + ab + ab.replace(",E1,", ",,")),
        b = submit(20, HEADER + ab + bc),
        c = submit(30, HEADER + bc);
    var result = integrate(a, b, c);
    assertThat(result.transactions()).isEqualTo(1);
    assertThat(result.heldFiles()).isEqualTo(1);
    assertThat(result.dependentReports()).isEqualTo(1);
    assertThat(service.status(20, b).integrationStatus()).isEqualTo("PARTIALLY_HELD");
    assertThat(count("private.accounts")).isEqualTo(2);
  }

  @Test
  void failure_rolls_back_identity_transaction_and_version_state_then_retry_is_exact()
      throws Exception {
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    jdbc.execute(
        "create function fail_integration_test() returns trigger language plpgsql as $$ begin raise"
            + " exception 'test failure'; end $$");
    jdbc.execute(
        "create trigger fail_integration_test before insert on transactions for each row execute"
            + " function fail_integration_test()");
    try {
      assertThatThrownBy(() -> integrate(a)).isInstanceOf(RuntimeException.class);
      assertThat(count("transactions")).isZero();
      assertThat(count("private.entities")).isZero();
      assertThat(count("integration_attempts")).isZero();
      assertThat(service.status(10, a).integrationStatus())
          .isEqualTo("VALIDATED_WAITING_INTEGRATION");
    } finally {
      jdbc.execute("drop trigger fail_integration_test on transactions");
      jdbc.execute("drop function fail_integration_test()");
    }
    assertThat(integrate(a).transactions()).isEqualTo(1);
  }

  @Test
  void concurrent_confirmation_has_one_atomic_result() throws Exception {
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    try (var pool = Executors.newFixedThreadPool(2)) {
      var f = pool.submit(() -> integrate(a));
      var g = pool.submit(() -> integrate(a));
      assertThat(f.get(20, TimeUnit.SECONDS).transactions()).isEqualTo(1);
      assertThat(g.get(20, TimeUnit.SECONDS).transactions()).isEqualTo(1);
    }
    assertThat(count("transactions")).isEqualTo(1);
    assertThat(count("integration_attempts")).isEqualTo(1);
  }

  @Test
  void unregistered_bank_and_cutoff_violation_do_not_mutate() throws Exception {
    assertThatThrownBy(
            () ->
                service.issue(99, new IssueUploadRequest("x.csv", 1, digest(new byte[] {1}), DATE)))
        .isInstanceOf(ApiException.class);
    assertThat(count("batch_jobs")).isZero();
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    assertThatThrownBy(() -> integration.integrate(DATE, Instant.EPOCH, Set.of(a)))
        .isInstanceOf(IllegalStateException.class);
    assertThat(count("transactions")).isZero();
    assertThat(count("reporting_scopes")).isZero();
  }

  @Test
  void empty_frozen_scope_is_not_recomputed_from_later_registration() throws Exception {
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    jdbc.update("insert into reporting_scopes(business_date,scope_revision) values(?,7)", DATE);
    assertThatThrownBy(() -> integrate(a))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("REPORT_OUTSIDE_SCOPE");
    assertThat(count("reporting_scope_banks")).isZero();
    assertThat(count("transactions")).isZero();
    assertThat(
            jdbc.queryForObject(
                "select scope_revision from reporting_scopes where business_date=?",
                Long.class,
                DATE))
        .isEqualTo(7);
  }

  @Test
  void analysis_does_not_report_empty_success_or_start_features_for_staged_reports()
      throws Exception {
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    Clock clock = Clock.fixed(Instant.now().plusSeconds(1), ZoneId.of("Asia/Seoul"));
    var analysis =
        new AnalysisService(
            jdbc,
            new org.springframework.transaction.support.TransactionTemplate(transactionManager),
            clock,
            "Asia/Seoul",
            0.7,
            LocalTime.of(3, 0));
    long job = analysis.registerNow();
    // registerNow fixes all current receipts; the staged report is a required input.
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_uploads where job_id=? and upload_id=?",
                Integer.class,
                job,
                a))
        .isEqualTo(1);
    var executor = mock(AnalysisStageExecutor.class);
    try (var runner = new AnalysisRunner(analysis, executor)) {
      runner.scan();
    }
    verifyNoInteractions(executor);
    assertThat(
            jdbc.queryForObject("select status from batch_jobs where job_id=?", String.class, job))
        .isEqualTo("FAILED");
    assertThat(
            jdbc.queryForObject(
                "select error_code from batch_jobs where job_id=?", String.class, job))
        .isEqualTo("INTEGRATION_NOT_CONNECTED");
  }

  @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;

  @Test
  void same_number_different_banks_and_next_day_uuid_reuse() throws Exception {
    String value = row(10, "001", 40, "001", "1", "USD", "1", "USD", "ACH", "E1", "E1");
    long a = submit(10, HEADER + value);
    integrate(a);
    assertThat(count("private.accounts")).isEqualTo(2);
    assertThat(count("private.entities")).isEqualTo(1);
    var before =
        jdbc.queryForList(
            "select service_account_id from private.accounts order by account_id", UUID.class);
    var bytes =
        (HEADER + value.replace("2026/09/15", "2026/09/16")).getBytes(StandardCharsets.UTF_8);
    var issued =
        service.issue(
            10, new IssueUploadRequest("next.csv", bytes.length, digest(bytes), DATE.plusDays(1)));
    String key =
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, issued.uploadId());
    files.put(key, bytes);
    service.complete(10, issued.uploadId());
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
    while (System.nanoTime() < deadline
        && !service.status(10, issued.uploadId()).status().name().equals("COMPLETED"))
      Thread.sleep(20);
    integration.integrate(
        DATE.plusDays(1), Instant.now().plusSeconds(1), Set.of(issued.uploadId()));
    assertThat(count("transactions")).isEqualTo(2);
    assertThat(
            jdbc.queryForList(
                "select service_account_id from private.accounts order by account_id", UUID.class))
        .isEqualTo(before);
  }

  @Test
  void existing_normal_ownership_is_not_overwritten_by_bad_next_day_report() throws Exception {
    String value = row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2");
    long a = submit(10, HEADER + value);
    integrate(a);
    var before =
        jdbc.queryForList(
            "select service_account_id,entity_id,identity_cipher from private.accounts order by"
                + " account_id");
    byte[] bytes =
        (HEADER + value.replace("2026/09/15", "2026/09/16").replace("NameE1", "Other"))
            .getBytes(StandardCharsets.UTF_8);
    var issued =
        service.issue(
            10,
            new IssueUploadRequest("conflict.csv", bytes.length, digest(bytes), DATE.plusDays(1)));
    String key =
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, issued.uploadId());
    files.put(key, bytes);
    service.complete(10, issued.uploadId());
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
    while (System.nanoTime() < deadline
        && !service.status(10, issued.uploadId()).status().name().equals("COMPLETED"))
      Thread.sleep(20);
    assertThat(
            integration
                .integrate(
                    DATE.plusDays(1), Instant.now().plusSeconds(1), Set.of(issued.uploadId()))
                .heldFiles())
        .isEqualTo(1);
    assertThat(count("transactions")).isEqualTo(1);
    assertThat(
            jdbc.queryForList(
                "select service_account_id,entity_id,identity_cipher from private.accounts order by"
                    + " account_id"))
        .isEqualTo(before);
  }

  @Test
  void directly_held_file_overrides_dependency_count_and_retry_matches() throws Exception {
    String ab = row(10, "A", 20, "B", "1", "USD", "1", "USD", "ACH", "E1", "E2");
    String bc = row(20, "B", 30, "C", "2", "USD", "2", "USD", "ACH", "E2", "E3");
    long a = submit(10, HEADER + ab + ab.replace(",E1,", ",,")), b = submit(20, HEADER + ab + bc);
    var first = integrate(a, b);
    assertThat(first.heldFiles()).isEqualTo(2);
    assertThat(first.dependentReports()).isZero();
    assertThat(first.transactions()).isZero();
    assertThat(integrate(a, b)).isEqualTo(first);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from private.bank_reports where report_status='DEPENDENCY_HELD'",
                Integer.class))
        .isZero();
  }

  @Test
  void missing_key_and_tampered_report_fail_without_partial_confirmation() throws Exception {
    long a = submit(10, HEADER + row(10, "A", 40, "X", "1", "USD", "1", "USD", "ACH", "E1", "E2"));
    var noKeys =
        new TransactionIntegrationService(
            jdbc,
            new org.springframework.transaction.support.TransactionTemplate(transactionManager),
            new PrivateDataProtector("", "", ""),
            new tools.jackson.databind.ObjectMapper(),
            "fx_rates_usd_v1");
    assertThatThrownBy(() -> noKeys.integrate(DATE, Instant.now().plusSeconds(1), Set.of(a)))
        .isInstanceOf(IllegalStateException.class);
    jdbc.update("update private.bank_reports set payload_cipher='dGFtcGVyZWQ='");
    assertThatThrownBy(() -> integrate(a)).isInstanceOf(IllegalStateException.class);
    assertThat(count("transactions")).isZero();
    assertThat(count("private.entities")).isZero();
    assertThat(count("integration_attempts")).isZero();
    assertThat(service.status(10, a).integrationStatus())
        .isEqualTo("VALIDATED_WAITING_INTEGRATION");
  }

  @Test
  void unsupported_bank_format_and_overlapping_reporting_period_are_rejected() {
    assertThatThrownBy(
            () -> jdbc.update("update banks set report_format='UNKNOWN' where bank_id=10"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into"
                        + " bank_reporting_periods(bank_id,effective_from_date,effective_to_date)"
                        + " values(10,?,?)",
                    DATE,
                    DATE))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThat(count("bank_reporting_periods")).isEqualTo(3);
    assertThat(count("batch_jobs")).isZero();
  }

  @Test
  void synthetic_two_thousand_transactions_measure_account_and_entity_queries() throws Exception {
    StringBuilder body = new StringBuilder(HEADER);
    for (int n = 0; n < 2000; n++)
      body.append(row(10, "A" + n, 40, "X" + n, "1", "USD", "1", "USD", "ACH", "E" + n, "F" + n));
    long started = System.nanoTime();
    long upload = submit(10, body.toString());
    var outcome = integrate(upload);
    assertThat(outcome.transactions()).isEqualTo(2000);
    assertThat(count("private.accounts")).isEqualTo(4000);
    assertThat(count("private.entities")).isEqualTo(4000);
    System.out.println(
        "SYNTHETIC_PIPELINE transactions=2000 accounts=4000 elapsedMs="
            + TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
    // Query-only synthetic expansion, not a claim of 500,000 source reports integrated.
    jdbc.execute(
        "insert into"
            + " transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)"
            + " select"
            + " t.occurred_at,t.from_account_id,t.to_account_id,t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version,t.business_date"
            + " from transactions t cross join generate_series(1,249)");
    assertThat(count("transactions")).isEqualTo(500000);
    jdbc.execute("analyze transactions");
    jdbc.execute("analyze private.accounts");
    long account = jdbc.queryForObject("select min(account_id) from private.accounts", Long.class);
    long entity =
        jdbc.queryForObject(
            "select entity_id from private.accounts where account_id=?", Long.class, account);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transactions where from_account_id=?",
                Integer.class,
                account))
        .isEqualTo(250);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from private.accounts a join transactions t on"
                    + " t.from_account_id=a.account_id where a.entity_id=?",
                Integer.class,
                entity))
        .isEqualTo(250);
    System.out.println("QUERY_ONLY_SYNTHETIC_TRANSACTIONS=500000");
    System.out.println(
        "ACCOUNT_QUERY_PLAN="
            + jdbc.queryForList(
                "explain analyze select tx_id from transactions where from_account_id=? order by"
                    + " occurred_at",
                String.class,
                account));
    System.out.println(
        "ENTITY_QUERY_PLAN="
            + jdbc.queryForList(
                "explain analyze select a.service_account_id,t.tx_id from private.accounts a join"
                    + " transactions t on t.from_account_id=a.account_id where a.entity_id=?",
                String.class,
                entity));
  }

  @Test
  void header_only_csv_has_known_zero_rows() throws Exception {
    long id = submit(10, HEADER);
    assertThat(service.status(10, id).rowCount()).isZero();
    assertThat(service.status(10, id).errors()).anyMatch(e -> e.reason().equals("EMPTY_FILE"));
    assertThat(count("transactions")).isZero();
  }
}
