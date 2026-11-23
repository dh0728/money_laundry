package com.moneylaundry.api.settings;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 설정 화면의 팀원 권한 변경과 위험 구간 저장을 실제 로그인 세션과 HTTP 경로로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SettingsApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;

  @BeforeEach
  @AfterEach
  void reset() {
    jdbc.update("update core.users set role='STAFF' where username='l1b'");
    jdbc.update("update ops.model_risk_bands set medium=70,high=90,updated_by=null");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a','l1b','admin')",
        encoder.encode("Test-password-123"));
  }

  void login(String username) throws Exception {
    session = new MockHttpSession();
    csrf();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", username)
                .param("password", "Test-password-123"))
        .andExpect(status().isOk());
    csrf();
  }

  void csrf() throws Exception {
    token =
        object(
                mvc.perform(get("/api/auth/csrf").session(session))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("token")
            .toString();
  }

  ResultActions send(MockHttpServletRequestBuilder request, Object body) throws Exception {
    return mvc.perform(
        request
            .session(session)
            .header("X-CSRF-TOKEN", token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(encode(body)));
  }

  long id(String username) {
    return jdbc.queryForObject(
        "select user_id from core.users where username=?", Long.class, username);
  }

  @Test
  void admin_changes_another_members_role_and_the_new_role_applies_at_once() throws Exception {
    String role = "/api/v1/settings/team/" + id("l1b") + "/role";
    login("l1a");
    send(post(role), Map.of("role", "ADMIN")).andExpect(status().isForbidden());

    login("admin");
    send(post(role), Map.of("role", "OWNER")).andExpect(status().isBadRequest());
    send(post("/api/v1/settings/team/" + id("admin") + "/role"), Map.of("role", "STAFF"))
        .andExpect(status().isConflict()); // 본인 권한은 바꿀 수 없다
    send(post("/api/v1/settings/team/999999/role"), Map.of("role", "ADMIN"))
        .andExpect(status().isNotFound());
    send(post(role), Map.of("role", "ADMIN"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.role").value("ADMIN"));
    mvc.perform(get("/api/v1/demo/users").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + id("l1b") + ")].role").value("ADMIN"));

    // 관리자가 된 팀원은 관리자 설정을 바꿀 수 있다.
    login("l1b");
    send(post("/api/v1/settings/model-risk-bands"), Map.of("medium", 60, "high", 85))
        .andExpect(status().isOk());
  }

  @Test
  void risk_bands_are_read_by_everyone_and_saved_by_admin_only() throws Exception {
    login("l1a");
    mvc.perform(get("/api/v1/settings/model-risk-bands").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.medium").value(70))
        .andExpect(jsonPath("$.high").value(90));
    send(post("/api/v1/settings/model-risk-bands"), Map.of("medium", 60, "high", 85))
        .andExpect(status().isForbidden());

    login("admin");
    for (var invalid :
        List.of(
            Map.of("medium", 90, "high", 90),
            Map.of("medium", 0, "high", 50),
            Map.of("medium", 50, "high", 100),
            Map.of("medium", 50)))
      send(post("/api/v1/settings/model-risk-bands"), invalid).andExpect(status().isBadRequest());
    send(post("/api/v1/settings/model-risk-bands"), Map.of("medium", 60, "high", 85))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.medium").value(60))
        .andExpect(jsonPath("$.high").value(85));

    login("l1a");
    mvc.perform(get("/api/v1/settings/model-risk-bands").session(session))
        .andExpect(jsonPath("$.medium").value(60))
        .andExpect(jsonPath("$.high").value(85));
  }
}
