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

  @Autowired AnalysisRunService runs;
  @Autowired AnalysisService analysis;
  @Autowired AnalysisRunner productionRunner;
  @MockitoBean CancellationScheduler cancellationScheduler;

  long correction(int bank, long original) {
    long version =
        jdbc.queryForObject(
            "select version_id from report_versions where upload_id=?", Long.class, original);
    return com.moneylaundry.api.correction.CorrectionService.open(
        jdbc, bank, DATE, version, "CHECK_REQUESTED", 1);
  }

  long replace(int bank, long correction, String csv) throws Exception {
    byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
    var issue =
        service.issue(
            bank,
            new IssueUploadRequest(
                "correction.csv",
                bytes.length,
                digest(bytes),
                DATE,
                correction,
                UUID.randomUUID()));
    String key =
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, issue.uploadId());
    files.put(key, bytes);
    service.complete(bank, issue.uploadId());
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
    while (System.nanoTime() < deadline) {
      if (Set.of("COMPLETED", "VALIDATION_FAILED", "FAILED")
          .contains(service.status(bank, issue.uploadId()).status().name()))
        return issue.uploadId();
      Thread.sleep(20);
    }
    throw new AssertionError("correction ingestion timeout");
  }

  List<Long> activeIds() {
    return jdbc.queryForList(
        "select tx_id from transactions where integration_status='ACTIVE' order by tx_id",
        Long.class);
  }

  UUID fixtureRun(String role) {
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,current_stage,analysis_cutoff_at) values('ANALYSIS','QUEUED','FEATURES',now()) returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis_runs(run_id,job_id,status) values(?,?,'READY')", run, job);
    jdbc.update("update batch_jobs set current_run_id=? where job_id=?", run, job);
    for (long id : activeIds()) {
      runs.snapshot(run, id, role);
      if (role.equals("TARGET"))
        jdbc.update("insert into analysis_target_ownership values(?,?)", id, run);
    }
    return run;
  }

  String x() {
    return row(10, "A", 20, "B", "100", "USD", "100", "USD", "ACH", "E1", "E2");
  }

  String y() {
    return row(10, "C", 20, "D", "50", "USD", "50", "USD", "Wire", "E3", "E4");
  }

  @Test
  void correction_preserves_occurrences_and_ids_with_reordered_reports_and_addition()
      throws Exception {
    long a = submit(10, HEADER + x() + x() + y()), b = submit(20, HEADER + y() + x() + x());
    integrate(a, b);
    var ids = activeIds();
    assertThat(ids).hasSize(3);
    long ca = correction(10, a), cb = correction(20, b);
    long a2 = replace(10, ca, HEADER + y() + x() + x()),
        b2 = replace(20, cb, HEADER + x() + y() + x());
    integrate(a, b, a2, b2);
    assertThat(activeIds()).isEqualTo(ids);
    long ca2 = correction(10, a2), cb2 = correction(20, b2);
    long a3 = replace(10, ca2, HEADER + x() + y() + x() + x()),
        b3 = replace(20, cb2, HEADER + x() + x() + x() + y());
    integrate(a, b, a2, b2, a3, b3);
    assertThat(activeIds()).hasSize(4).containsAll(ids);
    integrate(a, b, a2, b2, a3, b3);
    assertThat(activeIds()).hasSize(4);
  }

  @Test
  void one_candidate_waits_then_joint_correction_replaces_atomically() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    var old = activeIds();
    UUID run = fixtureRun("TARGET");
    long ca = correction(10, a), cb = correction(20, b);
    String changed = x().replace(",100,", ",200,");
    long a2 = replace(10, ca, HEADER + changed);
    integrate(a, b, a2);
    assertThat(activeIds()).isEqualTo(old);
    assertThat(service.status(10, a2).integrationStatus()).isEqualTo("WAITING_COUNTERPART");
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_runs where run_id=?", String.class, run))
        .isEqualTo("CANCELLED");
    long b2 = replace(20, cb, HEADER + changed);
    integrate(a, b, a2, b2);
    assertThat(activeIds()).hasSize(1).doesNotContainAnyElementsOf(old);
    assertThat(
            jdbc.queryForObject(
                "select amount_paid from transactions where integration_status='ACTIVE'",
                BigDecimal.class))
        .isEqualByComparingTo("200");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from correction_requests where correction_id in (?,?) and status='RESOLVED'",
                Integer.class,
                ca,
                cb))
        .isEqualTo(2);
  }

  @Test
  void completed_target_deletion_rejects_whole_component() throws Exception {
    long a = submit(10, HEADER + x() + x() + y()), b = submit(20, HEADER + x() + x() + y());
    integrate(a, b);
    var old = activeIds();
    UUID run = fixtureRun("TARGET");
    jdbc.update("update analysis_runs set status='COMPLETED' where run_id=?", run);
    long ca = correction(10, a), cb = correction(20, b);
    long a2 = replace(10, ca, HEADER + x() + y()), b2 = replace(20, cb, HEADER + x() + y());
    integrate(a, b, a2, b2);
    assertThat(activeIds()).isEqualTo(old);
    assertThat(
            jdbc.queryForObject(
                "select error_code from report_versions where upload_id=?", String.class, a2))
        .isEqualTo("COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE");
    assertThat(
            jdbc.queryForObject("select generation from report_sets where bank_id=10", Long.class))
        .isEqualTo(1);
  }

  @Test
  void self_invalid_replacement_preserves_existing_and_does_not_cancel() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("TARGET");
    var old = activeIds();
    long c = correction(10, a);
    long a2 = replace(10, c, HEADER + x().replace(",100,", ",-1,"));
    assertThat(service.status(10, a2).status().name()).isEqualTo("VALIDATION_FAILED");
    integrate(a, b, a2);
    assertThat(activeIds()).isEqualTo(old);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_runs where run_id=?", String.class, run))
        .isEqualTo("READY");
    assertThat(
            jdbc.queryForObject(
                "select status from correction_requests where correction_id=?", String.class, c))
        .isEqualTo("OPEN");
  }

  @Test
  void correction_submission_identity_reuses_finished_upload_and_checks_bank_and_file()
      throws Exception {
    long a = submit(10, HEADER + x());
    long c = correction(10, a);
    byte[] bytes = (HEADER + x()).getBytes(StandardCharsets.UTF_8);
    UUID submission = UUID.randomUUID();
    var request =
        new IssueUploadRequest("same.csv", bytes.length, digest(bytes), DATE, c, submission);
    var issued = service.issue(10, request);
    files.put(
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, issued.uploadId()),
        bytes);
    service.complete(10, issued.uploadId());
    assertThat(service.issue(10, request).uploadId()).isEqualTo(issued.uploadId());
    assertThat(service.issue(10, request).uploadRequired()).isFalse();
    assertThatThrownBy(() -> service.issue(20, request)).isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                service.issue(
                    10,
                    new IssueUploadRequest(
                        "changed.csv", bytes.length, digest(bytes), DATE, c, submission)))
        .isInstanceOf(ApiException.class);
    mvc.perform(get("/api/v1/bank/corrections/" + c).header("X-Bank-Id", "20"))
        .andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/bank/corrections").header("X-Bank-Id", "999"))
        .andExpect(status().isForbidden());
  }

  @Test
  void cancellation_fences_all_models_and_waits_for_both_terminal_acknowledgements()
      throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("TARGET");
    UUID binary = UUID.randomUUID(), type = UUID.randomUUID();
    runs.registerRequest(run, binary, 1, "BINARY");
    runs.publishRequest(run, binary, 1);
    runs.registerRequest(run, type, 1, "TYPE");
    runs.publishRequest(run, type, 1);
    runs.cancel(run, "REPORT_CORRECTED");
    runs.cancel(run, "REPORT_CORRECTED");
    assertThat(count("analysis_cancel_outbox")).isEqualTo(2);
    assertThatThrownBy(() -> runs.publishRequest(run, binary, 1)).hasMessage("RUN_FENCED");
    long replacementJob =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','QUEUED') returning job_id",
            Long.class);
    UUID replacement = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,status) values(?,?,'READY')",
        replacement,
        replacementJob);
    jdbc.update(
        "update batch_jobs set current_run_id=? where job_id=?", replacement, replacementJob);
    jdbc.update("insert into analysis_run_replacements values(?,?)", replacement, run);
    var cancels =
        jdbc.queryForList(
            "select cancel_id from analysis_cancel_outbox order by cancel_id", UUID.class);
    assertThat(runs.canInfer(replacement)).isFalse();
    runs.acknowledge(cancels.get(0), "STOPPED");
    assertThat(runs.canInfer(replacement)).isFalse();
    runs.acknowledge(cancels.get(1), "ALREADY_FINISHED");
    assertThat(runs.canInfer(replacement)).isTrue();
    assertThatThrownBy(() -> runs.complete(run)).hasMessage("RUN_FENCED");
  }

  @Test
  void production_runner_integrates_and_freezes_without_calling_unconfigured_python_early()
      throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    long job = analysis.registerNow();
    try {
      productionRunner.scan();
      assertThat(analysis.job(job).stage()).isEqualTo(AnalysisStage.INTEGRATE);
      productionRunner.scan();
      assertThat(analysis.job(job).stage()).isEqualTo(AnalysisStage.FREEZE_INPUT);
      productionRunner.scan();
      assertThat(analysis.job(job).stage()).isEqualTo(AnalysisStage.FEATURES);
      UUID run = runs.current(job);
      assertThat(run).isNotNull();
      assertThat(
              jdbc.queryForList(
                  "select tx_id from analysis.input_transactions where run_id=?", Long.class, run))
          .containsExactlyElementsOf(activeIds());
      assertThat(count("analysis_input_reports")).isEqualTo(2);
    } finally {
      productionRunner.close();
    }
  }

  @Test
  void completed_context_keeps_old_values_and_allows_current_correction() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("CONTEXT");
    jdbc.update("update analysis_runs set status='COMPLETED' where run_id=?", run);
    var old = activeIds();
    long a2 = replace(10, correction(10, a), HEADER + x().replace(",100,", ",200,")),
        b2 = replace(20, correction(20, b), HEADER + x().replace(",100,", ",200,"));
    integrate(a, b, a2, b2);
    assertThat(activeIds()).doesNotContainAnyElementsOf(old);
    assertThat(
            jdbc.queryForObject(
                "select amount_paid from analysis.input_transactions where run_id=?",
                BigDecimal.class,
                run))
        .isEqualByComparingTo("100");
    assertThat(
            jdbc.queryForObject(
                "select amount_paid from transactions where integration_status='ACTIVE'",
                BigDecimal.class))
        .isEqualByComparingTo("200");
  }

  @Test
  void replacement_failure_rolls_back_transactions_accounts_pointers_and_resolution()
      throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    var old = activeIds();
    long ca = correction(10, a), cb = correction(20, b);
    long a2 = replace(10, ca, HEADER + x() + y()), b2 = replace(20, cb, HEADER + x() + y());
    jdbc.execute(
        "create function correction_test_failure() returns trigger language plpgsql as $$ begin if NEW.bank_id=20 then raise exception 'TEST_ROLLBACK'; end if; return NEW; end $$");
    jdbc.execute(
        "create trigger correction_test_failure before update on report_sets for each row execute function correction_test_failure()");
    try {
      assertThatThrownBy(() -> integrate(a, b, a2, b2))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
    } finally {
      jdbc.execute("drop trigger correction_test_failure on report_sets");
      jdbc.execute("drop function correction_test_failure()");
    }
    assertThat(activeIds()).isEqualTo(old);
    assertThat(count("private.accounts")).isEqualTo(2);
    assertThat(jdbc.queryForList("select generation from report_sets order by bank_id", Long.class))
        .containsExactly(1L, 1L);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from correction_requests where status='RESOLVED'", Integer.class))
        .isZero();
    integrate(a, b, a2, b2);
    assertThat(activeIds()).hasSize(2);
  }

  @Test
  void canceled_partial_score_targets_all_return_in_explicit_replacement() throws Exception {
    long a = submit(10, HEADER + x() + y()), b = submit(20, HEADER + x() + y());
    integrate(a, b);
    UUID old = fixtureRun("TARGET");
    long oldJob =
        jdbc.queryForObject("select job_id from analysis_runs where run_id=?", Long.class, old);
    jdbc.update(
        "update transactions set scored_job_id=? where tx_id=?", oldJob, activeIds().getFirst());
    long a2 = replace(10, correction(10, a), HEADER + x().replace(",100,", ",200,") + y()),
        b2 = replace(20, correction(20, b), HEADER + x().replace(",100,", ",200,") + y());
    integrate(a, b, a2, b2);
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','QUEUED') returning job_id",
            Long.class);
    jdbc.update(
        "insert into analysis_selected_versions select ?,set_id,current_version_id,generation from report_sets",
        job);
    UUID fresh = runs.freeze(job, Instant.now().plusSeconds(1));
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.input_transactions where run_id=? and input_role='TARGET' order by tx_id",
                Long.class,
                fresh))
        .containsExactlyElementsOf(activeIds());
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_run_replacements where run_id=? and replaces_run_id=?",
                Integer.class,
                fresh,
                old))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=?",
                Integer.class,
                old))
        .isEqualTo(2);
  }

  @Test
  void independent_component_integrates_while_counterpart_correction_waits() throws Exception {
    String c = row(30, "Q", 40, "R", "8", "USD", "8", "USD", "ACH", "E8", "E9");
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x()), third = submit(30, HEADER + c);
    integrate(a, b, third);
    long a2 = replace(10, correction(10, a), HEADER + x().replace(",100,", ",200,"));
    long c2 = replace(30, correction(30, third), HEADER + c + c);
    integrate(a, b, third, a2, c2);
    assertThat(service.status(10, a2).integrationStatus()).isEqualTo("WAITING_COUNTERPART");
    assertThat(service.status(30, c2).integrationStatus()).isEqualTo("ACTIVE");
    assertThat(activeIds()).hasSize(3);
  }

  @Test
  void cutoff_excludes_late_candidate_and_never_rewinds_new_current_version() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    Instant cutoff = Instant.now();
    long a2 = replace(10, correction(10, a), HEADER + x().replace(",100,", ",200,")),
        b2 = replace(20, correction(20, b), HEADER + x().replace(",100,", ",200,"));
    integration.integrate(DATE, cutoff, Set.of(a, b));
    assertThat(
            jdbc.queryForObject(
                "select amount_paid from transactions where integration_status='ACTIVE'",
                BigDecimal.class))
        .isEqualByComparingTo("100");
    integrate(a, b, a2, b2);
    var current = activeIds();
    assertThatThrownBy(() -> integration.integrate(DATE, cutoff, Set.of(a, b)))
        .hasMessage("CUTOFF_SUPERSEDED");
    assertThat(activeIds()).isEqualTo(current);
  }

  @Test
  void cancel_and_completion_are_serialized_in_both_orders() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    for (boolean cancelFirst : List.of(true, false)) {
      jdbc.update("delete from analysis_target_ownership");
      UUID run = fixtureRun("TARGET");
      var pool = Executors.newFixedThreadPool(2);
      var locked = new CountDownLatch(1);
      var release = new CountDownLatch(1);
      try {
        var first =
            pool.submit(
                () ->
                    new org.springframework.transaction.support.TransactionTemplate(manager())
                        .executeWithoutResult(
                            state -> {
                              AnalysisRunService.integrationLock(jdbc);
                              locked.countDown();
                              try {
                                release.await(5, TimeUnit.SECONDS);
                              } catch (InterruptedException e) {
                                throw new RuntimeException(e);
                              }
                              if (cancelFirst) runs.cancel(run, "REPORT_CORRECTED");
                              else runs.complete(run);
                            }));
        assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
        var second =
            pool.submit(
                () -> {
                  if (cancelFirst) runs.complete(run);
                  else runs.cancel(run, "REPORT_CORRECTED");
                });
        release.countDown();
        first.get(10, TimeUnit.SECONDS);
        assertThatThrownBy(() -> second.get(10, TimeUnit.SECONDS))
            .isInstanceOf(ExecutionException.class);
        assertThat(
                jdbc.queryForObject(
                    "select status from analysis_runs where run_id=?", String.class, run))
            .isEqualTo(cancelFirst ? "CANCELLED" : "COMPLETED");
      } finally {
        release.countDown();
        pool.shutdownNow();
        assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
      }
    }
  }

  org.springframework.transaction.PlatformTransactionManager manager() {
    return jdbcTransactionManager;
  }

  @Autowired org.springframework.transaction.PlatformTransactionManager jdbcTransactionManager;

  @Test
  void missing_counterpart_request_targets_missing_bank_not_waiting_sender() throws Exception {
    long a = submit(10, HEADER + x());
    integrate(a);
    assertThat(jdbc.queryForList("select bank_id from correction_requests", Integer.class))
        .containsExactly(20);
    mvc.perform(get("/api/v1/bank/corrections").header("X-Bank-Id", "20"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content[0].uploadId").doesNotExist());
  }

  @Test
  void confirmed_identity_conflict_does_not_cancel_normal_run() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("TARGET");
    var old = activeIds();
    String conflict = x().replace(",E1,", ",E99,");
    long a2 = replace(10, correction(10, a), HEADER + conflict);
    integrate(a, b, a2);
    assertThat(activeIds()).isEqualTo(old);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_runs where run_id=?", String.class, run))
        .isEqualTo("READY");
    assertThat(
            jdbc.queryForObject(
                "select error_code from report_versions where upload_id=?", String.class, a2))
        .isEqualTo("INVALID_SELF_OR_CONFIRMED_IDENTITY");
  }

  @Test
  void durable_cancel_retries_stop_publishing_after_three_but_accept_late_ack() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("TARGET"), request = UUID.randomUUID();
    runs.registerRequest(run, request, 1, "BINARY");
    runs.publishRequest(run, request, 1);
    runs.cancel(run, "REPORT_CORRECTED");
    var transport = mock(AnalysisRunService.CancelTransport.class);
    doThrow(new IllegalStateException("offline")).when(transport).publish(any(), anyString());
    for (int i = 0; i < 4; i++) {
      jdbc.update("update analysis_cancel_outbox set retry_at=null");
      runs.deliverCancellations(transport);
    }
    verify(transport, times(3)).publish(any(), anyString());
    assertThat(jdbc.queryForObject("select attempts from analysis_cancel_outbox", Integer.class))
        .isEqualTo(3);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_runs where run_id=?", String.class, run))
        .isEqualTo("CANCEL_REQUESTED");
    when(transport.acknowledgement(any(), anyString())).thenReturn("STOPPED");
    jdbc.update("update analysis_cancel_outbox set retry_at=null");
    runs.deliverCancellations(transport);
    assertThat(
            jdbc.queryForObject(
                "select status from analysis_runs where run_id=?", String.class, run))
        .isEqualTo("CANCELLED");
  }

  @Test
  void next_day_registered_receipts_retain_yesterdays_waiting_candidate() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    long ca = correction(10, a), cb = correction(20, b);
    long a2 = replace(10, ca, HEADER + x().replace(",100,", ",200,"));
    long day1 = analysis.registerNow();
    try {
      productionRunner.scan();
      productionRunner.scan();
      productionRunner.scan();
      assertThat(service.status(10, a2).integrationStatus()).isEqualTo("WAITING_COUNTERPART");
      jdbc.update("update batch_jobs set analysis_date=analysis_date-1 where job_id=?", day1);
      long b2 = replace(20, cb, HEADER + x().replace(",100,", ",200,"));
      long day2 = analysis.registerNow();
      assertThat(
              jdbc.queryForList(
                  "select upload_id from analysis_receipts where job_id=?", Long.class, day2))
          .contains(a2, b2);
      productionRunner.scan();
      productionRunner.scan();
      productionRunner.scan();
      assertThat(analysis.job(day2).stage()).isEqualTo(AnalysisStage.FEATURES);
      assertThat(
              jdbc.queryForObject(
                  "select amount_paid from analysis.input_transactions where run_id=?",
                  BigDecimal.class,
                  runs.current(day2)))
          .isEqualByComparingTo("200");
    } finally {
      productionRunner.close();
    }
  }

  @Test
  void blocked_canceled_run_cannot_leak_replaced_component_through_new_target_path()
      throws Exception {
    jdbc.update("insert into banks(bank_id,is_reporting) values(40,true)");
    jdbc.update(
        "insert into bank_reporting_periods(bank_id,effective_from_date) values(40,?)", DATE);
    String other = row(30, "Q", 40, "R", "8", "USD", "8", "USD", "ACH", "E8", "E9");
    long a = submit(10, HEADER + x()),
        b = submit(20, HEADER + x()),
        c = submit(30, HEADER + other),
        d = submit(40, HEADER + other);
    integrate(a, b, c, d);
    UUID old = fixtureRun("TARGET");
    long a2 = replace(10, correction(10, a), HEADER + x().replace(",100,", ",200,")),
        b2 = replace(20, correction(20, b), HEADER + x().replace(",100,", ",200,")),
        c2 = replace(30, correction(30, c), HEADER + other.replace(",8,", ",9,"));
    integrate(a, b, c, d, a2, b2, c2);
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','QUEUED') returning job_id",
            Long.class);
    jdbc.update(
        "insert into analysis_selected_versions select ?,set_id,current_version_id,generation from report_sets where current_version_id is not null",
        job);
    jdbc.update(
        "insert into analysis_receipts select ?,job_id from batch_jobs where job_type='INGEST'",
        job);
    UUID blocked = runs.freeze(job, Instant.now().plusSeconds(1));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=?",
                Integer.class,
                blocked))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_run_replacements where replaces_run_id=?",
                Integer.class,
                old))
        .isZero();
  }

  @Test
  void incomplete_old_receipt_is_waited_for_even_when_already_assigned_to_prior_job() {
    long old =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,received_at,business_date) values('INGEST','RUNNING',now(),?) returning job_id",
            Long.class,
            DATE);
    long previous =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,current_stage) values('ANALYSIS','COMPLETED',current_date-1,'COMPLETE') returning job_id",
            Long.class);
    jdbc.update("insert into analysis_uploads(job_id,upload_id) values(?,?)", previous, old);
    long job = analysis.registerNow();
    try {
      productionRunner.scan();
      assertThat(analysis.job(job).status()).isEqualTo("RETRY_WAIT");
      assertThat(analysis.job(job).stage()).isEqualTo(AnalysisStage.WAIT_INGEST);
      assertThat(analysis.job(job).attempts()).isZero();
    } finally {
      productionRunner.close();
    }
  }

  @Test
  void late_prepared_result_is_not_committed_after_cancellation() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    UUID run = fixtureRun("TARGET");
    java.util.concurrent.atomic.AtomicInteger commits =
        new java.util.concurrent.atomic.AtomicInteger();
    AnalysisStageExecutor executor =
        new AnalysisStageExecutor() {
          public Result prepare(Context c) {
            assertThat(c.runId()).isEqualTo(run);
            runs.cancel(run, "REPORT_CORRECTED");
            return new Result("late-artifact");
          }

          public void commit(Context c, Result r) {
            commits.incrementAndGet();
          }
        };
    try (var runner = new AnalysisRunner(analysis, executor, runs, integration)) {
      runner.scan();
    }
    assertThat(commits).hasValue(0);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_run_stage_results where run_id=?",
                Integer.class,
                run))
        .isZero();
  }

  @Test
  void late_old_validation_failure_does_not_overwrite_new_candidate_or_errors() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    long correction = correction(10, a);
    byte[] invalid = (HEADER + x().replace(",100,", ",-1,")).getBytes(StandardCharsets.UTF_8);
    var old =
        service.issue(
            10,
            new IssueUploadRequest(
                "older.csv", invalid.length, digest(invalid), DATE, correction, UUID.randomUUID()));
    String key =
        jdbc.queryForObject(
            "select s3_key from batch_jobs where job_id=?", String.class, old.uploadId());
    files.put(key, invalid);
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    when(store.open(eq(key)))
        .thenAnswer(
            invocation -> {
              entered.countDown();
              if (!release.await(10, TimeUnit.SECONDS)) throw new IOException("test timeout");
              return new ByteArrayInputStream(invalid);
            });
    service.complete(10, old.uploadId());
    assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
    long latest;
    try {
      latest = replace(10, correction, HEADER + x() + y());
    } finally {
      release.countDown();
    }
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (service.status(10, old.uploadId()).status().name().equals("RECEIVED")
        && System.nanoTime() < deadline) Thread.sleep(20);
    assertThat(service.status(10, old.uploadId()).status().name()).isEqualTo("VALIDATION_FAILED");
    assertThat(
            jdbc.queryForObject(
                "select v.upload_id from correction_requests c join report_versions v on v.version_id=c.replacement_version_id where c.correction_id=?",
                Long.class,
                correction))
        .isEqualTo(latest);
    assertThat(
            jdbc.queryForObject(
                "select status from correction_requests where correction_id=?",
                String.class,
                correction))
        .isEqualTo("WAITING_COUNTERPART");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from correction_errors where correction_id=? and code='INVALID_SELF'",
                Integer.class,
                correction))
        .isZero();
  }

  @Test
  void resolving_cutoff_candidate_does_not_resolve_later_submission_context() throws Exception {
    long a = submit(10, HEADER + x()), b = submit(20, HEADER + x());
    integrate(a, b);
    long ca = correction(10, a), cb = correction(20, b);
    long a2 = replace(10, ca, HEADER + x().replace(",100,", ",200,")),
        b2 = replace(20, cb, HEADER + x().replace(",100,", ",200,"));
    Instant cutoff = Instant.now();
    long a3 = replace(10, ca, HEADER + x().replace(",100,", ",300,"));
    integration.integrate(DATE, cutoff, Set.of(a, b, a2, b2));
    assertThat(
            jdbc.queryForObject(
                "select status from correction_requests where correction_id=?", String.class, ca))
        .isNotEqualTo("RESOLVED");
    assertThat(
            jdbc.queryForObject(
                "select v.upload_id from correction_requests c join report_versions v on v.version_id=c.replacement_version_id where c.correction_id=?",
                Long.class,
                ca))
        .isEqualTo(a3);
    assertThat(
            jdbc.queryForObject(
                "select amount_paid from transactions where integration_status='ACTIVE'",
                BigDecimal.class))
        .isEqualByComparingTo("200");
  }
}
