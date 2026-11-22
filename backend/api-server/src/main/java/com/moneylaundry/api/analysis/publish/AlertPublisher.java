package com.moneylaundry.api.analysis.publish;

import static com.moneylaundry.api.review.ReviewJson.*;

import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.CaseSummaryStore;
import com.moneylaundry.api.review.ReviewJson;
import com.moneylaundry.api.review.StaffAssignment;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Applies prepared flow plans inside the runner's final, fenced transaction. */
public final class AlertPublisher {
  /** Business time of the run's job; takes the run id as its parameter. */
  private static final String RUN_BUSINESS_AT =
      "(select j.business_at from analysis.runs r join analysis.jobs j using(job_id) where r.run_id=?)";

  private final JdbcTemplate jdbc;

  public AlertPublisher(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  public void publish(UUID run, UUID execution, String artifact) {
    long publicationStarted = System.nanoTime();
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("ALERT_PUBLICATION_REQUIRES_TRANSACTION");
    if (!jdbc.queryForObject(
        "select exists(select 1 from analysis.jobs j join analysis.runs r on r.run_id=j.current_run_id where r.run_id=? and j.execution_id=? and j.status='RUNNING' and j.current_stage='ALERTS' and r.status in ('READY','ACTIVE'))",
        Boolean.class,
        run,
        execution)) throw new IllegalStateException("ALERT_PLAN_FENCED");
    validateFrozenInput(run);
    if (jdbc.queryForObject(
        "select exists(select 1 from analysis.run_fact_checks f join ledger.transactions t using(tx_id) where f.run_id=? and f.integration_status<>t.integration_status) or exists(select 1 from analysis.run_scores i left join analysis.current_scores c using(tx_id) where i.run_id=? and i.score_run_id is distinct from c.run_id)",
        Boolean.class,
        run,
        run))
      throw new com.moneylaundry.api.analysis.AnalysisFailure(
          "STALE_INPUT", com.moneylaundry.api.analysis.AnalysisFailure.Kind.PERMANENT);
    var manifest = object(artifact);
    if (!"PREPARED".equals(manifest.get("publication")))
      throw new IllegalStateException("ALERT_PLAN_MANIFEST_REQUIRED");
    StringBuilder digest = new StringBuilder();
    Set<Long> affected = new HashSet<>();
    int[] count = {0};
    forEachPlan(
        run,
        stored -> {
          count[0]++;
          String payload = stored.get("payload").toString();
          String checksum = hash(payload);
          if (!execution.equals(stored.get("execution_id"))
              || number(stored.get("build_generation")) != number(manifest.get("buildGeneration"))
              || !checksum.equals(stored.get("plan_digest").toString().strip()))
            throw new IllegalStateException("ALERT_PLAN_FENCED");
          digest.append(stored.get("plan_key")).append(':').append(checksum).append('\n');
          var plan = object(payload);
          if (!stored.get("action").equals(plan.get("action")))
            throw new IllegalStateException("ALERT_PLAN_ACTION_MISMATCH");
          for (long id : ids(plan.get("caseIds")))
            if (!affected.add(id)) throw new IllegalStateException("DUPLICATE_ALERT_OPERATION");
          validate(plan);
        });
    if (count[0] != number(manifest.get("planCount")))
      throw new IllegalStateException("ALERT_PLAN_COUNT_MISMATCH");
    if (!hash(digest.toString()).equals(manifest.get("planDigest")))
      throw new IllegalStateException("ALERT_PLAN_DIGEST_MISMATCH");
    Timestamp businessAt =
        jdbc.queryForObject(
            "select b.business_at from analysis.runs r join analysis.jobs b using(job_id) where r.run_id=?",
            Timestamp.class,
            run);
    int[] created = {0};
    forEachPlan(run, stored -> created[0] += apply(run, object(stored.get("payload")), businessAt));
    jdbc.update("update analysis.jobs set alert_count=? where current_run_id=?", created[0], run);
    manifest.put("publication", "PUBLISHED");
    manifest.put("createdAlertCount", created[0]);
    var timings =
        manifest.get("timingsMs") == null
            ? new LinkedHashMap<String, Object>()
            : object(manifest.get("timingsMs"));
    timings.put("publication", (System.nanoTime() - publicationStarted) / 1_000_000.0);
    manifest.put("timingsMs", timings);
    jdbc.update(
        "update analysis.stage_results set artifact=? where run_id=? and stage='ALERTS'",
        encode(manifest),
        run);
    jdbc.update("delete from analysis.alert_plans where run_id=?", run);
  }

  private void forEachPlan(UUID run, java.util.function.Consumer<Map<String, Object>> consumer) {
    // Both passes run inside the same fenced transaction. Validate every operation
    // before applying any, without retaining every evidence JSON in the JVM heap.
    var mapper = new org.springframework.jdbc.core.ColumnMapRowMapper();
    jdbc.query(
        connection -> {
          var statement =
              connection.prepareStatement(
                  "select * from analysis.alert_plans where run_id=? order by plan_key");
          statement.setObject(1, run);
          statement.setFetchSize(8);
          return statement;
        },
        (org.springframework.jdbc.core.RowCallbackHandler)
            result -> consumer.accept(mapper.mapRow(result, 0)));
  }

  private void validateFrozenInput(UUID run) {
    boolean changed =
        jdbc.queryForObject(
            """
        with cutoff as (
          select b.analysis_cutoff_at as at from analysis.runs r join analysis.jobs b using(job_id) where r.run_id=?
        ), current_manifest as (
          select d.business_date,jsonb_build_object(
            'scopeRevision',s.scope_revision,
            'banks',coalesce((select jsonb_agg(sb.bank_id order by sb.bank_id)
              from ingest.reporting_scope_banks sb where sb.business_date=d.business_date),'[]'::jsonb),
            'reports',coalesce((select jsonb_agg(jsonb_build_object(
              'setId',rs.set_id,'bankId',rs.bank_id,'versionId',rv.version_id,
              'revision',rv.revision,'generation',rs.generation,'status',rv.stage_status)
              order by rs.set_id) from ingest.report_sets rs
              join ingest.report_versions rv on rv.version_id=rs.current_version_id
              where rs.business_date=d.business_date and rv.received_at<=cutoff.at),'[]'::jsonb)) as state
          from (select business_date from ingest.reporting_scopes union select business_date from ingest.report_sets) d
          cross join cutoff left join ingest.reporting_scopes s using(business_date)
          where d.business_date <= (cutoff.at at time zone 'Asia/Seoul')::date
        )
        select exists(select 1 from current_manifest c full join
          (select business_date,state from analysis.source_manifest where run_id=?) f using(business_date)
          where c.state is distinct from f.state)
          or exists(select 1 from analysis.input_transactions i join ledger.transactions t using(tx_id)
            where i.run_id=? and t.integration_status<>'ACTIVE')
          or exists(select 1 from analysis.runs r join analysis.input_ledger l
            on l.valid_from_seq<=r.input_seq and (l.valid_to_seq is null or l.valid_to_seq>r.input_seq)
            join ledger.transactions t using(tx_id) where r.run_id=? and t.integration_status<>'ACTIVE')
        """,
            Boolean.class,
            run,
            run,
            run,
            run);
    if (changed)
      throw new com.moneylaundry.api.analysis.AnalysisFailure(
          "STALE_INPUT", com.moneylaundry.api.analysis.AnalysisFailure.Kind.PERMANENT);
  }

  private void validate(Map<String, Object> plan) {
    for (var base : rows(plan.get("baselines"))) {
      var current =
          jdbc.queryForMap(
              "select * from review.alerts where alert_id=? for update", base.get("alertId"));
      for (var mapping :
          Map.of(
                  "publishedVersion",
                  "published_version",
                  "revision",
                  "revision",
                  "assigneeId",
                  "assignee_id",
                  "status",
                  "status",
                  "mergedIntoAlertId",
                  "merged_into_alert_id")
              .entrySet()) {
        Object expected = base.get(mapping.getKey()), actual = current.get(mapping.getValue());
        boolean same =
            expected instanceof Number && actual instanceof Number
                ? number(expected) == number(actual)
                : Objects.equals(expected, actual);
        if (!same) throw new IllegalStateException("ALERT_BASELINE_CHANGED");
      }
      Object expected = base.get("reviewStartedAt"), actual = current.get("review_started_at");
      if (expected == null
          ? actual != null
          : actual == null
              || !Instant.parse(expected.toString()).equals(((Timestamp) actual).toInstant()))
        throw new IllegalStateException("ALERT_BASELINE_CHANGED");
    }
  }

  private int apply(UUID run, Map<String, Object> plan, Timestamp at) {
    String action = plan.get("action").toString();
    Long target = plan.get("targetAlertId") == null ? null : number(plan.get("targetAlertId"));
    var affected = ids(plan.get("caseIds"));
    var references = ids(plan.get("referenceIds"));
    var recipients = new TreeSet<>(ids(plan.get("recipientIds")));
    boolean create = Set.of("NEW", "FOLLOWUP").contains(action);
    if (create) {
      long user = StaffAssignment.next(jdbc);
      target =
          jdbc.queryForObject(
              "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,?,?) returning alert_id",
              Long.class,
              user,
              at,
              at);
      recipients.add(user);
    }
    if (!"NOOP".equals(action)) {
      if (target == null) throw new IllegalStateException("ALERT_TARGET_REQUIRED");
      var evidence = object(plan.get("evidence"));
      String fingerprint = plan.get("fingerprint").toString();
      int version = saveVersion(target, run, fingerprint, evidence);
      var changes = publicationChanges(target, version, evidence);
      publishVersion(target, version, evidence, plan, at);
      // 점수 재평가로 근거가 모두 사라진 경우도 근거 소멸로 닫는다.
      boolean withdrawn = "WITHDRAW".equals(action) || rows(evidence.get("seeds")).isEmpty();
      String eventAction =
          withdrawn
              ? "EVIDENCE_WITHDRAWN"
              : switch (action) {
                case "MERGE" -> "MERGED";
                case "FOLLOWUP" -> "FOLLOWUP_CREATED";
                case "NEW" -> "ALERT_CREATED";
                default -> "ADDED_EVIDENCE";
              };
      long event =
          event(
              target,
              eventAction,
              at,
              recipients,
              publicationSnapshot(changes, affected, references, plan, fingerprint));
      if ("MERGE".equals(action))
        for (long source : affected)
          if (source != target) {
            jdbc.update(
                "update review.alerts set merged_into_alert_id=?,revision=revision+1,summary_revision=revision+1 where alert_id=?",
                target,
                source);
            jdbc.update(
                "update review.alerts set merged_into_alert_id=? where merged_into_alert_id=?",
                target,
                source);
            jdbc.update(
                "insert into review.alert_lineage values(?,?,'MERGED_INTO',?)",
                source,
                target,
                event);
            mergeEdits(source, target);
          }
      if ("FOLLOWUP".equals(action))
        for (long source : references)
          jdbc.update(
              "insert into review.alert_lineage values(?,?,'FOLLOWUP_OF',?)",
              target,
              source,
              event);
    }
    recordCoverage(run, plan, target);
    return create ? 1 : 0;
  }

  private void recordCoverage(UUID run, Map<String, Object> plan, Long target) {
    var checked = new TreeSet<Long>(ids(plan.get("caseIds")));
    checked.addAll(ids(plan.get("referenceIds")));
    if (target != null) checked.add(target);
    // Checked at the run's business time, like every other record of this publication.
    for (long id : checked)
      jdbc.update(
          "insert into review.alert_coverage_checks(alert_id,run_id,coverage,checked_at) values(?,?,?::jsonb,"
              + RUN_BUSINESS_AT
              + ") on conflict(alert_id,run_id) do nothing",
          id,
          run,
          encode(plan.get("coverage")),
          run);
  }

  private Map<String, Object> publicationChanges(
      long target, int version, Map<String, Object> evidence) {
    Integer previous =
        jdbc.queryForObject(
            "select published_version from review.alerts where alert_id=?", Integer.class, target);
    var before =
        new TreeSet<>(
            jdbc.queryForList(
                "select tx_id from review.alert_transactions where alert_id=? and version=?",
                Long.class,
                target,
                previous));
    var after = new TreeSet<Long>();
    var added = new ArrayList<Map<String, Object>>();
    for (var member : rows(evidence.get("transactions"))) {
      long id = number(member.get("txId"));
      after.add(id);
      if (!before.contains(id))
        added.add(
            Map.of(
                "txId",
                id,
                "role",
                member.get("role"),
                "includedReasons",
                member.get("includedReasons")));
    }
    added.sort(Comparator.comparingLong(m -> number(m.get("txId"))));
    before.removeAll(after);
    var changes = new LinkedHashMap<String, Object>();
    changes.put("previousPublishedVersion", previous);
    changes.put("publishedVersion", version);
    changes.put("addedTransactions", added);
    changes.put("removedTxIds", before);
    return changes;
  }

  private Map<String, Object> publicationSnapshot(
      Map<String, Object> changes,
      List<Long> affected,
      List<Long> references,
      Map<String, Object> plan,
      String fingerprint) {
    changes.put("caseIds", affected);
    changes.put("referenceIds", references);
    changes.put("reason", plan.get("reason"));
    changes.put("fingerprint", fingerprint);
    return changes;
  }

  private int saveVersion(long target, UUID run, String fingerprint, Map<String, Object> evidence) {
    int version =
        jdbc.queryForObject(
            "select coalesce(max(version),0)+1 from review.alert_versions where alert_id=?",
            Integer.class,
            target);
    var members = rows(evidence.get("transactions"));
    Set<Long> seedIds = new HashSet<>(), memberIds = new HashSet<>();
    for (var seed : rows(evidence.get("seeds")))
      if (!seedIds.add(number(seed.get("txId")))) throw new IllegalStateException("DUPLICATE_SEED");
    for (var member : members) {
      long id = number(member.get("txId"));
      if (!memberIds.add(id) || seedIds.contains(id) != "SEED".equals(member.get("role")))
        throw new IllegalStateException("ALERT_ROLE_MISMATCH");
    }
    if (!memberIds.containsAll(seedIds)) throw new IllegalStateException("ALERT_SEED_MISSING");
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,created_at) values(?,?,?,?,?::jsonb,"
            + RUN_BUSINESS_AT
            + ")",
        target,
        version,
        run,
        fingerprint,
        encode(evidence),
        run);
    var values = new ArrayList<Object[]>();
    for (var member : members)
      values.add(
          new Object[] {
            target,
            version,
            member.get("txId"),
            member.get("role"),
            encode(member.get("includedReasons")),
            "SEED".equals(member.get("role"))
                ? object(member.get("scores")).get("p_laundering")
                : null
          });
    jdbc.batchUpdate("insert into review.alert_transactions values(?,?,?,?,?::jsonb,?)", values);
    return version;
  }

