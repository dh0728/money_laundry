package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import java.nio.charset.StandardCharsets;
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

/** 룰 엔진의 템플릿·검증·만들기·저장·목록·상세·초안 삭제를 실제 로그인 세션과 HTTP 경로로 확인한다. */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RuleApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired PasswordEncoder encoder;
  @Autowired RuleCatalog catalog;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate rules.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-17T00:00:00Z',revision=0");
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

  ResultActions read(String path) throws Exception {
    return mvc.perform(get(path).session(session));
  }

  ResultActions remove(String path) throws Exception {
    return mvc.perform(delete(path).session(session).header("X-CSRF-TOKEN", token));
  }

  static Map<String, Object> json(ResultActions result) throws Exception {
    return object(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> group(Map<String, Object> definition, String key) {
    return (Map<String, Object>) definition.get(key);
  }

  static Map<String, Object> body(Object... pairs) {
    var body = new LinkedHashMap<String, Object>();
    for (int i = 0; i < pairs.length; i += 2) body.put(pairs[i].toString(), pairs[i + 1]);
    return body;
  }

  /** 템플릿 기본값으로 룰을 만들고 {ruleId, versionId} 를 돌려준다. */
  long[] created(String name, String template) throws Exception {
    var created =
        json(
            send(post("/api/v1/rules"), body("name", name, "template", template))
                .andExpect(status().isOk()));
    return new long[] {number(created.get("ruleId")), number(created.get("versionId"))};
  }

  static String version(long[] ids) {
    return "/api/v1/rules/" + ids[0] + "/versions/" + ids[1];
  }

  @Test
  void templates_come_from_the_catalog_and_need_a_staff_session() throws Exception {
    mvc.perform(get("/api/v1/rule-templates")).andExpect(status().isUnauthorized());
    login("l1a");
    var templates = json(read("/api/v1/rule-templates").andExpect(status().isOk()));
    var available = new ArrayList<String>();
    for (var template : rows(templates.get("templates")))
      if (Boolean.TRUE.equals(template.get("available")))
        available.add(template.get("key").toString());
    assertThat(available)
        .containsExactly(
            "FAN_OUT",
            "FAN_IN",
            "GATHER_SCATTER",
            "SCATTER_GATHER",
            "CYCLE",
            "RANDOM",
            "LARGE_TX",
            "STRUCTURING",
            "SAME_AMOUNT",
            "PASS_THROUGH");
    assertThat(rows(templates.get("templates"))).hasSize(13);
    read("/api/v1/rule-templates")
        .andExpect(jsonPath("$.templates[1].key").value("FAN_IN"))
        .andExpect(jsonPath("$.templates[1].defaults.windowMinutes").value(10080))
        .andExpect(jsonPath("$.templates[1].defaults.filter.items[1].field").value("FX_FOLLOW"))
        .andExpect(jsonPath("$.filterFields.FIRST_PAIR.label").value("처음 거래하는 상대"))
        .andExpect(jsonPath("$.metrics.RETAIN_RATIO").doesNotExist())
        .andExpect(jsonPath("$.windows.length()").value(7))
        .andExpect(jsonPath("$.then[1].key").value("CREATE_ALERT"))
        .andExpect(jsonPath("$.then[1].enabled").value(false));
  }

  @Test
  void draft_is_created_from_defaults_saved_by_its_author_and_listed() throws Exception {
    login("l1a");
    send(post("/api/v1/rules"), body("name", "이름만")).andExpect(status().isBadRequest());
    send(post("/api/v1/rules"), body("name", " ", "template", "FAN_OUT"))
        .andExpect(status().isBadRequest());
    send(post("/api/v1/rules"), body("name", "휴면", "template", "DORMANT_ACTIVATION"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    var alerting = catalog.defaults("FAN_OUT");
    alerting.put("then", "CREATE_ALERT");
    send(
            post("/api/v1/rules"),
            body("name", "Alert 생성", "template", "FAN_OUT", "definition", alerting))
        .andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("select count(*) from rules.rules", Long.class)).isZero();

    var created =
        json(
            send(post("/api/v1/rules"), body("name", "  분산 송금 감시  ", "template", "FAN_OUT"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").value(0)));
    long[] ids = {number(created.get("ruleId")), number(created.get("versionId"))};
    assertThat(created.get("code").toString()).matches("RULE-\\d{3,}");

    read("/api/v1/rules")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.content.length()").value(1))
        .andExpect(jsonPath("$.content[0].code").value(created.get("code")))
        .andExpect(jsonPath("$.content[0].name").value("분산 송금 감시"))
        .andExpect(jsonPath("$.content[0].templateName").value("FAN-OUT · 분산 송금"))
        .andExpect(jsonPath("$.content[0].status").value("DRAFT"))
        .andExpect(jsonPath("$.content[0].versionNo").value(1))
        .andExpect(jsonPath("$.content[0].then").value("ATTACH_EVIDENCE"))
        .andExpect(
            jsonPath("$.content[0].summary").value("첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 6개 이상 · 7일"))
        .andExpect(jsonPath("$.content[0].owner").value("L1 심사자 A"))
        .andExpect(jsonPath("$.counts.DRAFT").value(1))
        .andExpect(jsonPath("$.counts.ACTIVE").value(0));
    read("/api/v1/rules/" + ids[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("DRAFT"))
        .andExpect(jsonPath("$.operating").doesNotExist())
        .andExpect(jsonPath("$.working.versionNo").value(1))
        .andExpect(jsonPath("$.working.revision").value(0))
        .andExpect(jsonPath("$.working.editable").value(true))
        .andExpect(jsonPath("$.working.deletable").value(true))
        .andExpect(jsonPath("$.working.definition.schema").value(2))
        .andExpect(jsonPath("$.working.definition.filter.items[1].value").value(1000))
        .andExpect(
            jsonPath("$.working.sentence")
                .value(
                    "처음 거래하는 상대이고 건당 금액이 1,000 USD 이상인 거래만 세어, 한 송금 계좌에서 7일 안에 서로 다른 수취 계좌 수가 6개 이상이면 Alert에 근거로 표시합니다."))
        .andExpect(jsonPath("$.events[0].action").value("CREATED"))
        .andExpect(jsonPath("$.events[0].actor").value("L1 심사자 A"))
        .andExpect(jsonPath("$.events[0].versionNo").value(1));
    read("/api/v1/rules/999999").andExpect(status().isNotFound());

    // 수취 계좌 4개 · 3일로 고친다. 값이 빈 초안도 저장된다.
    var edited = catalog.defaults("FAN_OUT");
    edited.put("windowMinutes", 4320);
    group(edited, "where")
        .put("items", List.of(body("metric", "DISTINCT_COUNTERPARTIES", "cmp", "GTE", "value", 4)));
    send(put(version(ids)), body("name", "분산 송금 3일", "definition", edited, "revision", 0))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.revision").value(1))
        .andExpect(jsonPath("$.canRun").value(true))
        .andExpect(jsonPath("$.summary").value("첫 거래 상대 · 건당 1,000 USD 이상 · 수취 계좌 4개 이상 · 3일"));
    send(put(version(ids)), body("name", "분산 송금 3일", "definition", edited, "revision", 0))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));
    group(edited, "where")
        .put("items", List.of(body("metric", "DISTINCT_COUNTERPARTIES", "cmp", "GTE")));
    send(put(version(ids)), body("name", "분산 송금 3일", "definition", edited, "revision", 1))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.revision").value(2))
        .andExpect(jsonPath("$.canSave").value(true))
        .andExpect(jsonPath("$.canRun").value(false))
        .andExpect(jsonPath("$.items[1].key").value("CONDITIONS"))
        .andExpect(jsonPath("$.items[1].ok").value(false));
    group(edited, "where").put("items", List.of(body("metric", "OUT_IN_RATIO", "cmp", "GTE")));
    send(put(version(ids)), body("name", "분산 송금 3일", "definition", edited, "revision", 2))
        .andExpect(status().isBadRequest());
    send(put(version(ids)), body("name", "분산 송금 3일", "definition", catalog.defaults("FAN_OUT")))
        .andExpect(status().isBadRequest()); // revision 필수
    read("/api/v1/rules/" + ids[0])
        .andExpect(jsonPath("$.name").value("분산 송금 3일"))
        .andExpect(jsonPath("$.working.revision").value(2))
        .andExpect(jsonPath("$.working.definition.windowMinutes").value(4320))
        .andExpect(jsonPath("$.events.length()").value(3))
        .andExpect(jsonPath("$.events[0].action").value("EDITED"));

    login("l1b");
    send(
            put(version(ids)),
            body("name", "남의 초안", "definition", catalog.defaults("FAN_OUT"), "revision", 2))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("FORBIDDEN_ROLE"));
    read("/api/v1/rules/" + ids[0])
        .andExpect(jsonPath("$.working.editable").value(false))
        .andExpect(jsonPath("$.working.deletable").value(false));
  }

  @Test
  void validate_returns_checklist_sentence_and_warnings_without_saving() throws Exception {
    login("l1a");
    var checked =
        json(
            send(
                    post("/api/v1/rules/validate"),
                    body("template", "FAN_IN", "definition", catalog.defaults("FAN_IN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(4))
                .andExpect(jsonPath("$.items[0].key").value("FORMAT"))
                .andExpect(jsonPath("$.items[0].ok").value(true))
                .andExpect(jsonPath("$.canSave").value(true))
                .andExpect(jsonPath("$.canRun").value(true))
                .andExpect(jsonPath("$.summary").value("첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일")));
    assertThat(checked.get("sentence").toString()).startsWith("처음 거래하는 상대이고 환전 직후 송금인 거래만 세어,");
    // 원장이 비어 있으면 경고만 한다.
    assertThat(rows(checked.get("warnings")).toString()).contains("원장에 거래가 없습니다.");

    var outside = catalog.defaults("FAN_IN");
    group(outside, "where").put("items", List.of(body("metric", "OUT_IN_RATIO", "cmp", "GTE")));
    checked =
        json(
            send(post("/api/v1/rules/validate"), body("template", "FAN_IN", "definition", outside))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.canSave").value(false))
                .andExpect(jsonPath("$.items[0].ok").value(false)));
    assertThat(checked.get("sentence")).isNull();
    send(post("/api/v1/rules/validate"), body("definition", outside))
        .andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("select count(*) from rules.rules", Long.class)).isZero();

    // 원장이 3일치뿐이면 "처음 거래하는 상대"를 쓰는 룰에 경고한다.
    jdbc.update("insert into core.banks(bank_id) values(999017) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'룰 소유자') returning owner_id",
            Long.class);
    var accounts = new ArrayList<Long>();
    for (int i = 0; i < 2; i++)
      accounts.add(
          jdbc.queryForObject(
              "insert into core.accounts(bank_id,service_account_id,owner_id) values(999017,gen_random_uuid(),?) returning account_id",
              Long.class,
              owner));
    for (String at : List.of("2023-09-01 10:00+09", "2023-09-03 11:00+09"))
      jdbc.update(
          "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::timestamptz,(?::timestamptz at time zone 'Asia/Seoul')::date,?,?,10,'USD',10,'USD','ACH',10,'test')",
          at,
          at,
          accounts.get(0),
          accounts.get(1));
    checked =
        json(
            send(
                    post("/api/v1/rules/validate"),
                    body("template", "FAN_IN", "definition", catalog.defaults("FAN_IN")))
                .andExpect(jsonPath("$.items[2].key").value("DATA"))
                .andExpect(jsonPath("$.items[2].message").value("원장 3일치로 계산할 수 있습니다."))
                .andExpect(jsonPath("$.canRun").value(true)));
    assertThat(rows(checked.get("warnings")).toString()).contains("원장에 쌓인 기간이 3일입니다.");
  }

  @Test
  void draft_is_deleted_by_its_author_or_admin_and_other_versions_are_kept() throws Exception {
    login("l1a");
    long[] mine = created("내 초안", "FAN_IN");
    long[] forAdmin = created("관리자가 지울 초안", "CYCLE");
    long[] live = created("운영 중 룰", "FAN_IN");

    login("l1b");
    remove(version(mine)).andExpect(status().isForbidden());
    login("l1a");
    remove(version(mine)).andExpect(status().isNoContent());
    remove(version(mine)).andExpect(status().isNotFound());
    read("/api/v1/rules/" + mine[0]).andExpect(status().isNotFound());
    login("admin");
    remove(version(forAdmin)).andExpect(status().isNoContent());
    assertThat(
            jdbc.queryForObject(
                "select count(*) from rules.events where rule_id in (?,?)",
                Long.class,
                mine[0],
                forAdmin[0]))
        .isZero();

    // 상태 명령은 아직 없으므로 운영 버전과 새 초안을 표에 직접 만든다.
    jdbc.update("update rules.rule_versions set status='ACTIVE' where version_id=?", live[1]);
    long draft =
        jdbc.queryForObject(
            """
            insert into rules.rule_versions(rule_id,version_no,status,definition,definition_digest,summary,author_id,created_at)
            select rule_id,2,'DRAFT',definition,definition_digest,summary,author_id,created_at
            from rules.rule_versions where version_id=? returning version_id
            """,
            Long.class,
            live[1]);
    login("l1a");
    read("/api/v1/rules")
        .andExpect(jsonPath("$.content.length()").value(1))
        .andExpect(jsonPath("$.content[0].status").value("ACTIVE"))
        .andExpect(jsonPath("$.content[0].versionNo").value(1))
        .andExpect(jsonPath("$.content[0].operatingStatus").value("ACTIVE"))
        .andExpect(
            jsonPath("$.content[0].operatingSummary").value("첫 거래 상대 · 환전 직후 · 송금 계좌 3개 이상 · 7일"))
        .andExpect(jsonPath("$.content[0].workingStatus").value("DRAFT"))
        .andExpect(jsonPath("$.content[0].workingVersionNo").value(2))
        .andExpect(jsonPath("$.counts.ACTIVE").value(1));
    send(
            put(version(live)),
            body("name", "운영 중 룰", "definition", catalog.defaults("FAN_IN"), "revision", 0))
        .andExpect(status().isConflict()); // 운영 중인 조건은 직접 고치지 못한다
    remove(version(live)).andExpect(status().isConflict());
    // 운영 중인 룰과 템플릿·기간이 같은 새 룰은 겹친다고 알려 준다.
    var checked =
        json(
            send(
                post("/api/v1/rules/validate"),
                body("template", "FAN_IN", "definition", catalog.defaults("FAN_IN"))));
    assertThat(rows(checked.get("warnings")).toString())
        .contains("운영 중인 " + RuleService.code(live[0]) + " 와 템플릿 · 기간이 같습니다.");

    remove("/api/v1/rules/" + live[0] + "/versions/" + draft).andExpect(status().isNoContent());
    read("/api/v1/rules/" + live[0])
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("ACTIVE"))
        .andExpect(jsonPath("$.working").doesNotExist())
        .andExpect(jsonPath("$.operating.versionNo").value(1))
        .andExpect(jsonPath("$.versions.length()").value(1))
        .andExpect(jsonPath("$.events[0].action").value("DRAFT_DELETED"))
        .andExpect(jsonPath("$.events[0].versionNo").value(2));
  }
}
