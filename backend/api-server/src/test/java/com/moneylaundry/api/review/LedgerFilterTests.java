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
  String a1, a2, b1, c1;
  long t1, t2, t3, t4;

  @BeforeEach
  void setup() throws Exception {
    jdbc.update(
        "update core.users set password_hash=? where username='l1a'",
        encoder.encode("Test-password-123"));
    jdbc.update("insert into core.banks(bank_id) values(9001) on conflict do nothing");
    long oa = owner(ownerA), ob = owner(ownerB), oc = owner(ownerC);
    long ia1 = account(oa), ia2 = account(oa), ib1 = account(ob);
    long ic1 = account(oc);
    a1 = id(ia1);
    a2 = id(ia2);
    b1 = id(ib1);
    c1 = id(ic1);
    t1 = tx(ia1, ib1);
    t2 = tx(ib1, ia2);
    t3 = tx(ic1, ib1);
    t4 = tx(ia2, ia1);
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
        .andExpect(jsonPath("$.content[*].id").value(Matchers.containsInAnyOrder(a1, a2)));
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
    get("/api/v1/ledger/accounts?account=999-9999").andExpect(jsonPath("$.totalElements").value(0));
  }

  @Test
  void unfiltered_owner_and_account_lists_match_their_tables() throws Exception {
    int owners = jdbc.queryForObject("select count(*) from core.owners", Integer.class);
    int accounts = jdbc.queryForObject("select count(*) from core.accounts", Integer.class);
    String firstOwner =
        jdbc.queryForObject(
            "select service_owner_id::text from core.owners order by service_owner_id limit 1",
            String.class);
    String firstAccount =
        jdbc.queryForObject(
            "select service_account_id::text from core.accounts order by service_account_id limit 1",
            String.class);
    get("/api/v1/ledger/owners")
        .andExpect(jsonPath("$.totalElements").value(owners))
        .andExpect(jsonPath("$.content[0].id").value(firstOwner))
        .andExpect(jsonPath("$.content[0].name").isNotEmpty());
    get("/api/v1/ledger/accounts")
        .andExpect(jsonPath("$.totalElements").value(accounts))
        .andExpect(jsonPath("$.content[0].id").value(firstAccount))
        .andExpect(jsonPath("$.content[0].ownerId").isNotEmpty())
        .andExpect(jsonPath("$.content[0].ownerName").isNotEmpty())
        .andExpect(jsonPath("$.content[0].bankId").isNumber());
    // 필터가 있으면 거래에 나온 계좌만 센다.
    int active =
        jdbc.queryForObject(
            "select count(*) from (select from_account_id from ledger.transactions where payment_format='ACH' union select to_account_id from ledger.transactions where payment_format='ACH') q",
            Integer.class);
    get("/api/v1/ledger/accounts?payments=ACH")
        .andExpect(jsonPath("$.totalElements").value(active));
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

  private long account(long owner) {
    return jdbc.queryForObject(
        "insert into core.accounts(bank_id,owner_id) values(9001,?) returning account_id",
        Long.class,
        owner);
  }

  private String id(long account) {
    return jdbc.queryForObject(
        "select service_account_id from core.accounts where account_id=?", String.class, account);
  }

  private long tx(long from, long to) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(now(),current_date,?,?,1,'USD',1,'USD','ACH',1,'fx_rates_usd_v1') returning tx_id",
        Long.class,
        from,
        to);
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
