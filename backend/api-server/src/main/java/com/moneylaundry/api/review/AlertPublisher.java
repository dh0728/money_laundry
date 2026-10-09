package com.moneylaundry.api.review;

import static com.moneylaundry.api.review.ReviewJson.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Applies prepared flow plans inside the runner's final, fenced transaction. */
public final class AlertPublisher {
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
        "select exists(select 1 from analysis.alert_fact_checks f join ledger.transactions t using(tx_id) where f.run_id=? and f.integration_status<>t.integration_status) or exists(select 1 from analysis.input_scores i left join analysis.current_scores c using(tx_id) where i.run_id=? and i.score_run_id is distinct from c.run_id)",
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
        """,
            Boolean.class,
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
      if ("PROPOSE".equals(action)) {
        var existing =
            jdbc.queryForList(
                "select proposal_id,status from review.alert_change_proposals where target_alert_id=? and evidence_digest=?",
                target,
                fingerprint);
        if (!existing.isEmpty()) {
          refreshProposal(
              number(existing.getFirst().get("proposal_id")), plan, run, at, recipients);
          recordCoverage(run, plan, target);
          return 0;
        }
      }
      int version = saveVersion(target, run, fingerprint, evidence);
      if ("PROPOSE".equals(action)) {
        String proposedAction =
            rows(evidence.get("seeds")).isEmpty()
                ? "WITHDRAW"
                : affected.size() > 1 ? "MERGE" : "UPDATE";
        long proposal =
            jdbc.queryForObject(
                "insert into review.alert_change_proposals(target_alert_id,proposed_version,evidence_digest,status,source_run_id,action,payload,created_at) values(?,?,?,'OPEN',?,?,?::jsonb,?) returning proposal_id",
                Long.class,
                target,
                version,
                fingerprint,
                run,
                proposedAction,
                encode(proposalPayload(plan)),
                at);
        for (var base : rows(plan.get("baselines")))
          if (affected.contains(number(base.get("alertId"))))
            jdbc.update(
                "insert into review.alert_proposal_cases(proposal_id,alert_id,expected_revision,expected_published_version,assignee_id) values(?,?,?,?,?)",
                proposal,
                base.get("alertId"),
                base.get("revision"),
                base.get("publishedVersion"),
                base.get("assigneeId"));
        event(
            target,
            "CHANGE_PROPOSED",
            at,
            recipients,
            Map.of("proposalId", proposal, "reason", plan.get("reason")));
      } else {
        var changes = publicationChanges(target, version, evidence);
        publishVersion(target, version, evidence, plan, at);
        String eventAction =
            switch (action) {
              case "MERGE" -> "MERGED";
              case "WITHDRAW" -> "EVIDENCE_WITHDRAWN";
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
            }
        if ("FOLLOWUP".equals(action))
          for (long source : references)
            jdbc.update(
                "insert into review.alert_lineage values(?,?,'FOLLOWUP_OF',?)",
                target,
                source,
                event);
      }
    }
    recordCoverage(run, plan, target);
    return create ? 1 : 0;
  }

  private void recordCoverage(UUID run, Map<String, Object> plan, Long target) {
    var checked = new TreeSet<Long>(ids(plan.get("caseIds")));
    checked.addAll(ids(plan.get("referenceIds")));
    if (target != null) checked.add(target);
    for (long id : checked)
      jdbc.update(
          "insert into review.alert_coverage_checks(alert_id,run_id,coverage,checked_at) values(?,?,?::jsonb,clock_timestamp()) on conflict(alert_id,run_id) do nothing",
          id,
          run,
          encode(plan.get("coverage")));
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

  private void refreshProposal(
      long id, Map<String, Object> plan, UUID run, Timestamp at, Set<Long> recipients) {
    var proposal =
        jdbc.queryForMap("select * from review.alert_change_proposals where proposal_id=?", id);
    if ("REJECTED".equals(proposal.get("status"))) return;
    var votes =
        jdbc.queryForList(
            "select * from review.alert_proposal_cases where proposal_id=? order by alert_id", id);
    var bases =
        rows(plan.get("baselines")).stream()
            .filter(b -> ids(plan.get("caseIds")).contains(number(b.get("alertId"))))
            .toList();
    boolean same =
        bases.size() == votes.size()
            && bases.stream()
                .allMatch(
                    b ->
                        votes.stream()
                            .anyMatch(
                                v ->
                                    number(b.get("alertId")) == number(v.get("alert_id"))
                                        && number(b.get("revision"))
                                            == number(v.get("expected_revision"))
                                        && number(b.get("publishedVersion"))
                                            == number(v.get("expected_published_version"))
                                        && number(b.get("assigneeId"))
                                            == number(v.get("assignee_id"))));
    if (same && "OPEN".equals(proposal.get("status")) && proposalInputCurrent(proposal)) return;
    long target = number(proposal.get("target_alert_id"));
    event(
        target,
        "PROPOSAL_SUPERSEDED",
        at,
        Set.of(),
        Map.of("proposalId", id, "previousStatus", proposal.get("status"), "votes", votes));
    jdbc.update("delete from review.alert_proposal_cases where proposal_id=?", id);
    for (var b : bases)
      jdbc.update(
          "insert into review.alert_proposal_cases(proposal_id,alert_id,expected_revision,expected_published_version,assignee_id) values(?,?,?,?,?)",
          id,
          b.get("alertId"),
          b.get("revision"),
          b.get("publishedVersion"),
          b.get("assigneeId"));
    int version =
        saveVersion(target, run, plan.get("fingerprint").toString(), object(plan.get("evidence")));
    jdbc.update(
        "update review.alert_change_proposals set status='OPEN',revision=revision+1,generation=generation+1,source_run_id=?,proposed_version=?,payload=?::jsonb,action=?,resolved_at=null where proposal_id=?",
        run,
        version,
        encode(proposalPayload(plan)),
        rows(object(plan.get("evidence")).get("seeds")).isEmpty()
            ? "WITHDRAW"
            : ids(plan.get("caseIds")).size() > 1 ? "MERGE" : "UPDATE",
        id);
    event(
        target,
        "CHANGE_PROPOSED",
        at,
        recipients,
        Map.of("proposalId", id, "reason", plan.get("reason")));
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
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,?,?,?,?::jsonb)",
        target,
        version,
        run,
        fingerprint,
        encode(evidence));
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

  private Map<String, Object> proposalPayload(Map<String, Object> plan) {
    var payload = new LinkedHashMap<>(plan);
    payload.remove("evidence");
    payload.remove("coverage");
    return payload;
  }

  boolean proposalInputCurrent(Map<String, Object> proposal) {
    return jdbc.queryForObject(
        """
        select exists(select 1 from analysis.runs r join analysis.jobs j using(job_id)
          where r.run_id=? and r.status='COMPLETED' and j.status='COMPLETED')
        and not exists(select 1 from review.alert_transactions m join ledger.transactions t using(tx_id)
          where m.alert_id=? and m.version=? and t.integration_status<>'ACTIVE')
        and not exists(select 1 from analysis.alert_fact_checks f join ledger.transactions t using(tx_id)
          where f.run_id=? and f.integration_status is distinct from t.integration_status)
        and not exists(select 1 from analysis.input_scores i left join analysis.current_scores c using(tx_id)
          where i.run_id=? and c.run_id is distinct from i.score_run_id and c.run_id is distinct from ?)
        and not exists(select 1 from analysis.scores s left join analysis.current_scores c using(tx_id)
          where s.run_id=? and c.run_id is distinct from s.run_id)
        """,
        Boolean.class,
        proposal.get("source_run_id"),
        proposal.get("target_alert_id"),
        proposal.get("proposed_version"),
        proposal.get("source_run_id"),
        proposal.get("source_run_id"),
        proposal.get("source_run_id"),
        proposal.get("source_run_id"));
  }

  void accept(Map<String, Object> proposal, Timestamp at) {
    if (!TransactionSynchronizationManager.isActualTransactionActive())
      throw new IllegalStateException("ALERT_PUBLICATION_REQUIRES_TRANSACTION");
    if (!jdbc.queryForObject(
            """
        select count(*)>0 and bool_and(coalesce(response='APPROVED' and response_actor=assignee_id and response_at is not null,false))
        from review.alert_proposal_cases where proposal_id=?
        """,
            Boolean.class,
            proposal.get("proposal_id"))
        || !proposalInputCurrent(proposal))
      throw com.moneylaundry.api.ApiException.invalidTransition("제안의 동의 또는 근거가 변경됐습니다.");
    long target = number(proposal.get("target_alert_id"));
    int version = ((Number) proposal.get("proposed_version")).intValue();
    var plan = object(proposal.get("payload"));
    plan.put("action", proposal.get("action"));
    var evidence =
        object(
            jdbc.queryForObject(
                "select evidence::text from review.alert_versions where alert_id=? and version=?",
                String.class,
                target,
                version));
    var affected = ids(plan.get("caseIds"));
    var changes = publicationChanges(target, version, evidence);
    if ("MERGE".equals(proposal.get("action"))) mergeScopes(target, version, affected);
    publishVersion(target, version, evidence, plan, at);
    var recipients =
        new TreeSet<>(
            jdbc.queryForList(
                "select distinct assignee_id from review.alert_proposal_cases where proposal_id=?",
                Long.class,
                proposal.get("proposal_id")));
    String action =
        "MERGE".equals(proposal.get("action"))
            ? "MERGED"
            : "WITHDRAW".equals(proposal.get("action")) ? "EVIDENCE_WITHDRAWN" : "ADDED_EVIDENCE";
    long event =
        event(target, action, at, recipients, acceptedSnapshot(changes, proposal, affected, plan));
    if ("MERGE".equals(proposal.get("action")))
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
        }
  }

  private Map<String, Object> acceptedSnapshot(
      Map<String, Object> changes,
      Map<String, Object> proposal,
      List<Long> affected,
      Map<String, Object> plan) {
    changes.put("proposalId", proposal.get("proposal_id"));
    changes.put("caseIds", affected);
    changes.put("reason", plan.get("reason"));
    return changes;
  }

  private void mergeScopes(long target, int version, List<Long> affected) {
    var selected = new TreeMap<Long, Map<String, Object>>();
    // Preserve employee decisions/exclusions. Conflicting judgments or explicit
    // role choices need staff resolution; approval must not silently choose one.
    for (long source : affected)
      for (var member :
          jdbc.queryForList(
              "select * from review.alert_members where alert_id=? order by group_id,tx_id",
              source)) {
        long key = number(member.get("tx_id"));
        var previous = selected.get(key);
        if (previous != null) {
          if ("EXCLUDED".equals(previous.get("state"))) continue;
          if (!"EXCLUDED".equals(member.get("state"))
              && (!Objects.equals(previous.get("review_role"), member.get("review_role"))
                  || ("DECIDED".equals(previous.get("state"))
                      && "DECIDED".equals(member.get("state"))
                      && !Objects.equals(previous.get("decision"), member.get("decision")))))
            throw com.moneylaundry.api.ApiException.invalidTransition(
                "병합 대상의 판정 또는 조사 역할이 충돌합니다. 범위를 확인하세요.");
          if ("DECIDED".equals(previous.get("state")) && "PENDING".equals(member.get("state")))
            continue;
        }
        selected.put(key, member);
      }
    if (selected.isEmpty()) return;
    var groups =
        jdbc.queryForList(
            "select group_id from review.alert_groups where alert_id=? order by group_id",
            Long.class,
            target);
    long group =
        groups.isEmpty()
            ? jdbc.queryForObject(
                "insert into review.alert_groups(alert_id,label,evidence_version) values(?,?,?) returning group_id",
                Long.class,
                target,
                "Alert " + target,
                version)
            : groups.getFirst();
    for (var member : selected.values()) {
      // Invalidated facts remain in the original immutable evidence and events;
      // they are never reintroduced into the survivor's active scope.
      if (!jdbc.queryForObject(
          "select exists(select 1 from review.alert_transactions where alert_id=? and version=? and tx_id=?)",
          Boolean.class,
          target,
          version,
          member.get("tx_id"))) continue;
      jdbc.update(
          "insert into review.alert_members(group_id,alert_id,tx_id,evidence_version,review_role,state,decision) values(?,?,?,?,?,?,?) on conflict(group_id,tx_id) do update set review_role=excluded.review_role,state=excluded.state,decision=excluded.decision",
          group,
          target,
          member.get("tx_id"),
          version,
          member.get("review_role"),
          member.get("state"),
          member.get("decision"));
    }
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
    // Once staff has materialized a scope, only explicit publication changes it.
    var groups =
        jdbc.queryForList(
            "select group_id from review.alert_groups where alert_id=? order by group_id",
            Long.class,
            target);
    if (!groups.isEmpty()) {
      long group = groups.getFirst();
      jdbc.update(
          "update review.alert_groups set evidence_version=?,revision=revision+1 where group_id=?",
          version,
          group);
      jdbc.update(
          """
          insert into review.alert_members(group_id,alert_id,tx_id,evidence_version,review_role,state)
          select ?,t.alert_id,t.tx_id,t.version,
            case when t.role='CONTEXT' then 'CONTEXT' else 'SUBJECT' end,'PENDING'
          from review.alert_transactions t where t.alert_id=? and t.version=?
          on conflict(group_id,tx_id) do update set evidence_version=
            case when review.alert_members.state='PENDING' then excluded.evidence_version
                 else review.alert_members.evidence_version end
          """,
          group,
          target,
          version);
      // Historical membership/decisions remain untouched. effective_members intersects
      // saved scope with the published version, independently of employee judgments.
    }
    if ("WITHDRAW".equals(plan.get("action")))
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
            "insert into review.events(alert_id,action,comment,business_at,snapshot) values(?,?,?,?,?::jsonb) returning event_id",
            Long.class,
            target,
            action,
            comment,
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
