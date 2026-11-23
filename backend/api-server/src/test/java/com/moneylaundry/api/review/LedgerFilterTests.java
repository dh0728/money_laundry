package com.moneylaundry.api.review;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.util.UUID;
import org.hamcrest.Matchers;
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

/** 원장 조회의 소유주·계좌·방향 필터를 실제 로그인 세션으로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=dev"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class LedgerFilterTests {
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
  @MockitoBean com.moneylaundry.api.ingest.storage.UploadStore store;
  MockHttpSession session = new MockHttpSession();

  UUID ownerA = UUID.randomUUID(), ownerB = UUID.randomUUID(), ownerC = UUID.randomUUID();
  UUID a1 = UUID.randomUUID(), a2 = UUID.randomUUID(), b1 = UUID.randomUUID();
  UUID c1 = UUID.randomUUID();
  long t1, t2, t3, t4;

  @BeforeEach
  void setup() throws Exception {
    jdbc.update(
        "update core.users set password_hash=? where username='l1a'",
        encoder.encode("Test-password-123"));
    jdbc.update("insert into core.banks(bank_id) values(9001) on conflict do nothing");
    long oa = owner(ownerA), ob = owner(ownerB), oc = owner(ownerC);
    long ia1 = account(a1, oa), ia2 = account(a2, oa), ib1 = account(b1, ob);
    long ic1 = account(c1, oc);
    t1 = tx(ia1, ib1, "ACTIVE");
    t2 = tx(ib1, ia2, "ACTIVE");
    t3 = tx(ic1, ib1, "ACTIVE");
    t4 = tx(ia2, ia1, "ACTIVE");
    tx(ia1, ic1, "SUPERSEDED");
    login();
  }

  @Test
  void owner_filter_returns_transactions_on_either_side() throws Exception {
    get("/api/v1/ledger/transactions?owner=" + ownerA)
        .andExpect(jsonPath("$.totalElements").value(3))
        .andExpect(
            jsonPath("$.content[*].txId")
                .value(Matchers.containsInAnyOrder((int) t1, (int) t2, (int) t4)));
    get("/api/v1/ledger/accounts?owner=" + ownerA)
        .andExpect(jsonPath("$.totalElements").value(2))
        .andExpect(
            jsonPath("$.content[*].id")
                .value(Matchers.containsInAnyOrder(a1.toString(), a2.toString())));
    get("/api/v1/ledger/owners?owner=" + ownerA)
        .andExpect(
            jsonPath("$.content[*].id")
                .value(Matchers.containsInAnyOrder(ownerA.toString(), ownerB.toString())));
  }

  @Test
  void account_filter_and_directions() throws Exception {
    get("/api/v1/ledger/transactions?account=" + b1)
        .andExpect(jsonPath("$.totalElements").value(3))
        .andExpect(
            jsonPath("$.content[*].txId")
                .value(Matchers.containsInAnyOrder((int) t1, (int) t2, (int) t3)));
    get("/api/v1/ledger/transactions?account=" + a1 + "&directions=OUT")
        .andExpect(jsonPath("$.totalElements").value(1))
        .andExpect(jsonPath("$.content[0].txId").value((int) t1));
    get("/api/v1/ledger/transactions?account=" + a1 + "&directions=IN")
        .andExpect(jsonPath("$.totalElements").value(1))
        .andExpect(jsonPath("$.content[0].txId").value((int) t4));
    get("/api/v1/ledger/transactions?owner=" + ownerA + "&account=" + b1)
        .andExpect(jsonPath("$.totalElements").value(2));
  }

  @Test
  void unknown_owner_or_account_is_empty() throws Exception {
    get("/api/v1/ledger/transactions?owner=" + UUID.randomUUID())
        .andExpect(jsonPath("$.totalElements").value(0));
    get("/api/v1/ledger/accounts?account=" + UUID.randomUUID())
        .andExpect(jsonPath("$.totalElements").value(0));
  }

  private org.springframework.test.web.servlet.ResultActions get(String url) throws Exception {
    return mvc.perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(url)
                .session(session))
        .andExpect(status().isOk());
  }

  private long owner(UUID id) {
    return jdbc.queryForObject(
        "insert into core.owners(service_owner_id,display_name) values(?,?) returning owner_id",
        Long.class,
        id,
        "가명-" + id);
  }

  private long account(UUID id, long owner) {
    return jdbc.queryForObject(
        "insert into core.accounts(service_account_id,bank_id,owner_id) values(?,9001,?) returning account_id",
        Long.class,
        id,
        owner);
  }

  private long tx(long from, long to, String status) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,integration_status) values(now(),current_date,?,?,1,'USD',1,'USD','ACH',1,'fx_rates_usd_v1',?) returning tx_id",
        Long.class,
        from,
        to,
        status);
  }

  private void login() throws Exception {
    String token = csrf();
    mvc.perform(
            post("/api/auth/login")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .param("username", "l1a")
                .param("password", "Test-password-123"))
        .andExpect(status().isOk());
  }

  private String csrf() throws Exception {
    var result =
        mvc.perform(
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                        "/api/auth/csrf")
                    .session(session))
            .andExpect(status().isOk())
            .andReturn();
    return new ObjectMapper()
        .readTree(result.getResponse().getContentAsString())
        .get("token")
        .asString();
  }
}
