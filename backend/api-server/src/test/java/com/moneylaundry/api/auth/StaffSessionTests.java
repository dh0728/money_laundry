package com.moneylaundry.api.auth;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(properties = "spring.profiles.active=dev")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class StaffSessionTests {
  @org.springframework.test.context.DynamicPropertySource
  static void keys(org.springframework.test.context.DynamicPropertyRegistry r) {
    byte[] encryption = new byte[32], search = new byte[32];
    new java.security.SecureRandom().nextBytes(encryption);
    new java.security.SecureRandom().nextBytes(search);
    r.add(
        "app.ingest.encryption-key",
        () -> java.util.Base64.getEncoder().encodeToString(encryption));
    r.add("app.ingest.search-key", () -> java.util.Base64.getEncoder().encodeToString(search));
    r.add("app.ingest.key-version", () -> "test");
  }

  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  @MockitoBean com.moneylaundry.api.storage.UploadStore store;
  MockHttpSession session;
  String token;

  @Test
  void python_offline_hash_matches_spring_encoder() {
    assertThat(
            encoder.matches(
                "compatibility-test",
                "000102030405060708090a0b0c0d0e0f03dc128a55290cce4ac5014aab7ffcc2aebf4300f7f2517962ac6f03615ecb0f"))
        .isTrue();
  }

  @Test
  void caller_header_cannot_change_session_actor() throws Exception {
    login("l1a");
    long other = jdbc.queryForObject("select user_id from users where username='l1b'", Long.class);
    long alertId =
        jdbc.queryForObject(
            "insert into alerts(assignee_id) values(?) returning alert_id", Long.class, other);
    long id =
        jdbc.queryForObject(
            "select case_id from review_cases where alert_id=?", Long.class, alertId);
    String body =
        "{\"requestId\":\""
            + java.util.UUID.randomUUID()
            + "\",\"action\":\"COMMENT\",\"comment\":\"test\",\"selections\":[{\"caseId\":"
            + id
            + ",\"revision\":1,\"groupId\":0,\"txIds\":[]}]}";
    mvc.perform(
            post("/api/v1/review/commands")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .header("X-Demo-User-Id", other)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
  }

  @BeforeEach
  void setup() {
    jdbc.update(
        "update users set password_hash=? where username in ('l1a','admin')",
        encoder.encode("Test-password-123"));
    session = new MockHttpSession();
  }

  void csrf() throws Exception {
    var result =
        mvc.perform(get("/api/auth/csrf").session(session)).andExpect(status().isOk()).andReturn();
    token =
        new ObjectMapper()
            .readTree(result.getResponse().getContentAsString())
            .get("token")
            .asString();
  }

  void login(String username) throws Exception {
    csrf();
    String old = session.getId();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", username)
                .param("password", "Test-password-123"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.password_hash").doesNotExist());
    assertThat(session.getId()).isNotEqualTo(old);
    csrf();
  }

  @Test
  void anonymous_and_forged_identity_are_rejected() throws Exception {
    mvc.perform(get("/api/v1/ledger/transactions").header("X-Demo-User-Id", "1"))
        .andExpect(status().isUnauthorized());
    mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    csrf();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", "l1a")
                .param("password", "wrong"))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", "l1b")
                .param("password", "anything"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void staff_session_csrf_logout_and_admin_boundary() throws Exception {
    login("l1a");
    mvc.perform(get("/api/me").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("STAFF"));
    mvc.perform(get("/api/v1/ledger/transactions").session(session)).andExpect(status().isOk());
    mvc.perform(
            post("/api/v1/demo/clock")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .contentType("application/json")
                .content("{\"businessAt\":\"2023-09-02T00:00:00Z\",\"revision\":0}"))
        .andExpect(status().isForbidden());
    mvc.perform(post("/api/auth/logout").session(session)).andExpect(status().isForbidden());
    mvc.perform(post("/api/auth/logout").session(session).header("X-CSRF-TOKEN", token))
        .andExpect(status().isNoContent());
    assertThat(session.isInvalid()).isTrue();
    mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
  }

  @Test
  void admin_clock_requires_csrf_and_uses_business_time() throws Exception {
    jdbc.execute("truncate batch_jobs,alerts,review_cases,review_requests cascade");
    jdbc.update("update demo_business_clock set business_at=null,revision=0");
    login("admin");
    String body = "{\"businessAt\":\"2023-09-02T00:00:00Z\",\"revision\":0}";
    mvc.perform(
            post("/api/v1/demo/clock")
                .session(session)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/demo/clock")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.configured").value(true));
    mvc.perform(get("/api/me").session(session)).andExpect(status().isOk());
  }
}
