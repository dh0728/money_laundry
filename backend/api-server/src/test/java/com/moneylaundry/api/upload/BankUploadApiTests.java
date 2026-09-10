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
import java.util.Base64;
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
@SpringBootTest(properties = "spring.profiles.active=local")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class BankUploadApiTests {

  static final String BANK_70 = "70";
  static final String BANK_12 = "12";
  static final String HEADER =
      "Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,"
          + "Amount Paid,Payment Currency,Payment Format,Is Laundering\n";
  static Path tempStorage;

  @DynamicPropertySource
  static void props(DynamicPropertyRegistry registry) throws IOException {
    tempStorage = Files.createTempDirectory("bank-upload-test");
    registry.add("app.storage-dir", () -> tempStorage.toString());
  }

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired JdbcTemplate jdbc;

  @Test
  void 발급_완료_결과조회로_모든_행이_적재된다() throws Exception {
    String csv =
        HEADER
            + "2022/09/01 00:20,070,8000EBD30,010,8000EBD30,3697.34,US Dollar,3697.34,US Dollar,Reinvestment,0\n"
            + "2022/09/01 00:16,00220,8001C8C51,01420,8003093C1,0.025852,Bitcoin,0.025852,Bitcoin,Bitcoin,0\n"
            + "2022/09/01 00:06,021174,800737690,003,80011F990,100.00,Euro,100.00,Euro,ACH,1\n";
    long uploadId = issueAndPut(BANK_70, "bank70_0901.csv", csv);

    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", uploadId).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("RECEIVED"));

    JsonNode done = awaitTerminal(uploadId);
    assertThat(done.get("status").asText()).isEqualTo("COMPLETED");
    assertThat(done.get("rowCount").asInt()).isEqualTo(3);
    assertThat(done.get("duplicateCount").asInt()).isZero();
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
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", BANK_70)
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
    long uploadId = issueAndPut(BANK_70, "bank70_bad.csv", csv);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", uploadId).header("X-Bank-Id", BANK_70))
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
  void 은행코드가_없거나_틀리면_400이다() throws Exception {
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("x.csv", "a")))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", "wrong")
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("x.csv", "a")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 파일을_올리지_않고_완료_통지하면_400_UPLOAD_MISMATCH() throws Exception {
    MvcResult issued =
        mockMvc
            .perform(
                post("/api/v1/bank/uploads")
                    .header("X-Bank-Id", BANK_12)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(issueBody("bank12.csv", "never-put")))
            .andExpect(status().isCreated())
            .andReturn();
    long uploadId =
        objectMapper.readTree(issued.getResponse().getContentAsString()).get("uploadId").asLong();
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", uploadId).header("X-Bank-Id", BANK_12))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("UPLOAD_MISMATCH"));
    // 다른 은행의 업로드는 보이지 않는다
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", uploadId).header("X-Bank-Id", BANK_70))
        .andExpect(status().isNotFound());
  }

  @Test
  void 한도를_넘는_크기는_413이다() throws Exception {
    String body =
        "{\"fileName\":\"big.csv\",\"sizeBytes\":300000000,\"checksumSha256\":\""
            + Base64.getEncoder().encodeToString(new byte[32])
            + "\",\"businessDate\":\"2022-09-01\"}";
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", BANK_70)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isPayloadTooLarge())
        .andExpect(jsonPath("$.code").value("FILE_TOO_LARGE"));
  }

  @Test
  void 도착_현황은_보고_은행_전부를_돌려주고_과거_날짜는_전부_미도착이다() throws Exception {
    issueAndPut(BANK_12, "arrival12.csv", "arrival12");
    issueAndPut(BANK_70, "arrival70.csv", "arrival70");
    MvcResult result =
        mockMvc
            .perform(get("/api/banks/arrivals").param("date", "2000-01-01"))
            .andExpect(status().isOk())
            .andExpect(
                jsonPath("$.totalBanks")
                    .value(
                        jdbc.queryForObject(
                            "select count(*) from banks where is_reporting", Integer.class)))
            .andExpect(jsonPath("$.arrivedCount").value(0))
            .andExpect(jsonPath("$.remainingSeconds").value(0))
            .andReturn();
    JsonNode banks = objectMapper.readTree(result.getResponse().getContentAsString()).get("banks");
    assertThat(banks.size()).isGreaterThanOrEqualTo(2);
    assertThat(banks.get(0).get("bankId").asInt()).isEqualTo(12);
    assertThat(banks.get(0).get("status").asText()).isEqualTo("NOT_ARRIVED");
    assertThat(banks.get(1).get("name").asText()).isEqualTo("Oasis Thrift");
  }

  @Test
  void 내부중복과_기준일_불일치는_파일전체_실패다() throws Exception {
    String row = "2022/09/01 00:20,070,DU1,010,DU2,10,US Dollar,10,US Dollar,ACH,0\n";
    long duplicate = issueAndPut(BANK_70, "duplicate.csv", HEADER + row + row);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", duplicate).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted());
    JsonNode result = awaitTerminal(duplicate);
    assertThat(result.get("status").asText()).isEqualTo("VALIDATION_FAILED");
    assertThat(result.get("insertedCount").asInt()).isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transactions where ingest_job_id = ?",
                Integer.class,
                duplicate))
        .isZero();
    long date =
        issueAndPut(BANK_70, "wrong-date.csv", HEADER + row.replace("2022/09/01", "2022/09/03"));
    mockMvc.perform(post("/api/v1/bank/uploads/{id}/complete", date).header("X-Bank-Id", BANK_70));
    assertThat(awaitTerminal(date).get("status").asText()).isEqualTo("VALIDATION_FAILED");
  }

  @Test
  void 은행별_조회와_진행중_파일중복을_검사한다() throws Exception {
    String body = issueBody("pending.csv", "pending-file");
    JsonNode issued =
        objectMapper.readTree(
            mockMvc
                .perform(
                    post("/api/v1/bank/uploads")
                        .header("X-Bank-Id", BANK_70)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andReturn()
                .getResponse()
                .getContentAsString());
    long id = issued.get("uploadId").asLong();
    mockMvc.perform(get("/api/v1/bank/uploads/{id}", id)).andExpect(status().isBadRequest());
    mockMvc
        .perform(get("/api/v1/bank/uploads/{id}", id).header("X-Bank-Id", BANK_12))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(get("/api/v1/bank/uploads/{id}", id).header("X-Bank-Id", BANK_70))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessDate").value("2022-09-01"));
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", BANK_70)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("UPLOAD_IN_PROGRESS"));
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", BANK_12)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isCreated());
  }

  @Test
  void 원장중복이_섞이면_신규행도_롤백한다() throws Exception {
    String row = "2022/09/01 02:20,070,LDU1,010,LDU2,20,US Dollar,20,US Dollar,ACH,\n";
    long first = issueAndPut(BANK_70, "ledger-first.csv", HEADER + row);
    mockMvc.perform(post("/api/v1/bank/uploads/{id}/complete", first).header("X-Bank-Id", BANK_70));
    assertThat(awaitTerminal(first).get("insertedCount").asInt()).isEqualTo(1);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", first).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.status").value("COMPLETED"));
    mockMvc
        .perform(
            post("/api/v1/bank/uploads")
                .header("X-Bank-Id", BANK_70)
                .contentType(MediaType.APPLICATION_JSON)
                .content(issueBody("again.csv", HEADER + row)))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.fileName").value("ledger-first.csv"))
        .andExpect(jsonPath("$.uploadedAt").isNotEmpty())
        .andExpect(jsonPath("$.uploadId").doesNotExist());
    long second =
        issueAndPut(BANK_70, "ledger-second.csv", HEADER + row + row.replace("LDU1", "LDU3"));
    mockMvc.perform(
        post("/api/v1/bank/uploads/{id}/complete", second).header("X-Bank-Id", BANK_70));
    assertThat(awaitTerminal(second).get("status").asText()).isEqualTo("VALIDATION_FAILED");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transactions where ingest_job_id = ?", Integer.class, second))
        .isZero();
  }

  @Test
  void 완료상태_저장실패는_원장도_롤백한다() throws Exception {
    String row = "2022/09/01 03:20,070,AT1,010,AT2,30,US Dollar,30,US Dollar,ACH,0\n";
    long id = issueAndPut(BANK_70, "atomic.csv", HEADER + row);
    jdbc.execute(
        "create function test_reject_completed() returns trigger language plpgsql as $$ begin if NEW.file_name = 'atomic.csv' and NEW.status = 'COMPLETED' then raise exception 'test secret failure'; end if; return NEW; end $$");
    jdbc.execute(
        "create trigger reject_completed before update on batch_jobs for each row execute function test_reject_completed()");
    try {
      mockMvc.perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70));
      JsonNode result = awaitTerminal(id);
      assertThat(result.get("status").asText()).isEqualTo("FAILED");
      assertThat(result.get("insertedCount").asInt()).isZero();
      assertThat(result.get("errorMessage").asText()).doesNotContain("test secret");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transactions where ingest_job_id = ?", Integer.class, id))
          .isZero();
    } finally {
      jdbc.execute("drop trigger reject_completed on batch_jobs");
      jdbc.execute("drop function test_reject_completed()");
    }
  }

  @Test
  void 교차은행_동시파일은_모두_완료된다() throws Exception {
    String a = HEADER + "2022/09/01 04:20,070,CROSS1,012,CROSS2,40,US Dollar,40,US Dollar,ACH,0\n";
    String b = HEADER + "2022/09/01 04:21,012,CROSS2,070,CROSS1,41,US Dollar,41,US Dollar,ACH,0\n";
    long first = issueAndPut(BANK_70, "cross-a.csv", a);
    long second = issueAndPut(BANK_12, "cross-b.csv", b);
    try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var x =
          executor.submit(
              () ->
                  mockMvc
                      .perform(
                          post("/api/v1/bank/uploads/{id}/complete", first)
                              .header("X-Bank-Id", BANK_70))
                      .andExpect(status().isAccepted()));
      var y =
          executor.submit(
              () ->
                  mockMvc
                      .perform(
                          post("/api/v1/bank/uploads/{id}/complete", second)
                              .header("X-Bank-Id", BANK_12))
                      .andExpect(status().isAccepted()));
      x.get(20, java.util.concurrent.TimeUnit.SECONDS);
      y.get(20, java.util.concurrent.TimeUnit.SECONDS);
    }
    assertThat(awaitTerminal(first).get("status").asText()).isEqualTo("COMPLETED");
    for (int i = 0; i < 120; i++) {
      String status =
          jdbc.queryForObject(
              "select status from batch_jobs where job_id = ?", String.class, second);
      if (status.equals("COMPLETED")) return;
      assertThat(status).isNotIn("FAILED", "VALIDATION_FAILED");
      Thread.sleep(250);
    }
    throw new AssertionError("교차은행 처리 시간초과");
  }

  @Test
  void 동일파일_동시발급은_한건만_생성한다() throws Exception {
    assertThat(
            jdbc.queryForObject(
                "select count(*) from banks where bank_id=2000000001", Integer.class))
        .isZero();
    String body = issueBody("issue-race.csv", "issue-race-content");
    var barrier = new java.util.concurrent.CyclicBarrier(2);
    try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      java.util.concurrent.Callable<Integer> call =
          () -> {
            barrier.await();
            return mockMvc
                .perform(
                    post("/api/v1/bank/uploads")
                        .header("X-Bank-Id", "2000000001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn()
                .getResponse()
                .getStatus();
          };
      var x = executor.submit(call);
      var y = executor.submit(call);
      assertThat(
              java.util.List.of(
                  x.get(20, java.util.concurrent.TimeUnit.SECONDS),
                  y.get(20, java.util.concurrent.TimeUnit.SECONDS)))
          .containsExactlyInAnyOrder(201, 409);
    }
    assertThat(
            jdbc.queryForObject(
                "select count(*) from banks where bank_id=2000000001 and is_reporting",
                Integer.class))
        .isEqualTo(1);
  }

  @Test
  void DB최종_중복방어도_앞서_삽입한_청크까지_롤백한다() throws Exception {
    StringBuilder csv = new StringBuilder(HEADER);
    for (int i = 1; i <= 1001; i++) {
      csv.append("2022/09/01 05:20,070,RACE")
          .append(i)
          .append(",010,RACETO,1,US Dollar,")
          .append(i)
          .append(",US Dollar,ACH,0\n");
    }
    long id = issueAndPut(BANK_70, "unique-race.csv", csv.toString());
    // 사전검수 이후 마지막 청크에서 경쟁 INSERT의 unique violation을 재현한다.
    jdbc.execute(
        "create function test_unique_race() returns trigger language plpgsql as $$ begin if NEW.ingest_job_id = "
            + id
            + " and NEW.amount_paid = 1001 then raise unique_violation using message = 'simulated concurrent unique constraint'; end if; return NEW; end $$");
    jdbc.execute(
        "create trigger unique_race before insert on transactions for each row execute function test_unique_race()");
    try {
      mockMvc.perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70));
      JsonNode result = awaitTerminal(id);
      assertThat(result.get("status").asText()).isEqualTo("VALIDATION_FAILED");
      assertThat(result.get("insertedCount").asInt()).isZero();
      assertThat(result.get("errors").get(0).get("row").asInt()).isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transactions where ingest_job_id = ?", Integer.class, id))
          .isZero();
    } finally {
      jdbc.execute("drop trigger unique_race on transactions");
      jdbc.execute("drop function test_unique_race()");
    }
  }

  @Test
  void 만료후에도_재발급전이면_완료할수_있다() throws Exception {
    String csv = HEADER + "2022/09/01 06:20,070,EX1,010,EX2,60,US Dollar,60,US Dollar,ACH,0\n";
    long id = issueAndPut(BANK_70, "expired-only.csv", csv);
    jdbc.update(
        "update batch_jobs set url_expires_at = now() - interval '1 minute' where job_id = ?", id);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted());
    assertThat(awaitTerminal(id).get("status").asText()).isEqualTo("COMPLETED");
  }

  @Test
  void 재발급후_이전번호는_거절하고_새번호만_적재한다() throws Exception {
    String csv = HEADER + "2022/09/01 06:21,070,EX3,010,EX4,61,US Dollar,61,US Dollar,ACH,0\n";
    long oldId = issueAndPut(BANK_70, "expired-old.csv", csv);
    jdbc.update(
        "update batch_jobs set url_expires_at = now() - interval '1 minute' where job_id = ?",
        oldId);
    long newId = issueAndPut(BANK_70, "expired-new.csv", csv);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", oldId).header("X-Bank-Id", BANK_70))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("UPLOAD_SUPERSEDED"));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from transactions where ingest_job_id = ?", Integer.class, oldId))
        .isZero();
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", newId).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted());
    assertThat(awaitTerminal(newId).get("status").asText()).isEqualTo("COMPLETED");
  }

  @Test
  void 양쪽_계좌의_구분문자는_정상행과_함께_전체거절한다() throws Exception {
    for (int accountColumn : new int[] {2, 4}) {
      String normal =
          "2022/09/01 07:10,070,PIPEOK"
              + accountColumn
              + ",010,PIPEDEST,70,US Dollar,70,US Dollar,ACH,0\n";
      String[] invalid =
          ("2022/09/01 07:11,070,PIPEFROM,010,PIPETO,71,US Dollar,71,US Dollar,ACH,0").split(",");
      invalid[accountColumn] += "|EXTRA";
      long id =
          issueAndPut(
              BANK_70,
              "pipe-" + accountColumn + ".csv",
              HEADER + normal + String.join(",", invalid) + "\n");
      mockMvc
          .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70))
          .andExpect(status().isAccepted());
      JsonNode result = awaitTerminal(id);
      assertThat(result.get("status").asText()).isEqualTo("VALIDATION_FAILED");
      assertThat(result.get("missingCount").asInt()).isZero();
      assertThat(result.get("insertedCount").asInt()).isZero();
      assertThat(result.get("errors")).hasSize(1);
      assertThat(result.get("errors").get(0).get("row").asInt()).isEqualTo(3);
      assertThat(result.get("errors").get(0).get("column").asText()).isEqualTo("Account");
      assertThat(result.get("errors").get(0).get("reason").asText()).contains("|");
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from transactions where ingest_job_id = ?", Integer.class, id))
          .isZero();
    }
  }

  @Test
  void 일반계좌의_기존해시와_BOM_및_결제형식_구분문자는_유지한다() throws Exception {
    String csv =
        "\uFEFF"
            + HEADER
            + "2022/09/01 07:20,070,HASH1,010,HASH2,70,US Dollar,70,US Dollar,ACH|CUSTOM,0\n";
    long id = issueAndPut(BANK_70, "hash-compatible.csv", csv);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted());
    assertThat(awaitTerminal(id).get("status").asText()).isEqualTo("COMPLETED");
    assertThat(
            jdbc.queryForObject(
                "select row_hash from transactions where ingest_job_id = ?", String.class, id))
        .isEqualTo("52e298b05b4761fa0c47b58a0ef4b60fa00fbc425b768c76354269718c8afb0c");
  }

  @Test
  void 금액_범위초과는_정상행과_함께_파일전체를_거절한다() throws Exception {
    for (int column : new int[] {5, 7}) {
      for (String amount : new String[] {"123.1234567", "1000000000000000000"}) {
        String prefix = "AMTBAD" + column + (amount.contains(".") ? "S" : "I");
        String normal =
            "2022/09/01 08:10,070,"
                + prefix
                + "OK,010,"
                + prefix
                + "DEST,1,US Dollar,1,US Dollar,ACH,0\n";
        String[] invalid =
            ("2022/09/01 08:11,070,"
                    + prefix
                    + "BAD,010,"
                    + prefix
                    + "BADDEST,1,US Dollar,1,US Dollar,ACH,0")
                .split(",");
        invalid[column] = amount;
        long id =
            issueAndPut(
                BANK_70, prefix + ".csv", HEADER + normal + String.join(",", invalid) + "\n");
        mockMvc
            .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70))
            .andExpect(status().isAccepted());
        JsonNode result = awaitTerminal(id);
        assertThat(result.get("status").asText()).isEqualTo("VALIDATION_FAILED");
        assertThat(result.get("rowCount").asInt()).isEqualTo(2);
        assertThat(result.get("insertedCount").asInt()).isZero();
        assertThat(result.get("missingCount").asInt()).isZero();
        assertThat(result.get("errors")).hasSize(1);
        JsonNode error = result.get("errors").get(0);
        assertThat(error.get("row").asInt()).isEqualTo(3);
        assertThat(error.get("column").asText())
            .isEqualTo(column == 5 ? "Amount Received" : "Amount Paid");
        assertThat(error.get("reason").asText()).contains(amount.contains(".") ? "6자리" : "18자리");
        assertThat(
                jdbc.queryForObject(
                    "select count(*) from transactions where ingest_job_id = ?", Integer.class, id))
            .isZero();
        assertThat(
                jdbc.queryForObject(
                    "select count(*) from accounts where account_number like ?",
                    Integer.class,
                    prefix + "%"))
            .isZero();
      }
    }
  }

  @Test
  void 금액_최댓값과_끝자리0은_USD에서_정확히_저장한다() throws Exception {
    String maximum = "999999999999999999.999999";
    String csv =
        HEADER
            + "2022/09/01 08:20,070,AMTMAX,010,AMTMAXDEST,"
            + maximum
            + ",US Dollar,"
            + maximum
            + ",US Dollar,ACH,0\n"
            + "2022/09/01 08:21,070,AMTZERO,010,AMTZERODEST,123.1234560,US Dollar,1.0000000,US Dollar,ACH,0\n";
    long id = issueAndPut(BANK_70, "amount-exact.csv", csv);
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", BANK_70))
        .andExpect(status().isAccepted());
    JsonNode result = awaitTerminal(id);
    assertThat(result.get("status").asText()).isEqualTo("COMPLETED");
    assertThat(result.get("insertedCount").asInt()).isEqualTo(2);
    for (String column : new String[] {"amount_received", "amount_paid", "amount_usd"}) {
      assertThat(
              jdbc.queryForObject(
                  "select max(" + column + ") from transactions where ingest_job_id = ?",
                  BigDecimal.class,
                  id))
          .isEqualByComparingTo(maximum);
    }
    assertThat(
            jdbc.queryForObject(
                "select min(amount_received) from transactions where ingest_job_id = ?",
                BigDecimal.class,
                id))
        .isEqualByComparingTo("123.123456");
    assertThat(
            jdbc.queryForObject(
                "select min(amount_paid) from transactions where ingest_job_id = ?",
                BigDecimal.class,
                id))
        .isEqualByComparingTo("1");
  }

  @Test
  void 첫발급은_보고은행을_등록하고_기존_정보와_키값은_보존한다() throws Exception {
    jdbc.update(
        "insert into banks(bank_id, name, country, api_key_hash) values (2000000002, 'existing', 'country', ?)",
        "f".repeat(64));
    issueAndPut("2000000002", "existing.csv", "metadata-preserve");
    assertThat(jdbc.queryForObject("select name from banks where bank_id=2000000002", String.class))
        .isEqualTo("existing");
    assertThat(
            jdbc.queryForObject("select country from banks where bank_id=2000000002", String.class))
        .isEqualTo("country");
    assertThat(
            jdbc.queryForObject(
                "select api_key_hash from banks where bank_id=2000000002", String.class))
        .isEqualTo("f".repeat(64));
    assertThat(
            jdbc.queryForObject(
                "select is_reporting from banks where bank_id=2000000002", Boolean.class))
        .isTrue();
    long id = issueAndPut("2000000003", "unknown.csv", "unknown-reference");
    assertThat(jdbc.queryForObject("select name from banks where bank_id=2000000003", String.class))
        .isNull();
    mockMvc
        .perform(get("/api/v1/bank/uploads/{id}", id).header("X-Bank-Id", "2000000004"))
        .andExpect(status().isNotFound());
    mockMvc
        .perform(post("/api/v1/bank/uploads/{id}/complete", id).header("X-Bank-Id", "2000000004"))
        .andExpect(status().isNotFound());
    assertThat(
            jdbc.queryForObject(
                "select count(*) from banks where bank_id=2000000004", Integer.class))
        .isZero();
  }

  private long issueAndPut(String bankId, String fileName, String csv) throws Exception {
    MvcResult issued =
        mockMvc
            .perform(
                post("/api/v1/bank/uploads")
                    .header("X-Bank-Id", bankId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(issueBody(fileName, csv)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.bankId").isNumber())
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
    String sha =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes));
    return "{\"fileName\":\""
        + fileName
        + "\",\"sizeBytes\":"
        + bytes.length
        + ",\"checksumSha256\":\""
        + sha
        + "\",\"businessDate\":\""
        + (content.contains("2022/09/02") ? "2022-09-02" : "2022-09-01")
        + "\"}";
  }

  private JsonNode awaitTerminal(long uploadId) throws Exception {
    Set<String> terminal = Set.of("COMPLETED", "VALIDATION_FAILED", "FAILED");
    for (int i = 0; i < 120; i++) {
      MvcResult result =
          mockMvc
              .perform(get("/api/v1/bank/uploads/{id}", uploadId).header("X-Bank-Id", BANK_70))
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
