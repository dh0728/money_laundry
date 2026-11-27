package com.moneylaundry.api.ingest.upload;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.ingest.storage.UploadStore;
import com.moneylaundry.api.ingest.storage.UploadTarget;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/** Real PostgreSQL and the real Python loader with a byte-preserving storage double. */
@SpringBootTest(properties = {"spring.profiles.active=local", "app.worker.mode=demo"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class LedgerUploadApiTests {
  static final LocalDate DAY = LocalDate.of(2023, 9, 1);
  static final String HEADER =
      "Timestamp,From Bank,From Account,From Bank Name,From Entity ID,From Entity Name,To Bank,To Account,To Bank Name,To Entity ID,To Entity Name,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering\n";

  static String secret() {
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    return Base64.getEncoder().encodeToString(bytes);
  }

  static final String ENC = secret(), SEARCH = secret();

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry r) {
    r.add("app.worker.python", () -> System.getenv("AML_TEST_PYTHON"));
    r.add("app.ingest.encryption-key", () -> ENC);
    r.add("app.ingest.search-key", () -> SEARCH);
    r.add("app.ingest.key-version", () -> "test");
  }

  @Autowired JdbcTemplate jdbc;
  @Autowired UploadService service;
  @Autowired MockMvc mvc;
  @MockitoBean UploadStore store;
  @MockitoBean AnalysisScheduler scheduler;
  final Map<String, byte[]> files = new ConcurrentHashMap<>();

  @BeforeEach
  void setup() throws Exception {
    Assumptions.assumeTrue(System.getenv("AML_TEST_PYTHON") != null);
    files.clear();
    jdbc.execute("truncate core.banks,analysis.jobs,ingest.uploads,core.owners cascade");
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

  /** One name per entity: even ids are individuals, odd ids corporations. */
  static String name(String entity) {
    return (Integer.parseInt(entity) % 2 == 0 ? "Individual #" : "Corporation #") + entity;
  }

  static String row(
      String time,
      int from,
      String a,
      String e1,
      int to,
      String b,
      String e2,
      String paid,
      String label) {
    return time
        + ","
        + from
        + ","
        + a
        + ",Bank #"
        + from
        + ","
        + e1
        + ","
        + name(e1)
        + ","
        + to
        + ","
        + b
        + ",Bank #"
        + to
        + ","
        + e2
        + ","
        + name(e2)
        + ","
        + paid
        + ",US Dollar,"
        + paid
        + ",US Dollar,ACH,"
        + label
        + "\n";
  }

  long submit(String csv, LocalDate day) throws Exception {
    byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
    var issued =
        service.issue(
            new IssueUploadRequest("ledger_" + day + ".csv", bytes.length, digest(bytes), day));
    String key =
        jdbc.queryForObject(
            "select s3_key from ingest.uploads where upload_id=?", String.class, issued.uploadId());
    files.put(key, bytes);
    assertThat(service.complete(issued.uploadId()).status()).isEqualTo(UploadStatus.RECEIVED);
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
    while (System.nanoTime() < deadline) {
      var state = service.status(issued.uploadId()).status();
      if (Set.of(UploadStatus.COMPLETED, UploadStatus.VALIDATION_FAILED, UploadStatus.FAILED)
          .contains(state)) return issued.uploadId();
      Thread.sleep(20);
    }
    throw new AssertionError("ledger load timeout");
  }

  @Test
  void a_ledger_file_is_loaded_with_its_labels_and_reported_by_status() throws Exception {
    long upload =
        submit(
            HEADER
                + row("2023/09/01 09:00", 27, "A1", "101", 12, "B1", "102", "100", "1")
                + row("2023/09/01 10:00", 27, "A2", "103", 27, "A1", "101", "5", "0"),
            DAY);
    var status = service.status(upload);
    assertThat(status.status()).isEqualTo(UploadStatus.COMPLETED);
    assertThat(status.rowCount()).isEqualTo(2);
    assertThat(status.insertedCount()).isEqualTo(2);
    assertThat(
            jdbc.queryForList(
                "select service_account_id from core.accounts order by account_id", String.class))
        .containsExactly("27-0001", "12-0001", "27-0002");
    assertThat(
            jdbc.queryForList(
                "select entity_type from core.owners order by owner_id", String.class))
        .containsExactly("Corporation", "Individual", "Corporation");
    assertThat(jdbc.queryForObject("select country from core.banks where bank_id=27", String.class))
        .isNull();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from evaluation.transaction_labels where is_laundering",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void a_date_is_loaded_once() throws Exception {
    submit(HEADER + row("2023/09/01 09:00", 27, "A1", "101", 12, "B1", "102", "1", "0"), DAY);
    byte[] other =
        (HEADER + row("2023/09/01 11:00", 27, "A1", "101", 12, "B1", "102", "2", "0"))
            .getBytes(StandardCharsets.UTF_8);
    assertThatThrownBy(
            () ->
                service.issue(
                    new IssueUploadRequest("again.csv", other.length, digest(other), DAY)))
        .isInstanceOfSatisfying(
            ApiException.class, e -> assertThat(e.code()).isEqualTo("DATE_ALREADY_LOADED"));
  }

  @Test
  void a_row_of_another_date_rejects_the_whole_file() throws Exception {
    long upload =
        submit(
            HEADER
                + row("2023/09/01 09:00", 27, "A1", "101", 12, "B1", "102", "1", "0")
                + row("2023/09/02 09:00", 27, "A1", "101", 12, "B1", "102", "2", "0"),
            DAY);
    var status = service.status(upload);
    assertThat(status.status()).isEqualTo(UploadStatus.VALIDATION_FAILED);
    assertThat(status.errors()).extracting(e -> e.reason()).contains("BUSINESS_DATE_MISMATCH");
    assertThat(jdbc.queryForObject("select count(*) from ledger.transactions", Integer.class))
        .isZero();
    assertThat(jdbc.queryForObject("select count(*) from core.accounts", Integer.class)).isZero();
    // A corrected file for the same date can be sent again.
    long corrected =
        submit(HEADER + row("2023/09/01 09:00", 27, "A1", "101", 12, "B1", "102", "1", "0"), DAY);
    assertThat(service.status(corrected).status()).isEqualTo(UploadStatus.COMPLETED);
  }

  @Test
  void upload_requests_need_an_admin_session() throws Exception {
    mvc.perform(
            post("/api/v1/ledger-uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileName\":\"x.csv\",\"sizeBytes\":1}"))
        .andExpect(status().is4xxClientError());
    mvc.perform(get("/api/v1/ledger-uploads/1")).andExpect(status().isUnauthorized());
  }
}
