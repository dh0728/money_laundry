package com.moneylaundry.api.ingest;

import com.moneylaundry.api.analysis.AnalysisRunService;
import com.moneylaundry.api.correction.CorrectionService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;

/** Called under the integration transaction lock. Selection never expands the fixed receipt set. */
final class ReportReplacement {
  private final JdbcTemplate jdbc;
  private final PrivateDataProtector protector;
  private final ObjectMapper mapper;
  private final TransactionIntegrationService integration;
  private final AnalysisRunService runs;

  private record Version(
      long id,
      long set,
      int bank,
      int number,
      long generation,
      long revision,
      Long current,
      boolean valid) {}

  ReportReplacement(
      JdbcTemplate jdbc,
      PrivateDataProtector protector,
      ObjectMapper mapper,
      TransactionIntegrationService integration,
      AnalysisRunService runs) {
    this.jdbc = jdbc;
    this.protector = protector;
    this.mapper = mapper;
    this.integration = integration;
    this.runs = runs;
  }

  TransactionIntegrationService.Outcome integrate(LocalDate date, Instant cutoff, Set<Long> fixed) {
    protector.requireKeys();
    // Old/current pointers and new candidates are read after the shared lock, preventing stale
    // prepares.
    if (jdbc.queryForObject(
            "select count(*) from report_sets s join report_versions v on v.version_id=s.current_version_id where s.business_date=? and v.received_at>?",
            Integer.class,
            date,
            Timestamp.from(cutoff))
        > 0) throw new IllegalStateException("CUTOFF_SUPERSEDED");
    Map<Long, Version> selected = new TreeMap<>();
    var all =
        jdbc.query(
            "select v.*,s.bank_id,s.generation,s.current_version_id from report_versions v join report_sets s using(set_id) where s.business_date=? and v.received_at<=? order by v.version_no",
            (rs, n) ->
                new Version(
                    rs.getLong("version_id"),
                    rs.getLong("set_id"),
                    rs.getInt("bank_id"),
                    rs.getInt("version_no"),
                    rs.getLong("generation"),
                    rs.getLong("revision"),
                    (Long) rs.getObject("current_version_id"),
                    rs.getBoolean("self_valid")),
            date,
            Timestamp.from(cutoff));
    Set<Long> eligible = new HashSet<>();
    for (long id : fixed) {
      var versions =
          jdbc.queryForList(
              "select version_id from report_versions where upload_id=? and received_at<=?",
              Long.class,
              id,
              Timestamp.from(cutoff));
      if (versions.isEmpty()) throw new IllegalStateException("FIXED_REPORT_NOT_READY");
      eligible.addAll(versions);
    }
    for (Version v : all) if (Objects.equals(v.current(), v.id())) selected.put(v.set(), v);
    for (Version v : all) if (v.valid() && eligible.contains(v.id())) selected.put(v.set(), v);
    if (selected.isEmpty()) return new TransactionIntegrationService.Outcome(0, all.size(), 0);
    boolean newScope =
        jdbc.update(
                "insert into reporting_scopes(business_date) values(?) on conflict do nothing",
                date)
            == 1;
    long scopeRevision =
        jdbc.queryForObject(
            "select scope_revision from reporting_scopes where business_date=?", Long.class, date);
    if (newScope)
      jdbc.update(
          "insert into reporting_scope_banks select ?,?,bank_id from bank_reporting_periods where effective_from_date<=? and (effective_to_date is null or effective_to_date>=?)",
          date,
          scopeRevision,
          date,
          date);
    Set<Integer> scope =
        new HashSet<>(
            jdbc.queryForList(
                "select bank_id from reporting_scope_banks where business_date=? and scope_revision=?",
                Integer.class,
                date,
                scopeRevision));
    if (selected.values().stream().anyMatch(v -> !scope.contains(v.bank())))
      throw new IllegalStateException("REPORT_OUTSIDE_SCOPE");
    Map<Long, List<ReportMatcher.Report>> rows = new HashMap<>(), oldRows = new HashMap<>();
    Map<Long, Set<String>> links = new HashMap<>();
    for (Version v : selected.values()) {
      rows.put(v.set(), read(v));
      List<ReportMatcher.Report> old =
          v.current() == null
              ? List.of()
              : read(new Version(v.current(), v.set(), v.bank(), 0, 0, 0, null, true));
      oldRows.put(v.set(), old);
      Set<String> keys = new HashSet<>();
      keys.add("bank:" + v.bank());
      for (var report :
          java.util.stream.Stream.concat(rows.get(v.set()).stream(), old.stream()).toList()) {
        var r = report.row();
        if (scope.contains(r.fromBank())) keys.add("bank:" + r.fromBank());
        if (scope.contains(r.toBank())) keys.add("bank:" + r.toBank());
        keys.add("account:" + r.fromBank() + ":" + r.fromAccount());
        keys.add("account:" + r.toBank() + ":" + r.toAccount());
        keys.add("entity:" + r.fromEntityId());
        keys.add("entity:" + r.toEntityId());
      }
      links.put(v.set(), keys);
    }
    Set<Long> remaining = new TreeSet<>(selected.keySet());
    while (!remaining.isEmpty()) {
      Set<Long> component = new TreeSet<>();
      component.add(remaining.iterator().next());
      boolean grew;
      do {
        grew = false;
        Set<String> keys = new HashSet<>();
        component.forEach(s -> keys.addAll(links.get(s)));
        for (long set : List.copyOf(remaining))
          if (!Collections.disjoint(keys, links.get(set)) && component.add(set)) grew = true;
      } while (grew);
      remaining.removeAll(component);
      replaceComponent(
          date,
          cutoff,
          scopeRevision,
          scope,
          component.stream().map(selected::get).toList(),
          rows,
          oldRows);
    }
    return new TransactionIntegrationService.Outcome(
        jdbc.queryForObject(
            "select count(*) from transactions where business_date=? and integration_status='ACTIVE'",
            Integer.class,
            date),
        jdbc.queryForObject(
            "select count(*) from report_versions v join report_sets s using(set_id) where s.business_date=? and stage_status in ('HELD','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE')",
            Integer.class,
            date),
        0);
  }

