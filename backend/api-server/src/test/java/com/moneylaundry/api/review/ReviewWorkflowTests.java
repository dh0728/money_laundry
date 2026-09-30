package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.*;
import com.moneylaundry.api.alert.AlertQueryService;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class ReviewWorkflowTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired TransactionTemplate tx;
  @MockitoBean AnalysisScheduler scheduler;
  ReviewService service;
  BusinessTime clock;
  AlertQueryService evidence;
  long l1, l2, other;
  UUID run;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate alerts,batch_jobs,review_cases,review_requests cascade");
    jdbc.update("update demo_business_clock set business_at=null,revision=0");
    jdbc.update("update users set last_assigned_at=now(),password_hash='test-hash'");
    jdbc.update("update users set last_assigned_at=null where username='l2a'");
    l1 = jdbc.queryForObject("select user_id from users where username='l1a'", Long.class);
    other = jdbc.queryForObject("select user_id from users where username='l1b'", Long.class);
    l2 = jdbc.queryForObject("select user_id from users where username='l2a'", Long.class);
    clock =
        new BusinessTime(
            jdbc, tx, new MockEnvironment().withProperty("spring.profiles.active", "local"));
    clock.set(Instant.parse("2023-09-02T00:00:00Z"), 0);
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,threshold_value) values('ANALYSIS','COMPLETED','2023-09-02',.7) returning job_id",
            Long.class);
    run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,input_revision,status) values(?,?,1,'COMPLETED')",
        run,
        job);
    evidence = mock(AlertQueryService.class);
    service = new ReviewService(jdbc, tx, clock, evidence);
  }

  long alert(long owner) {
    long id =
        jdbc.queryForObject(
            "insert into alerts(assignee_id) values(?) returning alert_id", Long.class, owner);
    var items = new ArrayList<Map<String, Object>>();
    for (int i = 1; i <= 3; i++) {
      var t = new LinkedHashMap<String, Object>();
      t.put("txId", (long) i);
      t.put("role", i == 3 ? "CONTEXT" : "SEED");
      t.put("occurredAt", "2023-09-01T00:00:00Z");
      t.put("fromAccountId", "a");
      t.put("toAccountId", "b");
      t.put("amountPaid", 100);
      t.put("amountReceived", 100);
      t.put("paymentCurrency", "USD");
      t.put("receivingCurrency", "USD");
      t.put("paymentFormat", "ACH");
      t.put("scores", Map.of("p_laundering", .9, "p_0", .1, "p_1", .9));
      items.add(t);
    }
    when(evidence.detail(id, null))
        .thenReturn(Map.of("runId", run.toString(), "version", 1, "transactions", items));
    return jdbc.queryForObject("select case_id from review_cases where alert_id=?", Long.class, id);
  }

  ReviewService.Selection select(long id, long... txIds) {
    var d = service.detail(id);
    var g = rows(d.get("groups")).getFirst();
    return new ReviewService.Selection(
        id,
        number(d.get("revision")),
        number(g.get("groupId")),
        Arrays.stream(txIds).boxed().toList());
  }

  Map<String, Object> act(
      long user, String action, String decision, ReviewService.Selection... selections) {
    return service.command(
        user,
        new ReviewService.Command(
            UUID.randomUUID(), action, List.of(selections), null, null, null, decision, "검토 근거"));
  }

  long rawEpisode(String sql, Object... args) {
    return tx.execute(
        status -> {
          long ep = jdbc.queryForObject(sql, Long.class, args);
          for (int i = 0; i < 2; i++) {
            long sourceCase = alert(l1);
            long source = number(service.detail(sourceCase).get("alertId"));
            long group =
                jdbc.queryForObject(
                    "insert into review_groups(case_id,label) values(?,'fixture') returning group_id",
                    Long.class,
                    ep);
            jdbc.update("insert into episode_alerts values(?,?,?,1)", source, ep, group);
          }
          return ep;
        });
  }

  @Test
  void database_rejects_empty_episode_and_duplicate_or_removed_membership() {
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into review_cases(kind,assignee_id,created_at,assigned_at) values('EPISODE',?,now(),now())",
                    l2))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    long ep =
        number(act(l1, "TRANSFER", null, select(alert(l1)), select(alert(l1))).get("targetCaseId"));
    long source =
        jdbc.queryForObject(
            "select min(alert_id) from episode_alerts where episode_case_id=?", Long.class, ep);
    assertThatThrownBy(() -> jdbc.update("delete from episode_alerts where alert_id=?", source))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into episode_alerts select * from episode_alerts where alert_id=?",
                    source))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from episode_alerts where episode_case_id=?", Integer.class, ep))
        .isEqualTo(2);
  }

  @Test
  void unlink_from_two_alerts_dissolves_and_preserves_history_and_source_decisions() {
    long a = alert(l1), b = alert(l1);
    act(l1, "DECIDE", "NORMAL", select(a, 1));
    long ep = number(act(l1, "TRANSFER", null, select(a), select(b)).get("targetCaseId"));
    var before = service.detail(ep);
    var gs = rows(before.get("groups"));
    var cmd =
        new ReviewService.Command(
            UUID.randomUUID(),
            "UNLINK",
            List.of(
                new ReviewService.Selection(
                    ep,
                    number(before.get("revision")),
                    number(gs.getFirst().get("groupId")),
                    List.of())),
            null,
            null,
            null,
            null,
            "서로 관련 없는 자금 흐름");
    var result = service.command(l2, cmd);
    assertThat(result.get("dissolved")).isEqualTo(true);
    assertThat(result.get("reopenedCaseIds")).isEqualTo(List.of(a, b));
    var after = service.detail(ep);
    assertThat(after.get("status")).isEqualTo("CLOSED");
    assertThat(after.get("outcome")).isEqualTo("DISSOLVED");
    assertThat(rows(after.get("groups"))).isEmpty();
    assertThat((Collection<?>) after.get("sourceAlertIds")).isEmpty();
    var history = rows(after.get("detachments")).getFirst();
    assertThat(history.get("comment")).isEqualTo("서로 관련 없는 자금 흐름");
    assertThat(rows(object(history.get("snapshot")).get("groups"))).hasSize(2);
    for (long source : List.of(a, b)) {
      var detail = service.detail(source);
      assertThat(detail.get("status")).isEqualTo("OPEN");
      assertThat(detail.get("outcome")).isNull();
      assertThat(detail.get("episodeId")).isNull();
      assertThat(number(detail.get("assigneeId"))).isEqualTo(l1);
      assertThat(detail.get("closedAt")).isNull();
    }
    assertThat(
            rows(rows(service.detail(a).get("groups")).getFirst().get("members"))
                .getFirst()
                .get("decision"))
        .isEqualTo("NORMAL");
    service.command(l2, cmd);
    assertThat(rows(service.detail(ep).get("detachments"))).hasSize(1);
    assertThatThrownBy(
            () ->
                act(
                    l2,
                    "COMMENT",
                    null,
                    new ReviewService.Selection(ep, number(after.get("revision")), 0, List.of())))
        .isInstanceOf(ApiException.class);
    // Reopened Alerts can join another Episode; the dissolved case retains its history.
    long next = number(act(l1, "TRANSFER", null, select(a), select(b)).get("targetCaseId"));
    assertThat(next).isNotEqualTo(ep);
    assertThat(service.detail(a).get("episodeId")).isEqualTo(next);
    assertThat(rows(service.detail(ep).get("detachments"))).hasSize(1);
  }

  @Test
  void unlink_from_three_keeps_two_and_does_not_leak_removed_membership() {
    long a = alert(l1), b = alert(l1), c = alert(l1);
    long ep =
        number(act(l1, "TRANSFER", null, select(a), select(b), select(c)).get("targetCaseId"));
    var before = service.detail(ep);
    var group = rows(before.get("groups")).getFirst();
    var result =
        act(
            l2,
            "UNLINK",
            null,
            new ReviewService.Selection(
                ep, number(before.get("revision")), number(group.get("groupId")), List.of()));
    assertThat(result.get("dissolved")).isEqualTo(false);
    assertThat(service.detail(ep).get("status")).isEqualTo("OPEN");
    assertThat(rows(service.detail(ep).get("groups"))).hasSize(2);
    assertThat(service.detail(a).get("episodeId")).isNull();
    assertThat(service.detail(b).get("episodeId")).isEqualTo(ep);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from episode_alerts where episode_case_id=?", Integer.class, ep))
        .isEqualTo(2);
  }

  @Test
  void unlink_checks_owner_revision_reason_and_whole_group_before_writing() {
    long ep =
        number(act(l1, "TRANSFER", null, select(alert(l1)), select(alert(l1))).get("targetCaseId"));
    var selection = select(ep);
    assertThatThrownBy(() -> act(other, "UNLINK", null, selection))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                service.command(
                    l2,
                    new ReviewService.Command(
                        UUID.randomUUID(),
                        "UNLINK",
                        List.of(selection),
                        null,
                        null,
                        null,
                        null,
                        " ")))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l2, "UNLINK", null, select(ep, 1)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l2, "UNLINK", null, selection, selection))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                act(
                    l2,
                    "UNLINK",
                    null,
                    selection,
                    new ReviewService.Selection(ep, selection.revision(), -1, List.of())))
        .isInstanceOf(ApiException.class);
    act(l2, "COMMENT", null, selection);
    assertThatThrownBy(() -> act(l2, "UNLINK", null, selection)).isInstanceOf(ApiException.class);
    assertThat(rows(service.detail(ep).get("groups"))).hasSize(2);
    assertThat(rows(service.detail(ep).get("detachments"))).isEmpty();
  }

  @Test
  void unlink_rolls_back_all_restorations_when_a_source_is_inconsistent() {
    long a = alert(l1), b = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(a), select(b)).get("targetCaseId"));
    jdbc.update("update review_cases set outcome='NORMAL' where case_id=?", b);
    assertThatThrownBy(() -> act(l2, "UNLINK", null, select(ep))).isInstanceOf(ApiException.class);
    assertThat(service.detail(a).get("status")).isEqualTo("CLOSED");
    assertThat(rows(service.detail(ep).get("groups"))).hasSize(2);
    assertThat(rows(service.detail(ep).get("detachments"))).isEmpty();
  }

  @Test
  void exclude_decided_and_context_transactions_keeps_evidence_and_audit() {
    long a = alert(l1);
    act(l1, "DECIDE", "NORMAL", select(a, 1));
    act(l1, "EXCLUDE", null, select(a, 1, 3));
    var detail = service.detail(a);
    assertThat(object(detail.get("summary")).get("txCount")).isEqualTo(1);
    var members = rows(rows(detail.get("groups")).getFirst().get("members"));
    assertThat(members.getFirst().get("state")).isEqualTo("EXCLUDED");
    assertThat(members.get(2).get("state")).isEqualTo("EXCLUDED");
    assertThat(
            jdbc.queryForObject(
                "select snapshot->0->'members'->0->>'decision' from review_events where case_id=? and action='BEFORE_EXCLUDE'",
                String.class,
                a))
        .isEqualTo("NORMAL");
    assertThat(rows(evidence.detail(number(detail.get("alertId")), null).get("transactions")))
        .hasSize(3);
  }

  @Test
  void dissolved_episode_must_be_closed_and_empty() {
    long a = alert(l1);
    assertThatThrownBy(
            () -> jdbc.update("update review_cases set outcome='DISSOLVED' where case_id=?", a))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    long ep = number(act(l1, "TRANSFER", null, select(a), select(alert(l1))).get("targetCaseId"));
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "update review_cases set status='CLOSED',outcome='DISSOLVED',closed_at=now() where case_id=?",
                    ep))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThat(service.detail(ep).get("status")).isEqualTo("OPEN");
  }

  @Test
  void concurrent_unlinks_only_one_revision_wins() throws Exception {
    long ep =
        number(
            act(l1, "TRANSFER", null, select(alert(l1)), select(alert(l1)), select(alert(l1)))
                .get("targetCaseId"));
    var detail = service.detail(ep);
    var groups = rows(detail.get("groups"));
    var start = new java.util.concurrent.CountDownLatch(1);
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var results = new ArrayList<java.util.concurrent.Future<Boolean>>();
      for (int index = 0; index < 2; index++) {
        var selection =
            new ReviewService.Selection(
                ep,
                number(detail.get("revision")),
                number(groups.get(index).get("groupId")),
                List.of());
        results.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    act(l2, "UNLINK", null, selection);
                    return true;
                  } catch (ApiException conflict) {
                    return false;
                  }
                }));
      }
      start.countDown();
      assertThat(List.of(results.get(0).get(), results.get(1).get()))
          .containsExactlyInAnyOrder(true, false);
    }
    assertThat(rows(service.detail(ep).get("groups"))).hasSize(2);
    assertThat(rows(service.detail(ep).get("detachments"))).hasSize(1);
  }

  @Test
  void standalone_alert_can_close_suspicious_without_creating_episode() {
    long id = alert(l1);
    act(l1, "DECIDE", "SUSPICIOUS", select(id, 1, 2));
    act(l1, "CLOSE", null, select(id));
    assertThat(service.detail(id).get("status")).isEqualTo("CLOSED");
    assertThat(service.detail(id).get("outcome")).isEqualTo("SUSPICIOUS");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_cases where kind='EPISODE'", Integer.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select resolution from alerts where alert_id=?",
                String.class,
                service.detail(id).get("alertId")))
        .isEqualTo("SUSPICIOUS");
  }

  @Test
  void final_alert_resolution_is_atomic_and_preserves_context() {
    for (String decision : List.of("NORMAL", "SUSPICIOUS")) {
      long id = alert(l1);
      var command =
          new ReviewService.Command(
              UUID.randomUUID(),
              "CLOSE",
              List.of(select(id)),
              null,
              null,
              null,
              decision,
              "최종 블록 판정");
      service.command(l1, command);
      assertThat(service.detail(id).get("outcome")).isEqualTo(decision);
      assertThat(service.detail(id).get("status")).isEqualTo("CLOSED");
      assertThat(
              rows(rows(service.detail(id).get("groups")).getFirst().get("members"))
                  .get(2)
                  .get("decision"))
          .isNull();
      service.command(l1, command);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from review_events where case_id=? and action='CLOSE'",
                  Integer.class,
                  id))
          .isEqualTo(1);
    }
  }

  @Test
  void competing_whole_alert_transfers_create_only_one_episode() throws Exception {
    long a = alert(l1), b = alert(l1), c = alert(l1);
    var first =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a), select(b)),
            null,
            null,
            null,
            null,
            "one");
    var second =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a), select(c)),
            null,
            null,
            null,
            null,
            "two");
    var start = new java.util.concurrent.CountDownLatch(1);
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var futures = new ArrayList<java.util.concurrent.Future<Boolean>>();
      for (var command : List.of(first, second))
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  try {
                    service.command(l1, command);
                    return true;
                  } catch (ApiException ex) {
                    return false;
                  }
                }));
      start.countDown();
      assertThat(List.of(futures.get(0).get(), futures.get(1).get()))
          .containsExactlyInAnyOrder(true, false);
    }
    assertThat(jdbc.queryForObject("select count(*) from episode_alerts", Integer.class))
        .isEqualTo(2);
  }

  @Test
  void published_evidence_uses_real_query_for_list_and_review() {
    long id = alert(l1);
    long alertId = number(service.detail(id).get("alertId"));
    var doc = object(encode(evidence.detail(alertId, null)));
    doc.put("policyVersion", "calendar-event-v4");
    doc.put("summary", Map.of("scoreMax", .9, "txCount", 3));
    doc.put(
        "seeds",
        List.of(
            Map.of("txId", 1, "score", .9, "threshold", .7),
            Map.of("txId", 2, "score", .9, "threshold", .7)));
    jdbc.update(
        "insert into alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,?,?::jsonb)",
        alertId,
        run,
        "a".repeat(64),
        encode(doc));
    var actual = new ReviewService(jdbc, tx, clock, new AlertQueryService(jdbc, ReviewJson.JSON));
    var page =
        actual.list("ALERT", "OPEN", l1, LocalDate.of(2023, 9, 2), LocalDate.of(2023, 9, 2), 0, 20);
    assertThat(page.get("totalElements")).isEqualTo(1L);
    assertThat(object(rows(page.get("content")).getFirst().get("summary")).get("riskScore"))
        .isEqualTo(.9);
    var d = actual.detail(id);
    actual.command(
        l1,
        new ReviewService.Command(
            UUID.randomUUID(),
            "DECIDE",
            List.of(new ReviewService.Selection(id, number(d.get("revision")), 0, List.of(1L, 2L))),
            null,
            null,
            null,
            "NORMAL",
            "공개 근거 확인"));
    assertThat(actual.detail(id).get("pendingCount")).isEqualTo(0L);
    assertThat(
            jdbc.queryForObject(
                "select evidence->'transactions'->0->>'role' from alert_versions where alert_id=?",
                String.class,
                alertId))
        .isEqualTo("SEED");
  }

  @Test
  void whole_alert_transfer_closes_sources_and_preserves_context() {
    long a = alert(l1), b = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(a), select(b)).get("targetCaseId"));
    assertThat(service.detail(a).get("outcome")).isEqualTo("TRANSFERRED");
    assertThat(service.detail(a).get("status")).isEqualTo("CLOSED");
    assertThat(service.detail(a).get("episodeId")).isEqualTo(ep);
    assertThat(service.detail(a).get("pendingCount")).isEqualTo(0L);
    assertThat(object(service.detail(a).get("summary")).get("txCount")).isEqualTo(3);
    var groups = rows(service.detail(ep).get("groups"));
    assertThat(groups).hasSize(2);
    assertThat(groups).allMatch(g -> g.get("sourceAlertId") != null);
    assertThat(rows(groups.getFirst().get("members"))).hasSize(3);
    for (var g : groups)
      act(
          l2,
          "DECIDE",
          "SUSPICIOUS",
          new ReviewService.Selection(
              ep,
              number(service.detail(ep).get("revision")),
              number(g.get("groupId")),
              List.of(1L, 2L)));
    act(l2, "CLOSE", null, select(ep));
    assertThat(service.detail(ep).get("outcome")).isEqualTo("SUSPICIOUS");
    assertThat((Collection<?>) service.detail(ep).get("sourceAlertIds")).hasSize(2);
    assertThatThrownBy(() -> act(l1, "TRANSFER", null, select(a), select(alert(l1))))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void multiple_transfer_is_atomic_and_retries_are_idempotent() {
    long a = alert(l1), b = alert(other);
    var request =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a, 1), select(b, 1)),
            null,
            null,
            null,
            null,
            "묶음 조사");
    assertThatThrownBy(() -> service.command(l1, request)).isInstanceOf(ApiException.class);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_cases where kind='EPISODE'", Integer.class))
        .isZero();
    assertThat(service.detail(a).get("revision")).isEqualTo(1L);
    var ok =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a, 1, 2, 3), select(alert(l1))),
            null,
            null,
            null,
            null,
            "묶음 조사");
    var first = service.command(l1, ok);
    var second = service.command(l1, ok);
    assertThat(number(first.get("targetCaseId"))).isEqualTo(number(second.get("targetCaseId")));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_cases where kind='EPISODE'", Integer.class))
        .isEqualTo(1);
    assertThatThrownBy(
            () ->
                service.command(
                    l1,
                    new ReviewService.Command(
                        ok.requestId(),
                        "EXCLUDE",
                        ok.selections(),
                        null,
                        null,
                        null,
                        null,
                        "다른 내용")))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void stale_revision_and_foreign_scope_rejected() {
    long id = alert(l1);
    var stale = select(id, 2);
    act(l1, "DECIDE", "NORMAL", select(id, 1));
    assertThatThrownBy(() -> act(l1, "EXCLUDE", null, stale)).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l1, "EXCLUDE", null, select(id, 999)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(other, "EXCLUDE", null, select(id, 2)))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void business_clock_persists_and_blocks_backward_or_busy_changes() {
    clock.set(Instant.parse("2023-09-03T00:00:00Z"), 1);
    assertThat(clock.now()).isEqualTo(Instant.parse("2023-09-03T00:00:00Z"));
    assertThatThrownBy(() -> clock.set(Instant.parse("2023-09-02T00:00:00Z"), 2))
        .isInstanceOf(ApiException.class);
    jdbc.update("insert into batch_jobs(job_type,status) values('INGEST','RUNNING')");
    assertThatThrownBy(() -> clock.set(Instant.parse("2023-09-04T00:00:00Z"), 2))
        .isInstanceOf(ApiException.class);
    assertThat(
            new BusinessTime(
                    jdbc,
                    tx,
                    new MockEnvironment().withProperty("spring.profiles.active", "local,prod"))
                .now())
        .isAfter(Instant.parse("2025-01-01T00:00:00Z"));
  }

  @Test
  void excluding_all_is_scope_clear_not_normal() {
    long id = alert(l1);
    act(l1, "EXCLUDE", null, select(id, 1, 2));
    act(l1, "CLOSE", null, select(id));
    assertThat(service.detail(id).get("outcome")).isEqualTo("SCOPE_CLEARED");
  }

  @Test
  void partial_transfer_and_single_alert_episode_are_rejected_without_writes() {
    long a = alert(l1), b = alert(l1);
    assertThatThrownBy(() -> act(l1, "TRANSFER", null, select(a))).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l1, "TRANSFER", null, select(a, 1), select(b)))
        .isInstanceOf(ApiException.class);
    assertThat(jdbc.queryForObject("select count(*) from episode_alerts", Integer.class)).isZero();
    assertThat(service.detail(a).get("status")).isEqualTo("OPEN");
  }

  @Test
  void existing_episode_accepts_whole_alert_and_rejects_stale_target_and_split() {
    long ep =
        number(act(l1, "TRANSFER", null, select(alert(l1)), select(alert(l1))).get("targetCaseId"));
    long a = alert(l1);
    var request =
        new ReviewService.Command(
            UUID.randomUUID(),
            "TRANSFER",
            List.of(select(a)),
            ep,
            number(service.detail(ep).get("revision")),
            null,
            null,
            "추가 블록");
    service.command(l1, request);
    assertThat((Collection<?>) service.detail(ep).get("sourceAlertIds")).hasSize(3);
    long b = alert(l1);
    assertThatThrownBy(
            () ->
                service.command(
                    l1,
                    new ReviewService.Command(
                        UUID.randomUUID(),
                        "TRANSFER",
                        List.of(select(b)),
                        ep,
                        request.targetRevision(),
                        null,
                        null,
                        "오래된 목적지")))
        .isInstanceOf(ApiException.class);
    assertThat(service.detail(b).get("status")).isEqualTo("OPEN");
    assertThatThrownBy(() -> act(l2, "SPLIT", null, select(ep, 1)))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> act(l2, "MOVE", null, select(ep, 1))).isInstanceOf(ApiException.class);
  }

  @Test
  void reconsideration_is_explicit_and_retains_prior_audit() {
    long id = alert(l1);
    long ep = number(act(l1, "TRANSFER", null, select(id), select(alert(l1))).get("targetCaseId"));
    act(l2, "DECIDE", "NORMAL", select(ep, 1, 2));
    assertThatThrownBy(() -> act(l2, "SPLIT", null, select(ep, 1)))
        .isInstanceOf(ApiException.class);
    act(l2, "RECONSIDER", null, select(ep, 1));
    assertThat(service.detail(ep).get("pendingCount")).isEqualTo(2L);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from review_events where case_id=? and action='DECIDE' and snapshot::text like '%NORMAL%'",
                Integer.class, ep))
        .isEqualTo(1);
  }

  @Test
  void ledger_filters_show_unique_incoming_and_outgoing_without_private_or_label_fields() {
    jdbc.update("insert into banks(bank_id) values(999010) on conflict do nothing");
    String token = UUID.randomUUID().toString();
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(gen_random_uuid(),?,'hidden','hidden','test') returning entity_id",
            Long.class,
            token);
    long a =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999010,gen_random_uuid(),?,?, 'hidden','test') returning account_id",
            Long.class,
            token + "a",
            entity);
    long b =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999010,gen_random_uuid(),?,?, 'hidden','test') returning account_id",
            Long.class,
            token + "b",
            entity);
    for (int i = 0; i < 2; i++)
      jdbc.update(
          "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2023-08-31 15:00Z',?,?,10,'USD',10,'USD','ACH',10,'fx_rates_usd_v1','2023-09-01')",
          i == 0 ? a : b,
          i == 0 ? b : a);
    var query = new LedgerQueryService(jdbc);
    UUID owner =
        jdbc.queryForObject(
            "select service_entity_id from private.entities where entity_id=?", UUID.class, entity);
    UUID account =
        jdbc.queryForObject(
            "select service_account_id from private.accounts where account_id=?", UUID.class, a);
    var filter =
        new LedgerQueryService.Filter(
            LocalDate.parse("2023-09-01"),
            LocalDate.parse("2023-09-01"),
            owner,
            account,
            null,
            List.of("ACH"),
            0,
            20);
    var data = query.query("transactions", filter);
    assertThat(data.get("totalElements")).isEqualTo(2L);
    for (var row : rows(data.get("content"))) {
      assertThat(row.get("amountUsd").toString()).startsWith("10");
      assertThat((Collection<?>) row.get("alertIds")).isEmpty();
      assertThat((Collection<?>) row.get("episodeIds")).isEmpty();
      assertThat(row.get("isSuspicious")).isNull();
    }
    assertThat(encode(data)).doesNotContain("hidden", "is_laundering", "name_cipher");
    var incoming =
        new LedgerQueryService.Filter(
            filter.from(),
            filter.to(),
            owner,
            account,
            null,
            List.of("ACH"),
            0,
            1,
            null,
            List.of("IN"));
    var outgoing =
        new LedgerQueryService.Filter(
            filter.from(),
            filter.to(),
            owner,
            account,
            null,
            List.of("ACH"),
            0,
            1,
            null,
            List.of("OUT"));
    assertThat(query.query("transactions", incoming).get("totalElements")).isEqualTo(1L);
    assertThat(query.query("transactions", outgoing).get("totalElements")).isEqualTo(1L);
    assertThat(
            query
                .query(
                    "transactions",
                    new LedgerQueryService.Filter(
                        filter.from(),
                        filter.to(),
                        owner,
                        account,
                        null,
                        null,
                        0,
                        1,
                        account.toString(),
                        List.of("IN", "OUT")))
                .get("totalElements"))
        .isEqualTo(2L);
    assertThat(
            query
                .query(
                    "owners",
                    new LedgerQueryService.Filter(
                        filter.from(),
                        filter.to(),
                        null,
                        null,
                        null,
                        null,
                        0,
                        1,
                        owner.toString(),
                        null))
                .get("totalElements"))
        .isEqualTo(1L);
    assertThat(
            query
                .query(
                    "transactions",
                    new LedgerQueryService.Filter(
                        filter.from(), filter.to(), owner, account, null, null, 0, 1, "%_", null))
                .get("totalElements"))
        .isEqualTo(0L);
    assertThatThrownBy(
            () ->
                query.query(
                    "transactions",
                    new LedgerQueryService.Filter(
                        null, null, null, null, null, null, 0, 20, null, List.of("IN"))))
        .isInstanceOf(ApiException.class);

    assertThat(query.query("owners", filter).get("totalElements")).isEqualTo(1L);
    assertThat(query.query("accounts", filter).get("totalElements")).isEqualTo(2L);
    assertThat(
            query
                .query(
                    "transactions",
                    new LedgerQueryService.Filter(
                        filter.from(), filter.to(), owner, account, List.of("NORMAL"), null, 0, 20))
                .get("totalElements"))
        .isEqualTo(0L);
    var d = new DashboardService(jdbc, clock).view(l1, filter.from(), filter.to());
    assertThat(object(d.get("detection")).get("received")).isEqualTo(2L);
    assertThat(object(d.get("detection")).get("analyzed")).isEqualTo(0L);
    assertThat(rows(d.get("daily")).getFirst().get("day").toString()).isEqualTo("2023-09-01");
  }

  @Test
  void money_scope_reads_nonmember_ledger_and_preserves_closed_snapshot() {
    // This test owns its isolated Testcontainers database.
    jdbc.execute("truncate bank_reporting_periods cascade");
    jdbc.update("insert into banks(bank_id) values(999011) on conflict do nothing");
    String token = UUID.randomUUID().toString();
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(gen_random_uuid(),?,'hidden','hidden','test') returning entity_id",
            Long.class,
            token);
    List<Long> internal = new ArrayList<>();
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 2; i++) {
      UUID uuid = UUID.randomUUID();
      ids.add(uuid);
      internal.add(
          jdbc.queryForObject(
              "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999011,?,?,?,'hidden','test') returning account_id",
              Long.class,
              uuid,
              token + i,
              entity));
    }
    jdbc.update(
        "insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values('2023-09-01 00:00Z',?,?,100,'USD',100,'USD','ACH',100,'fx_rates_usd_v1','2023-09-01')",
        internal.get(0),
        internal.get(1));
    long id = alert(l1);
    long aid = number(service.detail(id).get("alertId"));
    for (var t : rows(evidence.detail(aid, null).get("transactions"))) {
      t.put("fromAccountId", ids.get(0).toString());
      t.put("toAccountId", ids.get(1).toString());
    }
    assertThat(service.money(id, 180).get("available")).isEqualTo(false);
    var request =
        new ReviewService.MoneyScope(
            UUID.randomUUID(),
            number(service.detail(id).get("revision")),
            List.of(ids.get(1)),
            "수취 계좌 중심 조사");
    assertThatThrownBy(() -> service.setMoneyScope(id, other, request))
        .isInstanceOf(ApiException.class);
    var saved = service.setMoneyScope(id, l1, request);
    assertThat(service.setMoneyScope(id, l1, request)).isEqualTo(object(encode(saved)));
    assertThatThrownBy(
            () ->
                service.setMoneyScope(
                    id,
                    l1,
                    new ReviewService.MoneyScope(
                        UUID.randomUUID(), request.revision(), List.of(), "오래된 화면")))
        .isInstanceOf(ApiException.class);
    jdbc.update(
        "insert into bank_reporting_periods(bank_id,effective_from_date,effective_to_date) values(999011,'2023-09-01','2023-09-01')");
    long upload =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,bank_id,business_date) values('INGEST','COMPLETED',999011,'2023-09-01') returning job_id",
            Long.class);
    long set =
        jdbc.queryForObject(
            "insert into report_sets(bank_id,business_date) values(999011,'2023-09-01') returning set_id",
            Long.class);
    long version =
        jdbc.queryForObject(
            "insert into report_versions(set_id,upload_id,version_no,received_at,stage_status) values(?,?,1,now(),'ACTIVE') returning version_id",
            Long.class,
            set,
            upload);
    jdbc.update("update report_sets set current_version_id=? where set_id=?", version, set);
    var metrics = service.money(id, 180);
    assertThat(metrics.get("available")).isEqualTo(true);
    assertThat(metrics.get("complete")).isEqualTo(true);
    assertThat(metrics.get("ledgerCount")).isEqualTo(1);
    assertThat(
            new java.math.BigDecimal(rows(metrics.get("external")).getFirst().get("in").toString()))
        .isEqualByComparingTo("100");
    assertThat(encode(metrics)).doesNotContain("hidden", "identity_cipher");
    act(l1, "DECIDE", "NORMAL", select(id, 1, 2));
    act(l1, "CLOSE", null, select(id));
    String frozen = encode(service.money(id, 180));
    jdbc.update(
        "update transactions set amount_received=999 where from_account_id=?", internal.get(0));
    assertThat(encode(service.money(id, 60))).isEqualTo(frozen);
    assertThatThrownBy(
            () ->
                service.setMoneyScope(
                    id,
                    l1,
                    new ReviewService.MoneyScope(
                        UUID.randomUUID(),
                        number(service.detail(id).get("revision")),
                        List.of(),
                        "종결 변경")))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void episode_metrics_use_work_time_first_review_and_creation_not_transfer_events() {
    Instant now = Instant.parse("2023-09-05T00:00:00Z");
    var dashboard = new DashboardService(jdbc, clock);
    var empty =
        dashboard.episodeWork(now, LocalDate.parse("2023-09-05"), LocalDate.parse("2023-09-05"));
    assertThat(object(empty.get("completion")).get("average_seconds")).isNull();
    long old =
        rawEpisode(
            "insert into review_cases(kind,assignee_id,created_at,assigned_at) values('EPISODE',?,'2023-09-01 00:00Z','2023-09-02 00:00Z') returning case_id",
            l2);
    long today =
        rawEpisode(
            "insert into review_cases(kind,assignee_id,created_at,assigned_at) values('EPISODE',?,'2023-09-04 15:00Z','2023-09-04 15:00Z') returning case_id",
            l2);
    rawEpisode(
        "insert into review_cases(kind,assignee_id,status,created_at,assigned_at,closed_at,closed_by,outcome) values('EPISODE',?,'CLOSED','2023-09-03 00:00Z','2023-09-03 00:00Z','2023-09-04 16:00Z',?,'NORMAL') returning case_id",
        l2,
        l2);
    for (String at : List.of("2023-09-04T16:00:00Z", "2023-09-04T17:00:00Z"))
      jdbc.update(
          "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'REVIEW_START','test',?::timestamptz,'{}')",
          today,
          l2,
          at);
    jdbc.update(
        "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'TRANSFER','existing destination','2023-09-04 18:00Z','{}')",
        today,
        l1);
    // Another staff member's opening is not the assignee's first review.
    jdbc.update(
        "insert into review_events(case_id,actor_id,action,comment,business_at,snapshot) values(?,?,'REVIEW_START','other staff','2023-09-04 18:00Z','{}')",
        old,
        l1);
    var result =
        dashboard.episodeWork(now, LocalDate.parse("2023-09-05"), LocalDate.parse("2023-09-05"));
    var current = object(result.get("current"));
    assertThat(current.get("open")).isEqualTo(2L);
    assertThat(current.get("aged")).isEqualTo(1L);
    assertThat(current.get("created_today")).isEqualTo(1L);
    assertThat(current.get("closed_today")).isEqualTo(1L);
    assertThat(current.get("unreviewed")).isEqualTo(1L);
    assertThat(number(object(result.get("firstReview")).get("average_seconds"))).isEqualTo(3600L);
    assertThat(object(result.get("firstReview")).get("samples")).isEqualTo(1L);
    assertThat(number(object(result.get("completion")).get("average_seconds")))
        .isEqualTo(40 * 3600L);
    assertThat(number(rows(result.get("oldestOpen")).getFirst().get("caseId"))).isEqualTo(old);
    var otherRange =
        dashboard.episodeWork(now, LocalDate.parse("2023-08-01"), LocalDate.parse("2023-08-02"));
    assertThat(object(otherRange.get("current"))).isEqualTo(current);
    assertThat(object(otherRange.get("firstReview")).get("samples")).isEqualTo(0L);
  }

  @Test
  void http_contract_serializes_clock_cases_and_validates_missing_actor() throws Exception {
    var controller =
        new ReviewController(
            service, new LedgerQueryService(jdbc), clock, new DashboardService(jdbc, clock));
    var mvc =
        MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new ApiExceptionHandler())
            .build();
    long id = alert(l1);
    mvc.perform(get("/api/v1/demo/clock"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.businessAt").value("2023-09-02T09:00+09:00"));
    mvc.perform(get("/api/v1/review/cases/" + id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.groups[0].members.length()").value(3));
    var cmd =
        new ReviewService.Command(
            UUID.randomUUID(), "DECIDE", List.of(select(id, 1)), null, null, null, "NORMAL", "확인");
    mvc.perform(
            post("/api/v1/review/commands").contentType("application/json").content(encode(cmd)))
        .andExpect(status().isUnauthorized());
    mvc.perform(
            post("/api/v1/review/commands")
                .principal(() -> "l1a")
                .contentType("application/json")
                .content(encode(cmd)))
        .andExpect(status().isOk());
    mvc.perform(get("/api/v1/ledger/transactions").param("judgement", "BOGUS"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            get("/api/v1/dashboard")
                .principal(() -> "l1a")
                .param("from", "2023-09-01")
                .param("to", "2023-09-02"))
        .andExpect(status().isOk());
  }

  @Test
  void simultaneous_writes_only_one_revision_wins() throws Exception {
    long id = alert(l1);
    var selection = select(id, 1);
    var start = new java.util.concurrent.CountDownLatch(1);
    try (var pool = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      java.util.concurrent.Callable<Boolean> work =
          () -> {
            start.await();
            try {
              act(l1, "EXCLUDE", null, selection);
              return true;
            } catch (ApiException conflict) {
              return false;
            }
          };
      var a = pool.submit(work);
      var b = pool.submit(work);
      start.countDown();
      assertThat(List.of(a.get(), b.get())).containsExactlyInAnyOrder(true, false);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from review_events where case_id=? and action='EXCLUDE'",
                  Integer.class,
                  id))
          .isEqualTo(1);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from review_events where case_id=? and action='BEFORE_EXCLUDE'",
                  Integer.class,
                  id))
          .isEqualTo(1);
    }
  }

  @Test
  void later_evidence_invalidates_stale_selection_and_adds_new_pending_range() {
    long id = alert(l1);
    var stale = select(id, 1);
    long alertId = number(service.detail(id).get("alertId"));
    var old = object(encode(evidence.detail(alertId, null)));
    old.put("version", 2);
    var added = object(encode(rows(old.get("transactions")).getFirst()));
    added.put("txId", 4);
    rows(old.get("transactions")).add(added);
    when(evidence.detail(alertId, null)).thenReturn(old);
    assertThatThrownBy(() -> act(l1, "DECIDE", "NORMAL", stale)).isInstanceOf(ApiException.class);
    assertThat(service.detail(id).get("pendingCount")).isEqualTo(3L);
  }

  long publishedAlert(long... txIds) {
    long id =
        jdbc.queryForObject(
            "insert into alerts(assignee_id) values(?) returning alert_id", Long.class, l1);
    var members = Arrays.stream(txIds).mapToObj(n -> Map.of("txId", n)).toList();
    jdbc.update(
        "insert into alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,?,?::jsonb)",
        id,
        run,
        "f".repeat(64),
        encode(Map.of("seeds", List.of(), "transactions", members)));
    return id;
  }

  void savedMembers(long caseId, Map<String, Object>... members) {
    jdbc.update(
        "insert into review_groups(case_id,label,members) values(?,'test',?::jsonb)",
        caseId,
        encode(List.of(members)));
  }

  @Test
  void membership_matches_current_scope_and_preserves_closed_cases() {
    long a = publishedAlert(1, 2, 3, 4);
    long c =
        jdbc.queryForObject("select case_id from review_cases where alert_id=?", Long.class, a);
    savedMembers(
        c,
        Map.of("txId", 1, "state", "EXCLUDED"),
        Map.of("txId", 2, "state", "TRANSFERRED"),
        Map.of("txId", 3, "state", "DECIDED"));
    long otherAlert = publishedAlert(1);
    long ep =
        rawEpisode(
            "insert into review_cases(kind,assignee_id,created_at,assigned_at,status,closed_at) values('EPISODE',?,now(),now(),'CLOSED',now()) returning case_id",
            l2);
    savedMembers(ep, Map.of("txId", 2, "state", "DECIDED"), Map.of("txId", 1, "state", "EXCLUDED"));
    savedMembers(ep, Map.of("txId", 2, "state", "DECIDED"));
    var transactions = new ArrayList<Map<String, Object>>();
    for (long id = 1; id <= 5; id++) transactions.add(new LinkedHashMap<>(Map.of("txId", id)));
    new CurrentCaseMembership(jdbc).attach(transactions);
    assertThat((Collection<?>) transactions.get(0).get("alertIds"))
        .isEqualTo(new TreeSet<>(List.of(otherAlert)));
    assertThat((Collection<?>) transactions.get(1).get("alertIds")).isEmpty();
    assertThat((Collection<?>) transactions.get(1).get("episodeIds"))
        .isEqualTo(new TreeSet<>(List.of(ep)));
    assertThat((Collection<?>) transactions.get(2).get("alertIds"))
        .isEqualTo(new TreeSet<>(List.of(a)));
    assertThat((Collection<?>) transactions.get(3).get("alertIds"))
        .isEqualTo(new TreeSet<>(List.of(a)));
    assertThat((Collection<?>) transactions.get(4).get("episodeIds")).isEmpty();
    jdbc.update("update review_cases set status='CLOSED',closed_at=now() where case_id=?", c);
    new CurrentCaseMembership(jdbc).attach(transactions);
    assertThat((Collection<?>) transactions.get(2).get("alertIds"))
        .isEqualTo(new TreeSet<>(List.of(a)));
    assertThat((Collection<?>) transactions.get(3).get("alertIds")).isEmpty();
    // An unpublished later version must not replace the visible completed evidence.
    jdbc.update("update analysis_runs set status='ACTIVE' where run_id=?", run);
    new CurrentCaseMembership(jdbc).attach(transactions);
    assertThat((Collection<?>) transactions.get(0).get("alertIds")).isEmpty();
    assertThat((Collection<?>) transactions.get(1).get("episodeIds"))
        .isEqualTo(new TreeSet<>(List.of(ep)));
  }

  @Test
  void aged_alert_count_excludes_episodes_closed_and_just_under_72_hours() {
    long a = publishedAlert(1), b = publishedAlert(2), c = publishedAlert(3);
    jdbc.update(
        "update review_cases set assigned_at=? where alert_id=?",
        java.sql.Timestamp.from(clock.now().minus(Duration.ofHours(72))),
        a);
    jdbc.update(
        "update review_cases set assigned_at=? where alert_id=?",
        java.sql.Timestamp.from(clock.now().minus(Duration.ofHours(72)).plusSeconds(1)),
        b);
    jdbc.update(
        "update review_cases set assigned_at=?,status='CLOSED',closed_at=? where alert_id=?",
        java.sql.Timestamp.from(clock.now().minus(Duration.ofDays(4))),
        java.sql.Timestamp.from(clock.now()),
        c);
    rawEpisode(
        "insert into review_cases(kind,assignee_id,created_at,assigned_at) values('EPISODE',?,?,?) returning case_id",
        l2,
        java.sql.Timestamp.from(clock.now().minus(Duration.ofDays(4))),
        java.sql.Timestamp.from(clock.now().minus(Duration.ofDays(4))));
    var dashboard = new DashboardService(jdbc, clock);
    var d = dashboard.view(l1, LocalDate.parse("2020-01-01"), LocalDate.parse("2020-01-02"));
    assertThat(d.get("openAlertsAgedOver3Days")).isEqualTo(1L);
    assertThat(object(d.get("institution")).get("aged")).isEqualTo(2L);
  }

  @Test
  void list_filters_whole_dataset_before_paging_and_matches_effective_evidence() {
    var actual = new ReviewService(jdbc, tx, clock, new AlertQueryService(jdbc, ReviewJson.JSON));
    long last = 0;
    for (int n = 0; n < 24; n++) {
      long id = alert(l1);
      long alertId = number(service.detail(id).get("alertId"));
      var doc = object(encode(evidence.detail(alertId, null)));
      doc.put("seeds", List.of(Map.of("txId", 1, "score", .9)));
      if (n == 23)
        for (var row : rows(doc.get("transactions")))
          row.put("scores", Map.of("p_laundering", .9, "p_2", .9));
      jdbc.update(
          "insert into alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,1,?,?,?::jsonb)",
          alertId,
          run,
          "a".repeat(64),
          encode(doc));
      last = id;
    }
    var filter =
        new ReviewCaseFilter(null, List.of("Fan-in"), 0, "high", List.of("OPEN"), List.of(l1));
    var page = actual.list("ALERT", null, null, null, null, 0, 1, filter);
    assertThat(page.get("totalElements")).isEqualTo(1L);
    assertThat(number(rows(page.get("content")).getFirst().get("caseId"))).isEqualTo(last);
    assertThat(actual.list("ALERT", null, null, null, null, 1, 1, filter).get("content"))
        .isEqualTo(List.of());
    var d = actual.detail(last);
    actual.command(
        l1,
        new ReviewService.Command(
            UUID.randomUUID(),
            "EXCLUDE",
            List.of(
                new ReviewService.Selection(last, number(d.get("revision")), 0, List.of(1L, 2L))),
            null,
            null,
            null,
            null,
            "씨앗 제외"));
    assertThat(actual.list("ALERT", null, null, null, null, 0, 20, filter).get("totalElements"))
        .isEqualTo(0L);
    assertThat(
            actual
                .list(
                    "ALERT",
                    null,
                    null,
                    null,
                    null,
                    0,
                    20,
                    new ReviewCaseFilter(null, List.of("패턴 미특정"), null, null, null, null))
                .get("totalElements"))
        .isEqualTo(1L);
    assertThat(
            actual
                .list(
                    "ALERT",
                    null,
                    null,
                    null,
                    null,
                    0,
                    20,
                    new ReviewCaseFilter("%_", null, null, null, null, null))
                .get("totalElements"))
        .isEqualTo(0L);
    assertThatThrownBy(
            () ->
                actual.list(
                    "ALERT",
                    null,
                    null,
                    null,
                    null,
                    0,
                    20,
                    new ReviewCaseFilter(null, List.of("garbage"), null, null, null, null)))
        .isInstanceOf(ApiException.class);
  }
}
