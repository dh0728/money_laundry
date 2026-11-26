package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.NotificationService;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleEvaluator;
import com.moneylaundry.api.rules.engine.RuleRunStep;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 룰 운영: 상태 명령(시험 운영 · 승인 요청 · 승인 · 반려 · 중지 · 재개), 분석의 ALERTS 단계 앞에서 도는 일일 실행, 사건에 걸린 룰 적중. 원장과 분석은
 * 손으로 만든 작은 것이다.
 */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class RuleOperationTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @Autowired PasswordEncoder encoder;
  @Autowired BusinessTime time;
  @Autowired RuleService rules;
  @Autowired RuleQueryService queries;
  @Autowired RuleHitQuery hitQuery;
  @Autowired RuleEvaluator evaluator;
  @Autowired RuleRunStep step;
  @Autowired NotificationService notifications;
  @MockitoBean AnalysisScheduler scheduler;
  MockHttpSession session;
  String token;
  long owner;
  int jobs;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate rules.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("update ops.business_clock set business_at='2023-09-17T00:00:00Z',revision=0");
    jdbc.update(
        "update core.users set password_hash=? where username in ('l1a','admin')",
        encoder.encode("Test-password-123"));
    jdbc.update("insert into core.banks(bank_id) values(999017) on conflict do nothing");
    owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'룰 소유자') returning owner_id",
            Long.class);
  }

  // ---- 원장 · 분석 · Alert 만들기 ----

  long user(String username) {
    return jdbc.queryForObject(
        "select user_id from core.users where username=?", Long.class, username);
  }

  long account() {
    return jdbc.queryForObject(
        "insert into core.accounts(bank_id,owner_id) values(999017,?) returning account_id",
        Long.class,
        owner);
  }

  /** from → to 로 usd 달러를 보낸 거래 한 건. at 은 "2023-09-09 10:00+09" 꼴이다. */
  long pay(long from, long to, String at, double usd) {
    return jdbc.queryForObject(
        "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) values(?::timestamptz,(?::timestamptz at time zone 'Asia/Seoul')::date,?,?,?,'USD',?,'USD','ACH',?,'test') returning tx_id",
        Long.class,
        at,
        at,
        from,
        to,
        usd,
        usd,
        usd);
  }

  /** from 이 서로 다른 새 계좌 count 개에 usd 달러씩 보낸다. 1분 간격이다. */
  List<Long> fanOut(long from, int count, String day, double usd) {
    var sent = new ArrayList<Long>();
    for (int i = 0; i < count; i++)
      sent.add(pay(from, account(), "%s 10:%02d+09".formatted(day, i), usd));
    return sent;
  }

  /** 분석 한 번. 입력 순번이 seq 이고, days 의 거래를 새로 받았다(TARGET). status 는 분석(run)의 상태다. */
  UUID analysis(long seq, String status, String... days) {
    UUID run = UUID.randomUUID();
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED',date '2099-01-01' + ?,.7,'COMPLETE',now(),now()) returning job_id",
            Long.class,
            jobs++);
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status,input_seq) values(?,?,1,?,?)",
        run,
        job,
        status,
        seq);
    jdbc.update(
        """
        insert into analysis.input_transactions(run_id,tx_id,input_role,occurred_at,business_date,from_bank_id,to_bank_id,
          from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,
          payment_currency,payment_format,amount_usd,fx_rate_version)
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,
          oa.service_owner_id,ob.service_owner_id,t.amount_received,t.receiving_currency,t.amount_paid,
          t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version
        from ledger.transactions t
        join core.accounts a on a.account_id=t.from_account_id join core.accounts b on b.account_id=t.to_account_id
        join core.owners oa on oa.owner_id=a.owner_id join core.owners ob on ob.owner_id=b.owner_id
        where t.business_date = any(?::date[])
        """,
        run,
        "{" + String.join(",", days) + "}");
    return run;
  }

  void complete(UUID run) {
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
  }

  /** 그 분석이 공개한 Alert 하나. 거래는 txIds 다. */
  long alert(UUID run, List<Long> txIds) {
    long assignee = user("l1a");
    long alert =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
            Long.class,
            assignee);
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,md5(random()::text)||md5(random()::text),'{}',now())",
        alert,
        run);
    for (long txId : txIds)
      jdbc.update(
          "insert into review.alert_transactions(alert_id,version,tx_id,role,reasons) values(?,1,?,'SEED','[]')",
          alert,
          txId);
    jdbc.update("update review.alerts set published_version=1 where alert_id=?", alert);
    return alert;
  }

  /** 템플릿 기본값 FAN-OUT(처음 거래하는 상대 AND 건당 ≥ 1,000 USD, 7일, 수취 계좌 ≥ min) 룰을 만들고 상태를 바로 정한다. */
  long version(String name, int min, String status, Long evalFromSeq) {
    var created = rules.create(user("l1a"), new RuleService.CreateInput(name, "FAN_OUT", null));
    long version = number(created.get("versionId"));
    jdbc.update(
        "update rules.rule_versions set status=?,eval_from_seq=?,definition=jsonb_set(definition,'{where,items,0,value}',?::jsonb) where version_id=?",
        status,
        evalFromSeq,
        Integer.toString(min),
        version);
    return version;
  }

  /** 그 버전의 적중을 "대상@날짜 방식 근거거래수" 로. */
  List<String> hits(long versionId) {
    var out = new ArrayList<String>();
    for (var row :
        jdbc.queryForList(
            """
            select h.subject_id||'@'||h.hit_date||' '||h.mode||' '||
              (select count(*) from rules.hit_transactions x where x.hit_id=h.hit_id) as line
            from rules.hits h where h.version_id=? order by h.hit_date,h.subject_id
            """,
            versionId)) out.add(row.get("line").toString());
    return out;
  }

  // ---- HTTP ----

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

  ResultActions send(String path, Object body) throws Exception {
    return mvc.perform(
        post(path)
            .session(session)
            .header("X-CSRF-TOKEN", token)
            .contentType(MediaType.APPLICATION_JSON)
            .content(encode(body)));
  }

  static Map<String, Object> json(ResultActions result) throws Exception {
    return object(result.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  ResultActions command(long rule, String action, long version, long revision, String comment)
      throws Exception {
    return send(
        "/api/v1/rules/" + rule + "/commands",
        Map.of("action", action, "versionId", version, "revision", revision, "comment", comment));
  }

  /** 백테스트를 접수하고 끝날 때까지 기다린다. */
  void backtest(long version) throws Exception {
    long id =
        number(
            json(send("/api/v1/rule-backtests", Map.of("versionId", version))
                    .andExpect(status().isAccepted()))
                .get("backtestId"));
    for (int i = 0; i < 300; i++) {
      var view =
          json(
              mvc.perform(get("/api/v1/rule-backtests/" + id).session(session))
                  .andExpect(status().isOk()));
      if (!List.of("QUEUED", "RUNNING").contains(view.get("status"))) {
        assertThat(view.get("status")).isEqualTo("COMPLETED");
        return;
      }
      Thread.sleep(100);
    }
    throw new AssertionError("백테스트 " + id + " 가 30초 안에 끝나지 않았습니다.");
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> part(Map<String, Object> view, String key) {
    return (Map<String, Object>) view.get(key);
  }

  static Map<String, Object> commandOf(Map<String, Object> detail, String action) {
    for (var command : rows(detail.get("commands")))
      if (action.equals(command.get("action"))) return command;
    return null;
  }

  // ---- 상태 명령 ----

  @Test
  void commands_move_a_version_from_draft_to_operation_and_keep_the_reasons() throws Exception {
    mvc.perform(get("/api/v1/review/cases/1/rule-hits")).andExpect(status().isUnauthorized());
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    fanOut(account(), 6, "2023-09-09", 2000);
    login("l1a");
    var created =
        json(
            send("/api/v1/rules", Map.of("name", "분산 송금 감시", "template", "FAN_OUT"))
                .andExpect(status().isOk()));
    long rule = number(created.get("ruleId"));
    long v1 = number(created.get("versionId"));

    // 지금 조건으로 끝낸 백테스트가 있어야 시험 운영 · 승인 요청을 할 수 있다
    command(rule, "START_SHADOW", v1, 0, "").andExpect(status().isConflict());
    command(rule, "NO_SUCH", v1, 0, "").andExpect(status().isBadRequest());
    backtest(v1);
    var shadow = json(command(rule, "START_SHADOW", v1, 0, "").andExpect(status().isOk()));
    assertThat(shadow.get("status")).isEqualTo("SHADOW");
    assertThat(number(part(shadow, "working").get("revision"))).isEqualTo(1L);
    assertThat(commandOf(shadow, "SUBMIT").get("enabled")).isEqualTo(true);
    // 옛 revision 으로는 못 바꾼다
    command(rule, "SUBMIT", v1, 0, "").andExpect(status().isConflict());
    var pending = json(command(rule, "SUBMIT", v1, 1, "").andExpect(status().isOk()));
    assertThat(pending.get("status")).isEqualTo("PENDING");
    // 승인은 관리자만 하고 사유가 있어야 한다
    command(rule, "APPROVE", v1, 2, "확인").andExpect(status().isForbidden());
    assertThat(commandOf(pending, "APPROVE").get("enabled")).isEqualTo(false);

    login("admin");
    command(rule, "APPROVE", v1, 2, " ").andExpect(status().isBadRequest());
    var active = json(command(rule, "APPROVE", v1, 2, "백테스트 확인").andExpect(status().isOk()));
    assertThat(active.get("status")).isEqualTo("ACTIVE");
    assertThat(active.get("working")).isNull();
    assertThat(part(active, "operating").get("decidedBy")).isEqualTo("관리자");
    var approvedEvent = rows(active.get("events")).get(0);
    assertThat(approvedEvent.get("action")).isEqualTo("APPROVED");
    assertThat(approvedEvent.get("comment")).isEqualTo("백테스트 확인");
    assertThat(approvedEvent.get("selfApproved")).isEqualTo(false);

    // 중지하면 매일 실행에서 빠지고, 재개하면 그때부터 다시 돈다
    var paused = json(command(rule, "PAUSE", v1, 3, "오탐 확인").andExpect(status().isOk()));
    assertThat(paused.get("status")).isEqualTo("PAUSED");
    assertThat(
            jdbc.queryForObject(
                "select eval_from_seq from rules.rule_versions where version_id=?", Long.class, v1))
        .isNull();
    var resumed = json(command(rule, "RESUME", v1, 4, "확인 끝").andExpect(status().isOk()));
    assertThat(resumed.get("status")).isEqualTo("ACTIVE");
    assertThat(
            jdbc.queryForObject(
                "select eval_from_seq from rules.rule_versions where version_id=?", Long.class, v1))
        .isNotNull();

    // 운영 중인 조건은 고치지 못한다. 새 버전을 만들어 고친다. 작업 중 버전은 하나뿐이다.
    var next =
        json(send("/api/v1/rules/" + rule + "/versions", Map.of()).andExpect(status().isOk()));
    assertThat(number(next.get("versionNo"))).isEqualTo(2L);
    send("/api/v1/rules/" + rule + "/versions", Map.of()).andExpect(status().isConflict());

    mvc.perform(get("/api/v1/review/cases/999999999/rule-hits").session(session))
        .andExpect(status().isNotFound());
  }

  @Test
  void commands_check_who_asks_and_what_state_the_version_is_in() {
    long l1a = user("l1a");
    long l1b = user("l1b");
    long admin = user("admin");
    var created = rules.create(l1a, new RuleService.CreateInput("분산 송금 감시", "FAN_OUT", null));
    long rule = number(created.get("ruleId"));
    long v1 = number(created.get("versionId"));
    // 끝낸 백테스트를 표에 직접 넣는다
    jdbc.update(
        "insert into rules.backtests(version_id,definition_digest,date_from,date_to,status,requested_by,requested_at) select version_id,definition_digest,'2023-09-08','2023-09-10','COMPLETED',author_id,now() from rules.rule_versions where version_id=?",
        v1);

    assertThatThrownBy(
            () ->
                rules.command(
                    rule,
                    l1b,
                    false,
                    new RuleService.CommandInput(null, "START_SHADOW", v1, 0L, "")))
        .hasMessageContaining("작성자와 관리자만");
    assertThatThrownBy(
            () ->
                rules.command(
                    rule, admin, true, new RuleService.CommandInput(null, "APPROVE", v1, 0L, "확인")))
        .hasMessageContaining("지금 상태에서는 할 수 없는 명령");
    assertThatThrownBy(
            () ->
                rules.command(
                    rule, admin, true, new RuleService.CommandInput(null, "SUBMIT", v1, 0L, "")))
        .hasMessageContaining("작성자만");

    // 같은 requestId 가 다시 오면 한 번만 적용한다
    var start = new RuleService.CommandInput("req-1", "START_SHADOW", v1, 0L, "");
    rules.command(rule, l1a, false, start);
    rules.command(rule, l1a, false, start);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from rules.events where rule_id=? and action='SHADOW_STARTED'",
                Long.class,
                rule))
        .isEqualTo(1L);

    // 승인 대기 → 반려하면 작성 중으로 돌아가 다시 고칠 수 있다
    rules.command(rule, l1a, false, new RuleService.CommandInput(null, "SUBMIT", v1, 1L, ""));
    rules.command(
        rule, admin, true, new RuleService.CommandInput(null, "REJECT", v1, 2L, "기준이 낮습니다"));
    var detail = queries.detail(rule, l1a, false);
    assertThat(detail.get("status")).isEqualTo("DRAFT");
    assertThat(part(detail, "working").get("editable")).isEqualTo(true);
    // 시험 운영을 한 적이 있는 초안은 지우지 못한다
    assertThat(part(detail, "working").get("deletable")).isEqualTo(false);
    var rejected = rows(detail.get("events")).get(0);
    assertThat(rejected.get("action")).isEqualTo("REJECTED");
    assertThat(rejected.get("comment")).isEqualTo("기준이 낮습니다");

    // 다시 승인 요청 → 승인. 새 버전을 승인하면 기존 운영 버전은 물러난다.
    rules.command(rule, l1a, false, new RuleService.CommandInput(null, "SUBMIT", v1, 3L, ""));
    rules.command(rule, admin, true, new RuleService.CommandInput(null, "APPROVE", v1, 4L, "확인"));
    long v2 = number(rules.newVersion(rule, l1a).get("versionId"));
    jdbc.update(
        "insert into rules.backtests(version_id,definition_digest,date_from,date_to,status,requested_by,requested_at) select version_id,definition_digest,'2023-09-08','2023-09-10','COMPLETED',author_id,now() from rules.rule_versions where version_id=?",
        v2);
    rules.command(rule, l1a, false, new RuleService.CommandInput(null, "SUBMIT", v2, 0L, ""));
    rules.command(rule, admin, true, new RuleService.CommandInput(null, "APPROVE", v2, 1L, "교체"));
    assertThat(
            jdbc.queryForList(
                "select status from rules.rule_versions where rule_id=? order by version_no",
                String.class,
                rule))
        .containsExactly("RETIRED", "ACTIVE");
  }

  // ---- 일일 실행 ----

  @Test
  void daily_run_stores_hits_for_the_days_the_analysis_received_once_per_version() {
    pay(account(), account(), "2023-09-01 09:00+09", 2000); // 원장 첫날. 첫 7일은 이력으로만 쓴다
    fanOut(account(), 6, "2023-09-05", 2000);
    long six = account();
    fanOut(six, 6, "2023-09-09", 2000);
    long five = account();
    fanOut(five, 5, "2023-09-10", 2000);
    long live = version("운영 6개", 6, "ACTIVE", 10L);
    long trial = version("시험 5개", 5, "SHADOW", 10L);
    version("작성 중", 2, "DRAFT", null);
    version("중지", 2, "PAUSED", null);

    // 순번이 eval_from_seq 보다 뒤인 분석부터 돈다. 첫 7일 안의 날짜만 받은 분석에서는 돌 것이 없다.
    assertThat(step.run(analysis(10, "ACTIVE", "2023-09-09"))).isEmpty();
    assertThat(step.run(analysis(11, "ACTIVE", "2023-09-05"))).isEmpty();
    assertThat(jdbc.queryForObject("select count(*) from rules.executions", Long.class)).isZero();

    UUID run = analysis(12, "ACTIVE", "2023-09-05", "2023-09-09", "2023-09-10");
    var outcomes = step.run(run);
    assertThat(outcomes).hasSize(2);
    assertThat(outcomes.get(0).status()).isEqualTo("COMPLETED");
    // 운영 버전의 적중은 LIVE, 시험 운영 버전의 적중은 SHADOW 로 남는다
    assertThat(hits(live)).containsExactly(six + "@2023-09-09 LIVE 6");
    assertThat(hits(trial))
        .containsExactly(six + "@2023-09-09 SHADOW 6", five + "@2023-09-10 SHADOW 5");
    var execution =
        jdbc.queryForMap(
            "select mode,status,trigger_count,hit_count,skipped_subjects,busy_max,busy_window_minutes from rules.executions where run_id=? and version_id=?",
            run,
            live);
    assertThat(execution.get("mode")).isEqualTo("LIVE");
    assertThat(execution.get("status")).isEqualTo("COMPLETED");
    assertThat(execution.get("trigger_count")).isEqualTo(11); // 09-09 의 6건 + 09-10 의 5건
    assertThat(execution.get("hit_count")).isEqualTo(1);
    assertThat(execution.get("busy_max")).isEqualTo(512);

    // 단계가 다시 돌아도 끝난 버전은 다시 돌리지 않는다
    assertThat(step.run(run).get(0).status()).isEqualTo("SKIPPED");
    assertThat(jdbc.queryForObject("select count(*) from rules.executions", Long.class))
        .isEqualTo(2L);

    // 다음 날 five 가 한 건을 더 보내 여섯 개가 된다. 근거 거래에는 전날의 다섯 건이 같이 들어간다.
    pay(five, account(), "2023-09-11 10:00+09", 2000);
    step.run(analysis(13, "ACTIVE", "2023-09-11"));
    assertThat(hits(live)).containsExactly(six + "@2023-09-09 LIVE 6", five + "@2023-09-11 LIVE 6");

    // 시험 운영을 되돌려 조건을 고치면 예전 조건으로 쌓은 시험 운영 적중은 지운다. 운영 적중은 그대로다.
    assertThat(hits(trial)).hasSize(3);
    jdbc.update(
        "update rules.rule_versions set status='DRAFT',eval_from_seq=null where version_id=?",
        trial);
    long trialRule =
        jdbc.queryForObject(
            "select rule_id from rules.rule_versions where version_id=?", Long.class, trial);
    var changed = new RuleCatalog().defaults("FAN_OUT");
    changed.put("windowMinutes", 4320);
    rules.save(trialRule, trial, user("l1a"), new RuleService.SaveInput("시험 5개", changed, 0L));
    assertThat(hits(trial)).isEmpty();
    assertThat(hits(live)).hasSize(2);
  }

  @Test
  void a_failing_version_is_recorded_and_the_others_still_run() {
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    long six = account();
    fanOut(six, 6, "2023-09-09", 2000);
    long good = version("운영 6개", 6, "ACTIVE", 0L);
    long broken = version("깨진 룰", 6, "ACTIVE", 0L);
    // 이 템플릿이 평가할 수 없는 항목을 표에 직접 넣는다
    jdbc.update(
        "update rules.rule_versions set definition=jsonb_set(definition,'{where,items,0,metric}','\"MID_COUNT\"') where version_id=?",
        broken);

    UUID run = analysis(1, "ACTIVE", "2023-09-09");
    var outcomes = step.run(run);
    assertThat(outcomes).hasSize(2);
    assertThat(outcomes.get(0).status()).isEqualTo("COMPLETED");
    assertThat(outcomes.get(1).status()).isEqualTo("FAILED");
    assertThat(outcomes.get(1).errorCode()).isEqualTo("INTERNAL");
    assertThat(hits(good)).containsExactly(six + "@2023-09-09 LIVE 6");
    // 실패한 실행도 그 분석에서는 다시 돌리지 않는다
    assertThat(step.run(run).get(1).status()).isEqualTo("SKIPPED");
    complete(run);
    var list = rows(queries.list().get("content"));
    assertThat(list.get(0).get("lastRunFailed")).isEqualTo(false);
    assertThat(list.get(1).get("lastRunFailed")).isEqualTo(true);

    // 실패는 그때의 룰 담당자와 관리자 전원에게 알린다. 잘 돈 룰은 알리지 않는다.
    assertThat(failures(user("l1a"))).containsExactly("RULE_RUN_FAILED 깨진 룰 v1 · 운영");
    assertThat(failures(user("admin"))).containsExactly("RULE_RUN_FAILED 깨진 룰 v1 · 운영");
    assertThat(failures(user("l1b"))).isEmpty();

    // 룰 전체에 쓰는 시간을 넘기면 남은 버전은 BUDGET 으로 남긴다
    jdbc.update(
        "update rules.rules set owner_id=? where name='운영 6개'",
        user("admin")); // 담당자가 관리자여도 한 번만 받는다
    jdbc.update("update rules.rule_versions set status='SHADOW' where version_id=?", broken);
    var hasty = new RuleRunStep(jdbc, tx, time, evaluator, 7, Duration.ZERO);
    assertThat(hasty.run(analysis(2, "ACTIVE", "2023-09-09")).get(0).errorCode())
        .isEqualTo("BUDGET");
    assertThat(failures(user("admin")))
        .containsExactlyInAnyOrder(
            "RULE_RUN_FAILED 깨진 룰 v1 · 운영",
            "RULE_RUN_FAILED 운영 6개 v1 · 운영",
            "RULE_RUN_FAILED 깨진 룰 v1 · 시험 운영");
    assertThat(failures(user("l1a")))
        .containsExactlyInAnyOrder(
            "RULE_RUN_FAILED 깨진 룰 v1 · 운영", "RULE_RUN_FAILED 깨진 룰 v1 · 시험 운영");
  }

  /** 그 사람이 받은 알림을 "종류 내용" 으로. */
  List<String> failures(long user) {
    var out = new ArrayList<String>();
    for (var row : rows(notifications.list(user, null, null, null, 0, 100).get("content")))
      out.add(row.get("kind") + " " + row.get("description"));
    return out;
  }

  // ---- 사건의 룰 적중 ----

  @Test
  void a_case_shows_live_hits_that_share_a_transaction_with_it() {
    pay(account(), account(), "2023-09-01 09:00+09", 2000);
    long six = account();
    var sixTx = fanOut(six, 6, "2023-09-09", 2000);
    long five = account();
    var fiveTx = fanOut(five, 5, "2023-09-10", 2000);
    long live = version("운영 6개", 6, "ACTIVE", 0L);
    version("시험 5개", 5, "SHADOW", 0L);
    long rule =
        jdbc.queryForObject(
            "select rule_id from rules.rule_versions where version_id=?", Long.class, live);

    UUID run = analysis(1, "ACTIVE", "2023-09-09", "2023-09-10");
    step.run(run);
    long alert = alert(run, sixTx.subList(0, 2));
    long trialOnly = alert(run, fiveTx.subList(0, 3));
    // 분석이 끝나기 전의 적중은 보이지 않는다
    complete(run);

    var cards = hitQuery.forCase(alert);
    assertThat(cards).hasSize(1);
    var card = cards.get(0);
    assertThat(card.get("code")).isEqualTo(RuleService.code(rule));
    assertThat(card.get("name")).isEqualTo("운영 6개");
    assertThat(card.get("templateName")).isEqualTo("FAN-OUT · 분산 송금");
    assertThat(card.get("subjectLabel")).isEqualTo("송금 계좌");
    assertThat(card.get("subject").toString())
        .isEqualTo(
            jdbc.queryForObject(
                "select service_account_id from core.accounts where account_id=?",
                String.class,
                six));
    assertThat(card.get("hitDates")).isEqualTo(List.of("2023-09-09"));
    assertThat(card.get("matchedTxIds")).isEqualTo(sixTx.subList(0, 2));
    assertThat(card.get("evidenceTxCount")).isEqualTo(6);
    // 조건과 실제 값
    var condition = rows(card.get("conditions")).get(0);
    assertThat(condition.get("label")).isEqualTo("서로 다른 수취 계좌 수");
    assertThat(condition.get("cmp")).isEqualTo("GTE");
    assertThat(number(condition.get("value"))).isEqualTo(6L);
    assertThat(number(condition.get("measured"))).isEqualTo(6L);

    // 시험 운영의 적중은 Alert 에 보이지 않는다
    assertThat(hitQuery.forCase(trialOnly)).isEmpty();
    // 직원이 Alert 에서 뺀 거래는 세지 않는다
    jdbc.update(
        "insert into review.alert_tx_edits(alert_id,tx_id,target_alert_id,editor_id,reason,edited_at) values(?,?,null,?,'제외',now())",
        alert,
        sixTx.get(0),
        user("l1a"));
    assertThat(hitQuery.forCase(alert).get(0).get("matchedTxIds")).isEqualTo(sixTx.subList(1, 2));

    // 목록 숫자: 운영 적중 1건, 겹치는 Alert 1개. 사람이 정상으로 종결하면 정상 판정 100%.
    var row = rows(queries.list().get("content")).get(0);
    assertThat(number(row.get("hitCount"))).isEqualTo(1L);
    assertThat(row.get("lastHitDate")).isEqualTo("2023-09-09");
    assertThat(number(row.get("linkedAlertCount"))).isEqualTo(1L);
    assertThat(row.get("normalRate")).isNull();
    jdbc.update(
        "update review.alerts set status='CLOSED',outcome='NORMAL',closed_at=now(),closed_by=? where alert_id=?",
        user("l1a"),
        alert);
    assertThat(rows(queries.list().get("content")).get(0).get("normalRate")).isEqualTo(100.0);
    // 시험 운영 중인 룰은 시험 운영 적중 수를 따로 준다
    var trialRow = rows(queries.list().get("content")).get(1);
    assertThat(number(trialRow.get("hitCount"))).isZero();
    assertThat(number(trialRow.get("shadowHitCount"))).isEqualTo(2L);
  }

  @Test
  void clone_makes_a_separate_rule_with_the_same_condition_owned_by_whoever_cloned_it() {
    long l1a = user("l1a");
    long l1b = user("l1b");
    var created = rules.create(l1a, new RuleService.CreateInput("집중 수취 감시", "FAN_IN", null));
    long rule = number(created.get("ruleId"));
    long v1 = number(created.get("versionId"));
    // v1 은 운영 중, v2 는 수취 기간을 3일로 고친 작성 중 버전
    jdbc.update("update rules.rule_versions set status='ACTIVE' where version_id=?", v1);
    long v2 = number(rules.newVersion(rule, l1a).get("versionId"));
    var stricter = new RuleCatalog().defaults("FAN_IN");
    stricter.put("windowMinutes", 4320);
    rules.save(rule, v2, l1a, new RuleService.SaveInput("집중 수취 감시", stricter, 0L));
    long eventsBefore =
        jdbc.queryForObject("select count(*) from rules.events where rule_id=?", Long.class, rule);

    // 화면은 상세의 CLONE 명령으로 버튼을 연다. 따로 고르지 않으면 운영 버전이 복제된다.
    var command = commandOf(queries.detail(rule, l1b, false), "CLONE");
    assertThat(command.get("enabled")).isEqualTo(true);
    assertThat(number(command.get("versionId"))).isEqualTo(v1);

    // 다른 사람이 복제한다: 새 룰의 v1 초안이 생기고 복제한 사람이 담당자다
    var copy = rules.clone(rule, l1b, null);
    long copied = number(copy.get("ruleId"));
    assertThat(copied).isNotEqualTo(rule);
    assertThat(copy.get("code")).isEqualTo(RuleService.code(copied));
    assertThat(copy.get("name")).isEqualTo("집중 수취 감시 복사본");
    var detail = queries.detail(copied, l1b, false);
    assertThat(detail.get("name")).isEqualTo("집중 수취 감시 복사본");
    assertThat(detail.get("template")).isEqualTo("FAN_IN");
    assertThat(detail.get("status")).isEqualTo("DRAFT");
    assertThat(detail.get("operating")).isNull();
    var working = part(detail, "working");
    assertThat(number(working.get("versionNo"))).isEqualTo(1L);
    assertThat(working.get("editable")).isEqualTo(true);
    assertThat(working.get("backtest")).isNull();
    assertThat(number(part(working, "definition").get("windowMinutes"))).isEqualTo(10080L);
    assertThat(
            jdbc.queryForObject(
                "select (select definition_digest from rules.rule_versions where version_id=?) = (select definition_digest from rules.rule_versions where rule_id=?)",
                Boolean.class,
                v1,
                copied))
        .isTrue();
    assertThat(
            jdbc.queryForObject(
                "select u.username from rules.rules r join core.users u on u.user_id=r.owner_id where r.rule_id=?",
                String.class,
                copied))
        .isEqualTo("l1b");
    // 새 룰의 첫 기록에 어디서 복제했는지 남는다
    var events = rows(detail.get("events"));
    assertThat(events).hasSize(1);
    assertThat(events.get(0).get("action")).isEqualTo("CREATED");
    assertThat(part(events.get(0), "clonedFrom").get("code")).isEqualTo(RuleService.code(rule));
    assertThat(number(part(events.get(0), "clonedFrom").get("versionNo"))).isEqualTo(1L);
    // 원래 룰은 그대로다: 버전 둘, 기록도 늘지 않았다
    assertThat(
            jdbc.queryForList(
                "select status from rules.rule_versions where rule_id=? order by version_no",
                String.class,
                rule))
        .containsExactly("ACTIVE", "DRAFT");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from rules.events where rule_id=?", Long.class, rule))
        .isEqualTo(eventsBefore);
    assertThat(rows(queries.detail(rule, l1a, false).get("events")).get(0).get("clonedFrom"))
        .isNull();

    // 버전과 이름을 정해 복제할 수도 있다
    var named = rules.clone(rule, l1a, new RuleService.CloneInput(v2, "  3일 수취 감시  "));
    var namedDetail = queries.detail(number(named.get("ruleId")), l1a, false);
    assertThat(namedDetail.get("name")).isEqualTo("3일 수취 감시");
    assertThat(number(part(part(namedDetail, "working"), "definition").get("windowMinutes")))
        .isEqualTo(4320L);
    assertThat(number(part(rows(namedDetail.get("events")).get(0), "clonedFrom").get("versionNo")))
        .isEqualTo(2L);

    // 이름이 길면 "복사본" 이 들어가게 원래 이름의 뒤를 자른다(한도 80자)
    String longName = "가".repeat(80);
    jdbc.update("update rules.rules set name=? where rule_id=?", longName, rule);
    String copyName = rules.clone(rule, l1a, null).get("name").toString();
    assertThat(copyName).hasSize(80).endsWith(" 복사본").startsWith("가".repeat(76));

    // 없는 룰, 다른 룰의 버전, 이름 규칙 위반
    assertThatThrownBy(() -> rules.clone(999999, l1a, null)).hasMessageContaining("룰이 없습니다");
    long otherVersion =
        number(
            rules
                .create(l1a, new RuleService.CreateInput("다른 룰", "FAN_OUT", null))
                .get("versionId"));
    assertThatThrownBy(() -> rules.clone(rule, l1a, new RuleService.CloneInput(otherVersion, null)))
        .hasMessageContaining("복제할 버전이 없습니다");
    assertThatThrownBy(() -> rules.clone(rule, l1a, new RuleService.CloneInput(null, " ")))
        .hasMessageContaining("룰 이름은");
    assertThatThrownBy(
            () -> rules.clone(rule, l1a, new RuleService.CloneInput(null, "나".repeat(81))))
        .hasMessageContaining("룰 이름은");
  }
}
