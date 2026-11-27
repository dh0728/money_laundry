package com.moneylaundry.api.rules;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.NotificationService;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 룰 알림. 알림은 따로 쌓지 않고 룰 변경 기록 · 백테스트 기록에서 읽는다(V3). 받는 사람은 그 일이 일어난 때에 정해 적어 둔다: 승인 요청 · 철회는 관리자 전원,
 * 승인 · 반려 · 중지 · 재개 · 시험 운영 시작은 룰 담당자와 그 버전 작성자, 백테스트 결과는 요청한 사람. 그 일을 한 본인은 받지 않는다. 일일 실행 실패 알림은
 * RuleOperationTests 가 본다.
 */
@SpringBootTest(properties = {"spring.profiles.active=local"})
@Import(TestcontainersConfiguration.class)
class RuleNotificationTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired RuleService rules;
  @Autowired NotificationService notifications;
  @MockitoBean AnalysisScheduler scheduler;
  long l1a, l1b, admin, admin2;

  @BeforeEach
  void setup() {
    jdbc.execute(
        "truncate rules.rules,review.alerts,analysis.jobs,review.episodes,core.owners,ingest.uploads cascade");
    jdbc.update("delete from review.notification_reads");
    jdbc.update("update ops.business_clock set business_at='2023-09-17T00:00:00Z',revision=0");
    // 관리자가 둘일 때를 보려고 한 사람을 관리자로 올린다. 끝나면 되돌린다.
    jdbc.update("update core.users set role='ADMIN' where username='l2a'");
    l1a = user("l1a");
    l1b = user("l1b");
    admin = user("admin");
    admin2 = user("l2a");
  }

  @AfterEach
  void restore() {
    jdbc.update("update core.users set role='STAFF' where username in ('l1b','l2a')");
  }

  long user(String username) {
    return jdbc.queryForObject(
        "select user_id from core.users where username=?", Long.class, username);
  }

  /** 템플릿 기본값 FAN-OUT 룰. {ruleId, versionId} */
  long[] rule(long author, String name) {
    var created = rules.create(author, new RuleService.CreateInput(name, "FAN_OUT", null));
    return new long[] {number(created.get("ruleId")), number(created.get("versionId"))};
  }

  /** 그 버전의 지금 조건으로 돌린 백테스트 한 줄을 표에 직접 넣는다. */
  long backtest(long version, long requestedBy, String status) {
    return jdbc.queryForObject(
        """
        insert into rules.backtests(version_id,definition_digest,date_from,date_to,status,requested_by,requested_at,finished_at)
        select version_id,definition_digest,'2023-09-08','2023-09-10',?,?,'2023-09-17T00:00:00Z',
          case when ? in ('COMPLETED','FAILED','CANCELLED') then timestamptz '2023-09-17T00:05:00Z' end
        from rules.rule_versions where version_id=? returning backtest_id
        """,
        Long.class,
        status,
        requestedBy,
        status,
        version);
  }

  void command(long rule, long version, long user, String action, String comment) {
    long revision =
        jdbc.queryForObject(
            "select revision from rules.rule_versions where version_id=?", Long.class, version);
    boolean isAdmin =
        jdbc.queryForObject(
            "select role='ADMIN' from core.users where user_id=?", Boolean.class, user);
    rules.command(
        rule,
        user,
        isAdmin,
        new RuleService.CommandInput(null, action, version, revision, comment));
  }

  List<Map<String, Object>> list(long user) {
    return rows(notifications.list(user, null, null, null, 0, 100).get("content"));
  }

  /** 그 사람의 알림을 "종류 | 제목 | 내용" 으로. 백테스트 알림은 뺀다(따로 본다). */
  List<String> lines(long user) {
    var out = new ArrayList<String>();
    for (var row : list(user))
      if (!row.get("kind").toString().startsWith("RULE_BACKTEST"))
        out.add(row.get("kind") + " | " + row.get("title") + " | " + row.get("description"));
    return out;
  }

  @Test
  void approval_request_reaches_every_admin_and_the_answer_reaches_the_author() {
    long[] made = rule(l1a, "분산 송금 감시");
    long rule = made[0], v1 = made[1];
    backtest(v1, l1a, "COMPLETED");

    command(rule, v1, l1a, "SUBMIT", "조건 확인 부탁드립니다");
    String asked = "RULE_SUBMITTED | 룰 승인 요청 | 분산 송금 감시 v1 · L1 심사자 A · 조건 확인 부탁드립니다";
    assertThat(lines(admin)).containsExactly(asked);
    assertThat(lines(admin2)).containsExactly(asked);
    // 요청한 본인과 상관없는 직원은 받지 않는다
    assertThat(lines(l1a)).isEmpty();
    assertThat(lines(l1b)).isEmpty();
    var row = list(admin).get(0);
    assertThat(row.get("code")).isEqualTo("RULE-%03d".formatted(rule));
    assertThat(row.get("caseKind")).isEqualTo("RULE");
    assertThat(row.get("caseId")).isNull();
    assertThat(row.get("count")).isEqualTo(1L);
    assertThat(row.get("read")).isEqualTo(false);
    // 업무 시각(KST)이다. 업무 시계는 맞춘 뒤로 흐르므로 초까지는 보지 않는다.
    assertThat(row.get("at").toString()).startsWith("2023-09-17T09:0").endsWith("+09:00");

    // 받는 사람은 요청한 때의 관리자다. 뒤에 관리자가 된 사람은 받지 않고, 관리자가 아니게 된 사람의 알림은 남는다.
    jdbc.update("update core.users set role='ADMIN' where username='l1b'");
    jdbc.update("update core.users set role='STAFF' where username='l2a'");
    assertThat(lines(l1b)).isEmpty();
    assertThat(lines(admin2)).containsExactly(asked);
    jdbc.update("update core.users set role='STAFF' where username='l1b'");
    jdbc.update("update core.users set role='ADMIN' where username='l2a'");

    // 반려: 사유와 함께 작성자에게. 반려한 관리자도 다른 관리자도 받지 않는다.
    command(rule, v1, admin, "REJECT", "기준이 낮습니다");
    assertThat(lines(l1a)).containsExactly("RULE_REJECTED | 룰 반려 | 분산 송금 감시 v1 · 관리자 · 기준이 낮습니다");
    assertThat(lines(admin)).containsExactly(asked);
    assertThat(lines(admin2)).containsExactly(asked);

    // 다시 요청했다가 거둔다: 요청을 받았던 관리자들이 거둔 것도 안다
    command(rule, v1, l1a, "SUBMIT", "");
    command(rule, v1, l1a, "WITHDRAW", "");
    assertThat(lines(admin2))
        .containsExactlyInAnyOrder(
            asked,
            "RULE_SUBMITTED | 룰 승인 요청 | 분산 송금 감시 v1 · L1 심사자 A",
            "RULE_WITHDRAWN | 룰 승인 요청 철회 | 분산 송금 감시 v1 · L1 심사자 A");

    // 승인 → 중지 → 재개: 모두 작성자에게
    command(rule, v1, l1a, "SUBMIT", "");
    command(rule, v1, admin2, "APPROVE", "확인했습니다");
    command(rule, v1, admin, "PAUSE", "점검");
    command(rule, v1, admin, "RESUME", "점검 끝");
    assertThat(lines(l1a))
        .containsExactlyInAnyOrder(
            "RULE_REJECTED | 룰 반려 | 분산 송금 감시 v1 · 관리자 · 기준이 낮습니다",
            "RULE_APPROVED | 룰 승인 | 분산 송금 감시 v1 · L2 조사관 A · 확인했습니다",
            "RULE_PAUSED | 룰 중지 | 분산 송금 감시 v1 · 관리자 · 점검",
            "RULE_RESUMED | 룰 재개 | 분산 송금 감시 v1 · 관리자 · 점검 끝");
    // 관리자에게는 승인 요청 · 철회만 간다(요청 3번, 철회 1번)
    assertThat(lines(admin))
        .hasSize(4)
        .allMatch(line -> line.matches("RULE_(SUBMITTED|WITHDRAWN) .*"));
    assertThat(lines(l1b)).isEmpty();
  }

  @Test
  void owner_and_author_both_hear_when_they_differ_and_nobody_hears_of_their_own_action() {
    long[] made = rule(l1a, "분산 송금 감시");
    long rule = made[0], v1 = made[1];
    backtest(v1, l1a, "COMPLETED");
    command(rule, v1, l1a, "SUBMIT", "");
    command(rule, v1, admin, "APPROVE", "확인");

    // 담당자는 l1a 그대로이고 새 버전은 l1b 가 쓴다
    long v2 = number(rules.newVersion(rule, l1b).get("versionId"));
    backtest(v2, l1b, "COMPLETED");
    command(rule, v2, l1b, "START_SHADOW", "");
    assertThat(lines(l1a))
        .containsExactlyInAnyOrder(
            "RULE_APPROVED | 룰 승인 | 분산 송금 감시 v1 · 관리자 · 확인",
            "RULE_SHADOW_STARTED | 룰 시험 운영 시작 | 분산 송금 감시 v2 · L1 심사자 B");
    assertThat(lines(l1b)).isEmpty();

    command(rule, v2, l1b, "SUBMIT", "");
    command(rule, v2, admin, "APPROVE", "교체");
    String replaced = "RULE_APPROVED | 룰 승인 | 분산 송금 감시 v2 · 관리자 · 교체";
    assertThat(lines(l1a)).contains(replaced);
    assertThat(lines(l1b)).containsExactly(replaced);

    // 시험 운영만 하다 거둔 것은 승인 요청을 거둔 것이 아니다. 관리자에게 가지 않는다.
    long[] trial = rule(l1a, "시험만 한 룰");
    backtest(trial[1], l1a, "COMPLETED");
    int requests = lines(admin2).size();
    command(trial[0], trial[1], l1a, "START_SHADOW", "");
    command(trial[0], trial[1], l1a, "WITHDRAW", "");
    assertThat(lines(admin2)).hasSize(requests);
    assertThat(lines(l1a)).noneMatch(line -> line.contains("시험만 한 룰"));
    // 관리자가 남의 룰을 시험 운영에 올리면 작성자가 안다
    command(trial[0], trial[1], admin, "START_SHADOW", "");
    assertThat(lines(l1a)).contains("RULE_SHADOW_STARTED | 룰 시험 운영 시작 | 시험만 한 룰 v1 · 관리자");

    // 관리자가 직접 쓰고 직접 승인하면 본인에게는 아무것도 가지 않는다. 다른 관리자는 요청을 받는다.
    long[] own = rule(admin, "관리자 룰");
    backtest(own[1], admin, "COMPLETED");
    int before = lines(admin).size();
    command(own[0], own[1], admin, "SUBMIT", "");
    command(own[0], own[1], admin, "APPROVE", "본인 승인");
    assertThat(lines(admin)).hasSize(before);
    assertThat(lines(admin2)).contains("RULE_SUBMITTED | 룰 승인 요청 | 관리자 룰 v1 · 관리자");
    assertThat(lines(admin2)).noneMatch(line -> line.startsWith("RULE_APPROVED"));
  }

  @Test
  void backtest_result_goes_to_whoever_asked_whether_it_finished_or_failed() {
    long[] made = rule(l1a, "분산 송금 감시");
    long v1 = made[1];
    // l1b 가 l1a 의 룰을 백테스트했다. 끝난 것과 실패한 것만 알림이 된다.
    long done = backtest(v1, l1b, "COMPLETED");
    long failed = backtest(v1, l1b, "FAILED");
    backtest(v1, l1b, "QUEUED");
    backtest(v1, l1b, "RUNNING");
    backtest(v1, l1b, "CANCELLED");
    var mine = list(l1b);
    assertThat(mine)
        .extracting(
            row ->
                row.get("id")
                    + " | "
                    + row.get("kind")
                    + " | "
                    + row.get("title")
                    + " | "
                    + row.get("description"))
        .containsExactlyInAnyOrder(
            "rule-backtest:" + done + " | RULE_BACKTEST_DONE | 백테스트 완료 | 분산 송금 감시 v1",
            "rule-backtest:" + failed + " | RULE_BACKTEST_FAILED | 백테스트 실패 | 분산 송금 감시 v1");
    assertThat(mine.get(0).get("at")).isEqualTo("2023-09-17T09:05:00+09:00");
    assertThat(list(l1a)).isEmpty();
    assertThat(list(admin)).isEmpty();
  }

  @Test
  void rule_notifications_sit_in_the_same_list_as_case_notifications_and_are_read_per_person() {
    long[] made = rule(l1a, "분산 송금 감시");
    long rule = made[0], v1 = made[1];
    backtest(v1, l1a, "COMPLETED");
    command(rule, v1, l1a, "SUBMIT", "");

    // 사건 알림 하나: admin 에게 배정된 Alert
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,current_stage,analysis_cutoff_at,business_at) values('COMPLETED','2023-09-16',.7,'COMPLETE',now(),now()) returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status,input_seq) values(?,?,1,'COMPLETED',1)",
        run,
        job);
    long alert =
        jdbc.queryForObject(
            "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,'2023-09-16T00:00:00Z','2023-09-16T00:00:00Z') returning alert_id",
            Long.class,
            admin);
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) values(?,1,?,repeat('a',64),'{}',now())",
        alert,
        run);

    var page = notifications.list(admin, null, null, null, 0, 100);
    assertThat(rows(page.get("content")))
        .extracting(row -> row.get("kind"))
        .containsExactly("RULE_SUBMITTED", "ALERT_ASSIGNED");
    assertThat(page.get("unreadCount")).isEqualTo(2L);
    // 룰 번호로 찾을 수 있다
    String code = "RULE-%03d".formatted(rule);
    assertThat(rows(notifications.list(admin, null, null, code, 0, 100).get("content")))
        .extracting(row -> row.get("kind"))
        .containsExactly("RULE_SUBMITTED");

    // 읽음은 사람마다 따로다
    String id = rows(page.get("content")).get(0).get("id").toString();
    notifications.read(admin, new NotificationService.ReadInput(List.of(id), true));
    assertThat(list(admin).get(0).get("read")).isEqualTo(true);
    assertThat(notifications.list(admin, null, null, null, 0, 100).get("unreadCount"))
        .isEqualTo(1L);
    assertThat(list(admin2).get(0).get("read")).isEqualTo(false);
    // 받지 않은 사람은 그 알림을 읽음 처리할 수 없다
    assertThatThrownBy(
            () -> notifications.read(l1b, new NotificationService.ReadInput(List.of(id), true)))
        .isInstanceOf(ApiException.class);
    // 룰 알림에 이어진 사건은 없다
    assertThat(rows(notifications.cases(admin, id, 0, 20).get("content"))).isEmpty();
  }
}
