package com.moneylaundry.api.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 은행 수집 API 관통(API.md §1.1·§1.2): 발급 → 파일 복사(로컬 저장소의 PUT) → 완료 통지 → 비동기 적재 → 조회. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class BankUploadApiTests {

  static final String KEY_70 = "test-key-bank-70";
  static final String KEY_12 = "test-key-bank-12";
  static final String HEADER =
      "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
          + "Amount Paid,Payment Currency,Payment Format,Is Laundering\n";
  static Path tempStorage;

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry registry) throws IOException {
    tempStorage = Files.createTempDirectory("bank-upload-test");
    registry.add("app.storage-dir", () -> tempStorage.toString());
    registry.add("app.bank.api-keys", () -> "70:" + KEY_70 + ",12:" + KEY_12);
  }

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired JdbcTemplate jdbc;

  @Test
  void 발급_복사_완료_통지를_거치면_원장에_적재되고_중복은_건너뛴다() throws Exception {
    String csv =
        HEADER
            + "2022/09/01 00:20,070,8000EBD30,010,8000EBD30,3697.34,US Dollar,3697.34,US Dollar,Reinvestment,0\n"
            + "2022/09/01 00:16,00220,8001C8C51,01420,8003093C1,0.025852,Bitcoin,0.025852,Bitcoin,Bitcoin,0\n"
            + "2022/09/01 00:06,021174,800737690,003,80011F990,100.00,Euro,100.00,Euro,ACH,1\n"
            + "2022/09/01 00:16,00220,8001C8C51,01420,8003093C1,0.025852,Bitcoin,0.025852,Bitcoin,Bitcoin,0\n";
    long uploadId = issueAndPut(KEY_70, "bank70_0901.csv", csv);

    mockMvc
        .perform(post("/api/bank/uploads/{id}/complete", uploadId).header("X-Api-Key", KEY_70))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("RECEIVED"));

    JsonNode done = awaitTerminal(uploadId);
    assertThat(done.get("status").asText()).isEqualTo("COMPLETED");
    assertThat(done.get("rowCount").asInt()).isEqualTo(4);
    assertThat(done.get("duplicateCount").asInt()).isEqualTo(1);
    assertThat(done.get("finishedAt").asText()).endsWith("+09:00");

    Integer txCount =
        jdbc.queryForObject(
            "select count(*) from transactions where ingest_job_id = ?", Integer.class, uploadId);
    assertThat(txCount).isEqualTo(3);
    // 2022/09/01 00:06 은 서울 시간 → UTC 전날 15:06
    assertThat(
            jdbc.queryForObject(
                    "select min(occurred_at) from transactions where ingest_job_id = ?",
                    java.time.OffsetDateTime.class,
                    uploadId)
                .toInstant())
        .isEqualTo(Instant.parse("2022-08-31T15:06:00Z"));
    BigDecimal eurUsd =
        jdbc.queryForObject(
            "select amount_usd from transactions where ingest_job_id = ? and payment_currency = 'EUR'",
            BigDecimal.class,
            uploadId);
    assertThat(eurUsd)
        .isEqualByComparingTo(
            new BigDecimal("100.00").divide(new BigDecimal("0.85340000"), 6, RoundingMode.HALF_UP));
    Integer labels =
        jdbc.queryForObject(
            "select count(*) from evaluation.transaction_labels l join transactions t on t.tx_id = l.tx_id"
                + " where t.ingest_job_id = ? and l.is_laundering",
            Integer.class,
            uploadId);
    assertThat(labels).isEqualTo(1);
    assertThat(jdbc.queryForObject("select name from banks where bank_id = 3", String.class))
        .isEqualTo("China Bank #14");
    assertThat(jdbc.queryForObject("select country from banks where bank_id = 3", String.class))
        .isEqualTo("China");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from accounts where bank_id = 220 and account_number = '8001C8C51'",
                Integer.class))
        .isEqualTo(1);

    // 같은 파일 재발급은 409
    mockMvc
        .perform(
            post("/api/bank/uploads")
                .header("X-Api-Key", KEY_70)
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("again.csv", csv)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("DUPLICATE_FILE"));
  }

  @Test
  void 행_검증에_실패하면_아무것도_적재하지_않고_오류_목록을_남긴다() throws Exception {
    String csv =
        HEADER
            + "2022/09/02 01:00,070,A1,010,B1,10.00,US Dollar,10.00,Won,ACH,0\n"
            + "2022/09/02 01:01,070,A2,010,,10.00,US Dollar,10.00,US Dollar,ACH,0\n";
    long uploadId = issueAndPut(KEY_70, "bank70_bad.csv", csv);
    mockMvc
        .perform(post("/api/bank/uploads/{id}/complete", uploadId).header("X-Api-Key", KEY_70))
        .andExpect(status().isAccepted());

    JsonNode done = awaitTerminal(uploadId);
    assertThat(done.get("status").asText()).isEqualTo("VALIDATION_FAILED");
    assertThat(done.get("missingCount").asInt()).isEqualTo(1);
    assertThat(done.get("errors")).hasSize(2);
    assertThat(done.get("errors").get(0).get("row").asInt()).isEqualTo(2);
    assertThat(done.get("errors").get(0).get("column").asText()).isEqualTo("Payment Currency");
    Integer txCount =
        jdbc.queryForObject(
            "select count(*) from transactions where ingest_job_id = ?", Integer.class, uploadId);
    assertThat(txCount).isZero();
  }

  @Test
  void API_키가_없거나_틀리면_401이다() throws Exception {
    mockMvc
        .perform(
            post("/api/bank/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("x.csv", "a")))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    mockMvc
        .perform(
            post("/api/bank/uploads")
                .header("X-Api-Key", "wrong")
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("x.csv", "a")))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void 파일을_올리지_않고_완료_통지하면_400_UPLOAD_MISMATCH() throws Exception {
    MvcResult issued =
        mockMvc
            .perform(
                post("/api/bank/uploads")
                    .header("X-Api-Key", KEY_12)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(issueBody("bank12.csv", "never-put")))
            .andExpect(status().isCreated())
            .andReturn();
    long uploadId =
        objectMapper.readTree(issued.getResponse().getContentAsString()).get("uploadId").asLong();
    mockMvc
        .perform(post("/api/bank/uploads/{id}/complete", uploadId).header("X-Api-Key", KEY_12))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("UPLOAD_MISMATCH"));
    // 다른 은행의 업로드는 보이지 않는다
    mockMvc
        .perform(post("/api/bank/uploads/{id}/complete", uploadId).header("X-Api-Key", KEY_70))
        .andExpect(status().isNotFound());
  }

  @Test
  void 한도를_넘는_크기는_413이다() throws Exception {
    String body =
        "{\"fileName\":\"big.csv\",\"sizeBytes\":300000000,\"sha256\":\"" + "a".repeat(64) + "\"}";
    mockMvc
        .perform(
            post("/api/bank/uploads")
                .header("X-Api-Key", KEY_70)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isPayloadTooLarge())
        .andExpect(jsonPath("$.code").value("FILE_TOO_LARGE"));
  }

  @Test
  void 도착_현황은_보고_은행_전부를_돌려주고_과거_날짜는_전부_미도착이다() throws Exception {
    MvcResult result =
        mockMvc
            .perform(get("/api/banks/arrivals").param("date", "2000-01-01"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalBanks").value(2))
            .andExpect(jsonPath("$.arrivedCount").value(0))
            .andExpect(jsonPath("$.remainingSeconds").value(0))
            .andReturn();
    JsonNode banks = objectMapper.readTree(result.getResponse().getContentAsString()).get("banks");
    assertThat(banks).hasSize(2);
    assertThat(banks.get(0).get("bankId").asInt()).isEqualTo(12);
    assertThat(banks.get(0).get("status").asText()).isEqualTo("NOT_ARRIVED");
    assertThat(banks.get(1).get("name").asText()).isEqualTo("Oasis Thrift");
  }

  private long issueAndPut(String apiKey, String fileName, String csv) throws Exception {
    MvcResult issued =
        mockMvc
            .perform(
                post("/api/bank/uploads")
                    .header("X-Api-Key", apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(issueBody(fileName, csv)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.method").value("PUT"))
            .andExpect(jsonPath("$.url").isNotEmpty())
            .andReturn();
    JsonNode json = objectMapper.readTree(issued.getResponse().getContentAsString());
    Path target = Path.of(URI.create(json.get("url").asText()));
    Files.write(target, csv.getBytes(StandardCharsets.UTF_8));
    return json.get("uploadId").asLong();
  }

  private String issueBody(String fileName, String content) throws Exception {
    byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
    String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    return "{\"fileName\":\""
        + fileName
        + "\",\"sizeBytes\":"
        + bytes.length
        + ",\"sha256\":\""
        + sha
        + "\"}";
  }

  private JsonNode awaitTerminal(long uploadId) throws Exception {
    Set<String> terminal = Set.of("COMPLETED", "VALIDATION_FAILED", "FAILED");
    for (int i = 0; i < 120; i++) {
      MvcResult result =
          mockMvc
              .perform(get("/api/uploads/{id}", uploadId))
              .andExpect(status().isOk())
              .andReturn();
      JsonNode json = objectMapper.readTree(result.getResponse().getContentAsString());
      if (terminal.contains(json.get("status").asText())) {
        return json;
      }
      Thread.sleep(250);
    }
    throw new AssertionError("적재가 30초 안에 끝나지 않음 uploadId=" + uploadId);
  }
}