  /** 병합으로 사라지는 Alert에서 직원이 뺀 거래 기록을 남는 Alert로 옮긴다. */
  private void mergeEdits(long source, long target) {
    jdbc.update(
        "delete from review.alert_tx_edits where (alert_id=? and target_alert_id=?) or (alert_id=? and target_alert_id=?)",
        source,
        target,
        target,
        source);
    jdbc.update(
        "delete from review.alert_tx_edits e where e.alert_id=? and exists(select 1 from review.alert_tx_edits k where k.alert_id=? and k.tx_id=e.tx_id)",
        source,
        target);
    jdbc.update("update review.alert_tx_edits set alert_id=? where alert_id=?", target, source);
    jdbc.update(
        "update review.alert_tx_edits set target_alert_id=? where target_alert_id=?",
        target,
        source);
  }

  void publishVersion(
      long target,
      int version,
      Map<String, Object> evidence,
      Map<String, Object> plan,
      Timestamp at) {
    jdbc.update(
        "update review.alert_versions set published_at=? where alert_id=? and version=? and published_at is null",
        at,
        target,
        version);
    jdbc.update(
        "update review.alerts set published_version=?,revision=revision+1 where alert_id=?",
        version,
        target);
    if ("WITHDRAW".equals(plan.get("action")) || rows(evidence.get("seeds")).isEmpty())
      jdbc.update(
          "update review.alerts set status='CLOSED',outcome='SCOPE_CLEARED',closed_at=? where alert_id=?",
          at,
          target);
    new CaseSummaryStore(jdbc).refresh(target);
  }

