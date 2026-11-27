package com.moneylaundry.api.common;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.io.ByteArrayInputStream;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

/** 실제 HTTP 서버에서 큰 JSON 응답이 gzip 으로 나가는지 확인한다(화면 board 응답 크기 줄이기). */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "spring.profiles.active=local")
@Import(TestcontainersConfiguration.class)
class ResponseCompressionTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder passwords;
  @Autowired ObjectMapper json;

  @Value("${local.server.port}")
  int port;

  @MockitoBean AnalysisScheduler scheduler;

  @Test
  void large_json_is_gzipped_only_when_the_client_accepts_it() throws Exception {
    String password = UUID.randomUUID().toString();
    jdbc.update(
        "update core.users set password_hash=? where username='l1a'", passwords.encode(password));
    try (var client =
        HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
            .connectTimeout(Duration.ofSeconds(3))
            .build()) {
      String base = "http://127.0.0.1:" + port;
      var csrf =
          json.readTree(
              client
                  .send(
                      HttpRequest.newBuilder(URI.create(base + "/api/auth/csrf")).GET().build(),
                      HttpResponse.BodyHandlers.ofString())
                  .body());
      var login =
          client.send(
              HttpRequest.newBuilder(URI.create(base + "/api/auth/login"))
                  .header(csrf.get("headerName").asString(), csrf.get("token").asString())
                  .header("Content-Type", "application/x-www-form-urlencoded")
                  .POST(HttpRequest.BodyPublishers.ofString("username=l1a&password=" + password))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(login.statusCode()).isEqualTo(200);

      var plain =
          client.send(
              HttpRequest.newBuilder(URI.create(base + "/api/v1/rule-templates")).GET().build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertThat(plain.statusCode()).isEqualTo(200);
      assertThat(plain.headers().firstValue("Content-Encoding")).isEmpty();
      assertThat(plain.body().length).isGreaterThan(2048);

      var gzipped =
          client.send(
              HttpRequest.newBuilder(URI.create(base + "/api/v1/rule-templates"))
                  .header("Accept-Encoding", "gzip")
                  .GET()
                  .build(),
              HttpResponse.BodyHandlers.ofByteArray());
      assertThat(gzipped.statusCode()).isEqualTo(200);
      assertThat(gzipped.headers().firstValue("Content-Encoding")).contains("gzip");
      assertThat(gzipped.body().length).isLessThan(plain.body().length);
      try (var unzip = new GZIPInputStream(new ByteArrayInputStream(gzipped.body()))) {
        assertThat(new String(unzip.readAllBytes(), StandardCharsets.UTF_8))
            .isEqualTo(new String(plain.body(), StandardCharsets.UTF_8));
      }
    }
  }
}