  private List<ReportMatcher.Report> read(Version v) {
    return jdbc.query(
        "select * from private.bank_reports where version_id=? order by report_id",
        (rs, n) ->
            new ReportMatcher.Report(
                rs.getLong("report_id"),
                v.id(),
                v.bank(),
                mapper.readValue(
                    protector.decrypt(
                        "report:" + v.id() + ":" + rs.getInt("source_row"),
                        rs.getString("payload_cipher"),
                        rs.getString("key_version")),
                    TransactionRow.class)),
        v.id());
  }

  private Object identity(TransactionRow r) {
    return List.of(
        ReportMatcher.key(r),
        r.paymentFormat(),
        r.fromBankName(),
        r.toBankName(),
        r.fromEntityId(),
        r.fromEntityName(),
        r.toEntityId(),
        r.toEntityName());
  }

  private void replaceComponent(
      LocalDate date,
      Instant cutoff,
      long scopeRevision,
      Set<Integer> scope,
      List<Version> versions,
      Map<Long, List<ReportMatcher.Report>> rows,
      Map<Long, List<ReportMatcher.Report>> oldRows) {
    if (versions.stream().allMatch(v -> Objects.equals(v.current(), v.id()))) return;
    List<ReportMatcher.Report> reports =
        versions.stream().flatMap(v -> rows.get(v.set()).stream()).toList();
    Set<Long> invalid = new HashSet<>();
    Map<List<String>, Boolean> cache = new HashMap<>();
    for (var r : reports)
      if (integration.conflictsWithConfirmed(r.row(), cache)) invalid.add(r.version());
    var matched = ReportMatcher.match(reports, scope, invalid, Set.of());
    Map<Object, Deque<Long>> old = new HashMap<>();
    Set<Long> oldIds = new TreeSet<>();
    for (Version v : versions)
      for (var r : oldRows.get(v.set())) {
        var ids =
            jdbc.queryForList(
                "select tr.tx_id from transaction_reports tr join transactions t using(tx_id) where tr.report_id=? and t.integration_status='ACTIVE'",
                Long.class,
                r.id());
        for (long id : ids)
          if (oldIds.add(id))
            old.computeIfAbsent(identity(r.row()), k -> new ArrayDeque<>()).add(id);
      }
    // Keep completed occurrences first when repeated identical rows are reduced.
    for (var entry : old.entrySet()) {
      var sorted =
          entry.getValue().stream()
              .sorted(
                  Comparator.<Long, Boolean>comparing(id -> !runs.completedTarget(id))
                      .thenComparingLong(id -> id))
              .toList();
      entry.setValue(new ArrayDeque<>(sorted));
    }
    Map<ReportMatcher.Match, Long> kept = new LinkedHashMap<>();
    Set<Long> retained = new HashSet<>();
    for (var m : matched.matches()) {
      var queue = old.get(identity(m.first().row()));
      if (queue != null && !queue.isEmpty()) {
        long id = queue.removeFirst();
        kept.put(m, id);
        retained.add(id);
      }
    }
    Set<Long> changed = new TreeSet<>(oldIds);
    changed.removeAll(retained);
    if (!matched.heldVersions().isEmpty() || !matched.dependencyReports().isEmpty()) {
      changed.clear();
      for (Version v : versions)
        if (!Objects.equals(v.current(), v.id())) {
          Map<Object, Integer> counts = new HashMap<>();
          rows.get(v.set()).forEach(r -> counts.merge(identity(r.row()), 1, Integer::sum));
          var prior = new ArrayList<>(oldRows.get(v.set()));
          prior.sort(
              Comparator.comparing(
                  r ->
                      jdbc
                          .queryForList(
                              "select tx_id from transaction_reports where report_id=?",
                              Long.class,
                              r.id())
                          .stream()
                          .noneMatch(runs::completedTarget)));
          for (var r : prior) {
            Object key = identity(r.row());
            int count = counts.getOrDefault(key, 0);
            if (count > 0) counts.put(key, count - 1);
            else
              changed.addAll(
                  jdbc.queryForList(
                      "select tx_id from transaction_reports where report_id=?",
                      Long.class,
                      r.id()));
          }
        }
    }
    if (changed.stream().anyMatch(runs::completedTarget)) {
      hold(versions, "COMPLETED_TARGET_CHANGE_OUT_OF_SCOPE", "OPEN");
      return;
    }
    if (!invalid.isEmpty()) {
      hold(versions, "INVALID_SELF_OR_CONFIRMED_IDENTITY", "OPEN");
      return;
    }
    runs.cancelAffected(changed);
    if (!matched.heldVersions().isEmpty() || !matched.dependencyReports().isEmpty()) {
      hold(
          versions,
          invalid.isEmpty() ? "COUNTERPART_MISSING" : "INVALID_SELF_OR_CONFIRMED_IDENTITY",
          invalid.isEmpty() ? "WAITING_COUNTERPART" : "OPEN");
      for (var report : reports) {
        var r = report.row();
        int other = report.bank() == r.fromBank() ? r.toBank() : r.fromBank();
        if (scope.contains(other) && versions.stream().noneMatch(v -> v.bank() == other))
          CorrectionService.open(jdbc, other, date, null, "REPORT_MISSING", scopeRevision);
      }
      return;
    }
    long attempt =
        jdbc.queryForObject(
            "insert into integration_attempts(business_date,cutoff_at,scope_revision,status) values(?,?,?,'PREPARING') returning attempt_id",
            Long.class,
            date,
            Timestamp.from(cutoff),
            scopeRevision);
    for (Version v : versions)
      jdbc.update(
          "insert into integration_attempt_versions values(?,?,?,?)",
          attempt,
          v.id(),
          v.generation(),
          v.revision());
    for (long id : changed)
      jdbc.update(
          "update transactions set integration_status='SUPERSEDED',generation=generation+1 where tx_id=?",
          id);
    Map<List<String>, Long> accounts = new HashMap<>();
    for (var m : matched.matches()) {
      long id =
          kept.containsKey(m)
              ? kept.get(m)
              : integration.insertTransaction(date, m.first().row(), accounts);
      integration.connect(id, m.first());
      if (m.second() != null) integration.connect(id, m.second());
    }
    for (Version v : versions) {
      if (v.current() != null && !Objects.equals(v.current(), v.id()))
        jdbc.update(
            "update report_versions set stage_status='SUPERSEDED',revision=revision+1 where version_id=?",
            v.current());
      if (jdbc.update(
              "update report_sets set current_version_id=?,generation=generation+1 where set_id=? and generation=?",
              v.id(),
              v.set(),
              v.generation())
          != 1) throw new IllegalStateException("REPORT_GENERATION_CHANGED");
      jdbc.update(
          "update report_versions set stage_status='ACTIVE',error_code=null,revision=revision+1 where version_id=? and revision=?",
          v.id(),
          v.revision());
      jdbc.update(
          "update correction_requests set status='RESOLVED',replacement_version_id=?,resolved_at=now(),revision=revision+1 where bank_id=? and business_date=? and status<>'RESOLVED' and not exists(select 1 from correction_uploads u join batch_jobs b on b.job_id=u.upload_id where u.correction_id=correction_requests.correction_id and (b.received_at is null or b.received_at>?) ) and not exists(select 1 from correction_uploads u join report_versions newer on newer.upload_id=u.upload_id where u.correction_id=correction_requests.correction_id and newer.version_no>?)",
          v.id(),
          v.bank(),
          date,
          Timestamp.from(cutoff),
          v.number());
    }
    jdbc.update("update integration_attempts set status='COMPLETED' where attempt_id=?", attempt);
  }