  private long event(
      long target, String action, Timestamp at, Set<Long> recipients, Object snapshot) {
    String comment = action;
    if ("ADDED_EVIDENCE".equals(action)) {
      var changes = object(snapshot);
      var added = rows(changes.get("addedTransactions"));
      comment =
          "연결 근거 자동 반영 · "
              + at.toInstant().atZone(BusinessTime.KST)
              + " · 추가 거래 "
              + added.size()
              + "건"
              + (added.isEmpty()
                  ? ""
                  : " (거래 ID: "
                      + added.stream()
                          .map(m -> m.get("txId").toString())
                          .collect(java.util.stream.Collectors.joining(", "))
                      + ")")
              + " · 근거 버전 "
              + changes.get("previousPublishedVersion")
              + " → "
              + changes.get("publishedVersion");
    }
    long id =
        jdbc.queryForObject(
            "insert into review.events(alert_id,action,comment,business_at,recorded_at,snapshot) values(?,?,?,?,?,?::jsonb) returning event_id",
            Long.class,
            target,
            action,
            comment,
            at,
            at,
            encode(snapshot));
    for (long user : recipients)
      jdbc.update("insert into review.event_recipients values(?,?)", id, user);
    return id;
  }

  private static List<Long> ids(Object value) {
    if (!(value instanceof List<?> values)) throw new IllegalStateException("INVALID_PLAN_IDS");
    return values.stream().map(ReviewJson::number).toList();
  }
}