  private void hold(List<Version> versions, String code, String state) {
    for (Version v : versions)
      if (!Objects.equals(v.current(), v.id())) {
        jdbc.update(
            "update report_versions set stage_status=?,error_code=?,revision=revision+1 where version_id=?",
            "OPEN".equals(state) ? "HELD" : state,
            code,
            v.id());
        var corrections =
            jdbc.queryForList(
                "select c.correction_id from correction_requests c join correction_uploads u using(correction_id) join report_versions v on v.upload_id=u.upload_id where v.version_id=?",
                Long.class,
                v.id());
        if (corrections.isEmpty())
          corrections =
              List.of(
                  CorrectionService.open(
                      jdbc,
                      v.bank(),
                      jdbc.queryForObject(
                          "select business_date from report_sets where set_id=?",
                          LocalDate.class,
                          v.set()),
                      v.id(),
                      code,
                      1));
        for (long correction : corrections) {
          if (jdbc.queryForObject(
                  "select count(*) from correction_uploads u where u.correction_id=? and u.upload_id>(select upload_id from report_versions where version_id=?)",
                  Integer.class,
                  correction,
                  v.id())
              > 0) continue;
          jdbc.update(
              "update correction_requests set status=? where correction_id=? and status<>'RESOLVED'",
              state,
              correction);
          jdbc.update("delete from correction_errors where correction_id=?", correction);
          jdbc.update(
              "insert into correction_errors values(?,0,null,'',?,'보고 대조와 정정 조건을 확인하세요.')",
              correction,
              code);
        }
      }
  }
}
