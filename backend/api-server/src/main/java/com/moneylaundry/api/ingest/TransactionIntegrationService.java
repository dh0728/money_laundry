package com.moneylaundry.api.ingest;

import java.math.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * First integration only. Fixed received upload IDs are supplied by the caller, never expanded
 * here.
 */
@Service
public class TransactionIntegrationService {
  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final PrivateDataProtector protector;
  private final ObjectMapper mapper;
  private final String fxVersion;

  public TransactionIntegrationService(
      JdbcTemplate jdbc,
      TransactionTemplate tx,
      PrivateDataProtector protector,
      ObjectMapper mapper,
      @Value("${app.ingest.fx-rate-version}") String fxVersion) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.protector = protector;
    this.mapper = mapper;
    this.fxVersion = fxVersion;
  }

  public record Outcome(int transactions, int heldFiles, int dependentReports) {}

  private record Version(
      long id, long setId, int bank, String status, long revision, long generation) {}

  public Outcome integrate(LocalDate businessDate, Instant cutoff, Set<Long> fixedUploadIds) {
    if (businessDate == null || cutoff == null || fixedUploadIds == null)
      throw new IllegalArgumentException("FIXED_INPUT_REQUIRED");
    return tx.execute(status -> {
      com.moneylaundry.api.analysis.AnalysisRunService.integrationLock(jdbc);
      boolean correction=jdbc.queryForObject("select count(*) from report_versions v join report_sets s using(set_id) where s.business_date=? and (v.correction_of_version_id is not null or v.version_no>1 or s.generation>0)",Integer.class,businessDate)>0;
      Outcome outcome=correction?new ReportReplacement(jdbc,protector,mapper,this,new com.moneylaundry.api.analysis.AnalysisRunService(jdbc,tx,Clock.systemUTC(),mapper)).integrate(businessDate,cutoff,fixedUploadIds):integrateLocked(businessDate,cutoff,Set.copyOf(fixedUploadIds));
      publishCorrections(businessDate);
      return outcome;
    });
  }

  private Outcome integrateLocked(LocalDate date, Instant cutoff, Set<Long> uploads) {
    protector.requireKeys();
    // One commit lock protects cross-date entity ownership as well as report generations.
    jdbc.query("select pg_advisory_xact_lock(?)", ps -> ps.setLong(1, 17004000L), rs -> {});
    List<Version> versions = new ArrayList<>();
    Set<Long> sets = new HashSet<>();
    for (long upload : uploads.stream().sorted().toList()) {
      var found =
          jdbc.query(
              "select v.*,s.bank_id,s.generation from report_versions v join report_sets s"
                  + " using(set_id) where v.upload_id=? and s.business_date=? and v.received_at<=?",
              (rs, n) ->
                  new Version(
                      rs.getLong("version_id"),
                      rs.getLong("set_id"),
                      rs.getInt("bank_id"),
                      rs.getString("stage_status"),
                      rs.getLong("revision"),
                      rs.getLong("generation")),
              upload,
              date,
              Timestamp.from(cutoff));
      if (found.size() != 1) throw new IllegalStateException("FIXED_REPORT_NOT_READY");
      Version v = found.getFirst();
      if (!sets.add(v.setId())) throw new IllegalStateException("ONE_VERSION_PER_BANK_REQUIRED");
      versions.add(v);
    }
    if (versions.isEmpty()) return new Outcome(0, 0, 0);
    long integrated = versions.stream().filter(v -> v.generation() > 0).count();
    if (integrated > 0) {
      if (integrated != versions.size())
        throw new IllegalStateException("CORRECTION_NOT_CONNECTED");
      Set<Long> previous =
          new HashSet<>(
              jdbc.queryForList(
                  "select av.version_id from integration_attempt_versions av join"
                      + " integration_attempts a using(attempt_id) where a.business_date=? and"
                      + " a.status='COMPLETED'",
                  Long.class,
                  date));
      if (!previous.equals(new HashSet<>(versions.stream().map(Version::id).toList())))
        throw new IllegalStateException("FIXED_INPUT_CHANGED");
      // Retry is read-only; a different fixed input cannot append to a previously fixed date.
      int count =
          jdbc.queryForObject(
              "select count(*) from transactions where business_date=? and"
                  + " integration_status='ACTIVE'",
              Integer.class,
              date);
      return new Outcome(
          count,
          (int) versions.stream().filter(v -> v.status().equals("HELD")).count(),
          jdbc.queryForObject(
              "select count(*) from private.bank_reports r join report_versions v using(version_id)"
                  + " join report_sets s using(set_id) where s.business_date=? and"
                  + " r.report_status='DEPENDENCY_HELD'",
              Integer.class,
              date));
    }
    if (jdbc.queryForObject(
            "select count(*) from integration_attempts where business_date=? and"
                + " status='COMPLETED'",
            Integer.class,
            date)
        > 0) throw new IllegalStateException("CORRECTION_NOT_CONNECTED");
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
          "insert into reporting_scope_banks(business_date,scope_revision,bank_id) select"
              + " ?,?,bank_id from bank_reporting_periods where effective_from_date<=? and"
              + " (effective_to_date is null or effective_to_date>=?)",
          date,
          scopeRevision,
          date,
          date);
    Set<Integer> scope =
        new HashSet<>(
            jdbc.queryForList(
                "select bank_id from reporting_scope_banks where business_date=? and"
                    + " scope_revision=?",
                Integer.class,
                date,
                scopeRevision));
    if (versions.stream().anyMatch(v -> !scope.contains(v.bank())))
      throw new IllegalStateException("REPORT_OUTSIDE_SCOPE");
    long attempt =
        jdbc.queryForObject(
            "insert into integration_attempts(business_date,cutoff_at,scope_revision,status)"
                + " values(?,?,?,'PREPARING') returning attempt_id",
            Long.class,
            date,
            Timestamp.from(cutoff),
            scopeRevision);
    List<ReportMatcher.Report> reports = new ArrayList<>();
    Set<Long> held = new HashSet<>();
    Set<Integer> invalidBanks = new HashSet<>();
    for (Version v : versions) {
      jdbc.update(
          "insert into integration_attempt_versions values(?,?,?,?)",
          attempt,
          v.id(),
          v.generation(),
          v.revision());
      if (v.status().equals("HELD")) {
        held.add(v.id());
        invalidBanks.add(v.bank());
      }
      reports.addAll(
          jdbc.query(
              "select * from private.bank_reports where version_id=? order by report_id",
              (rs, n) -> {
                TransactionRow row =
                    mapper.readValue(
                        protector.decrypt(
                            "report:" + v.id() + ":" + rs.getInt("source_row"),
                            rs.getString("payload_cipher"),
                            rs.getString("key_version")),
                        TransactionRow.class);
                return new ReportMatcher.Report(rs.getLong("report_id"), v.id(), v.bank(), row);
              },
              v.id()));
    }
    // Conflicting staged reports never win over each other by arrival order.
    Map<List<String>, Boolean> conflictCache = new HashMap<>();
    for (var r : reports)
      if (!held.contains(r.version()) && conflictsWithConfirmed(r.row(), conflictCache))
        held.add(r.version());
    reports.stream()
        .filter(r -> held.contains(r.version()))
        .forEach(r -> invalidBanks.add(r.bank()));
    var result = ReportMatcher.match(reports, scope, held, invalidBanks);
    Map<List<String>, Long> accountCache = new HashMap<>();
    Map<String, BigDecimal> rates = new HashMap<>();
    for (var match : result.matches()) {
      TransactionRow r = match.first().row();
      long from =
          account(
              r.fromBank(),
              r.fromBankName(),
              r.fromAccount(),
              r.fromEntityId(),
              r.fromEntityName(),
              accountCache);
      long to =
          account(
              r.toBank(),
              r.toBankName(),
              r.toAccount(),
              r.toEntityId(),
              r.toEntityName(),
              accountCache);
      BigDecimal rate =
          rates.computeIfAbsent(
              r.paymentCurrency(),
              currency ->
                  jdbc.queryForObject(
                      "select units_per_usd from fx_rates where fx_rate_version=? and currency=?",
                      BigDecimal.class,
                      fxVersion,
                      currency));
      if (rate == null || rate.signum() <= 0) throw new IllegalStateException("FX_RATE_MISSING");
      long txId =
          jdbc.queryForObject(
              "insert into"
                  + " transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)"
                  + " values(?,?,?,?,?,?,?,?,?,?,?) returning tx_id",
              Long.class,
              Timestamp.from(r.occurredAt()),
              from,
              to,
              r.amountReceived(),
              r.receivingCurrency(),
              r.amountPaid(),
              r.paymentCurrency(),
              r.paymentFormat(),
              r.amountPaid().divide(rate, 6, RoundingMode.HALF_UP),
              fxVersion,
              date);
      connect(txId, match.first());
      if (match.second() != null) connect(txId, match.second());
      // Source labels stay per report. Only agreeing available labels are linked for evaluation.
      List<Boolean> labels =
          jdbc.queryForList(
              "select distinct l.is_laundering from evaluation.report_labels l join"
                  + " transaction_reports tr using(report_id) where tr.tx_id=?",
              Boolean.class,
              txId);
      if (labels.size() == 1)
        jdbc.update(
            "insert into evaluation.transaction_labels(tx_id,is_laundering) values(?,?)",
            txId,
            labels.getFirst());
    }
    for (Version v : versions) {
      boolean direct = result.heldVersions().contains(v.id());
      if (direct)
        jdbc.update(
            "update private.bank_reports set report_status='HELD',error_code=coalesce(error_code,?)"
                + " where version_id=?",
            result.reasons().get(v.id()),
            v.id());
      else
        for (var r : reports)
          if (r.version() == v.id() && result.dependencyReports().contains(r.id()))
            jdbc.update(
                "update private.bank_reports set"
                    + " report_status='DEPENDENCY_HELD',error_code='COUNTERPART_HELD' where"
                    + " report_id=?",
                r.id());
      int dependent =
          jdbc.queryForObject(
              "select count(*) from private.bank_reports where version_id=? and"
                  + " report_status='DEPENDENCY_HELD'",
              Integer.class,
              v.id());
      jdbc.update(
          "update report_versions set stage_status=?,error_code=?,revision=revision+1 where"
              + " version_id=?",
          direct ? "HELD" : dependent > 0 ? "PARTIALLY_HELD" : "ACTIVE",
          direct
              ? (v.status().equals("HELD") ? "INVALID_SELF" : result.reasons().get(v.id()))
              : dependent > 0 ? "COUNTERPART_HELD" : null,
          v.id());
      jdbc.update(
          "update report_sets set current_version_id=?,generation=generation+1 where set_id=? and"
              + " generation=?",
          direct ? null : v.id(),
          v.setId(),
          v.generation());
    }
    jdbc.update("update integration_attempts set status='COMPLETED' where attempt_id=?", attempt);
    return new Outcome(
        result.matches().size(), result.heldVersions().size(), result.dependencyReports().size());
  }

  void publishCorrections(LocalDate date) {
    for(var v:jdbc.queryForList("select v.*,s.bank_id from report_versions v join report_sets s using(set_id) where s.business_date=? and v.stage_status in ('HELD','WAITING_COUNTERPART','WAITING_ANALYSIS_RELEASE')",date)) {
      long version=(Long)v.get("version_id");
      if(jdbc.queryForObject("select count(*) from correction_uploads where upload_id=?",Integer.class,v.get("upload_id"))>0)continue;
      String reason=Objects.toString(v.get("error_code"),"COUNTERPART_MISSING");
      if(!"COUNTERPART_MISSING".equals(reason)&&!"COUNTERPART_HELD".equals(reason))com.moneylaundry.api.correction.CorrectionService.open(jdbc,(Integer)v.get("bank_id"),date,version,reason,1);
      if("COUNTERPART_MISSING".equals(reason)) {
        boolean absent=false;
        for(var report:jdbc.queryForList("select * from private.bank_reports where version_id=?",version)) {
          TransactionRow row=mapper.readValue(protector.decrypt("report:"+version+":"+report.get("source_row"),(String)report.get("payload_cipher"),(String)report.get("key_version")),TransactionRow.class);
          int other=(Integer)v.get("bank_id")==row.fromBank()?row.toBank():row.fromBank();
          if(jdbc.queryForObject("select count(*) from reporting_scope_banks where business_date=? and bank_id=?",Integer.class,date,other)>0 && jdbc.queryForObject("select count(*) from report_versions rv join report_sets rs using(set_id) where rs.bank_id=? and rs.business_date=?",Integer.class,other,date)==0){absent=true;com.moneylaundry.api.correction.CorrectionService.open(jdbc,other,date,null,"REPORT_MISSING",1);}
        }
        if(!absent)com.moneylaundry.api.correction.CorrectionService.open(jdbc,(Integer)v.get("bank_id"),date,version,reason,1);
      }
    }
  }

  long insertTransaction(LocalDate date,TransactionRow r,Map<List<String>,Long> accounts) {
    long from=account(r.fromBank(),r.fromBankName(),r.fromAccount(),r.fromEntityId(),r.fromEntityName(),accounts);
    long to=account(r.toBank(),r.toBankName(),r.toAccount(),r.toEntityId(),r.toEntityName(),accounts);
    BigDecimal rate=jdbc.queryForObject("select units_per_usd from fx_rates where fx_rate_version=? and currency=?",BigDecimal.class,fxVersion,r.paymentCurrency());
    if(rate==null||rate.signum()<=0)throw new IllegalStateException("FX_RATE_MISSING");
    return jdbc.queryForObject("insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(?,?,?,?,?,?,?,?,?,?,?) returning tx_id",Long.class,Timestamp.from(r.occurredAt()),from,to,r.amountReceived(),r.receivingCurrency(),r.amountPaid(),r.paymentCurrency(),r.paymentFormat(),r.amountPaid().divide(rate,6,RoundingMode.HALF_UP),fxVersion,date);
  }

  void connect(long txId, ReportMatcher.Report report) {
    TransactionRow r = report.row();
    var connected=jdbc.queryForList("select tx_id from transaction_reports where report_id=?",Long.class,report.id());
    if(!connected.isEmpty()&&connected.getFirst()!=txId)throw new IllegalStateException("REPORT_ALREADY_LINKED");
    jdbc.update(
        "insert into transaction_reports values(?,?,?) on conflict do nothing",
        txId,
        report.id(),
        r.fromBank() == r.toBank()
            ? "INTERNAL"
            : report.bank() == r.fromBank() ? "SENDER" : "RECEIVER");
    jdbc.update(
        "update private.bank_reports set report_status='ACTIVE',error_code=null where report_id=?",
        report.id());
  }

  boolean conflictsWithConfirmed(TransactionRow row, Map<List<String>, Boolean> cache) {
    return conflict(
            row.fromBank(),
            row.fromBankName(),
            row.fromAccount(),
            row.fromEntityId(),
            row.fromEntityName(),
            cache)
        || conflict(
            row.toBank(),
            row.toBankName(),
            row.toAccount(),
            row.toEntityId(),
            row.toEntityName(),
            cache);
  }

  private boolean conflict(
      int bank,
      String bankName,
      String number,
      String entity,
      String name,
      Map<List<String>, Boolean> cache) {
    return cache.computeIfAbsent(
        List.of(Integer.toString(bank), bankName, number, entity, name),
        ignored -> conflict(bank, bankName, number, entity, name));
  }

  private boolean conflict(int bank, String bankName, String number, String entity, String name) {
    var names =
        jdbc.queryForList(
            "select name from banks where bank_id=? and name is not null", String.class, bank);
    if (!names.isEmpty() && !names.getFirst().equals(bankName)) return true;
    String entityToken = protector.token("entity", entity),
        accountToken = protector.token("account", Integer.toString(bank), number);
    var entities =
        jdbc.queryForList(
            "select * from private.entities where entity_lookup_token=?", entityToken);
    if (!entities.isEmpty()) {
      var e = entities.getFirst();
      String version = (String) e.get("key_version");
      if (!protector.decrypt("entity-id", (String) e.get("identity_cipher"), version).equals(entity)
          || !protector.decrypt("entity-name", (String) e.get("name_cipher"), version).equals(name))
        return true;
    }
    var accounts =
        jdbc.queryForList(
            "select a.identity_cipher,a.key_version,e.entity_lookup_token from private.accounts a"
                + " join private.entities e using(entity_id) where a.bank_id=? and"
                + " a.account_lookup_token=?",
            bank,
            accountToken);
    return !accounts.isEmpty()
        && (!accounts.getFirst().get("entity_lookup_token").equals(entityToken)
            || !protector
                .decrypt(
                    "account:" + bank,
                    (String) accounts.getFirst().get("identity_cipher"),
                    (String) accounts.getFirst().get("key_version"))
                .equals(number));
  }

  long account(
      int bank,
      String bankName,
      String number,
      String entity,
      String name,
      Map<List<String>, Long> cache) {
    return cache.computeIfAbsent(
        List.of(Integer.toString(bank), number),
        ignored -> account(bank, bankName, number, entity, name));
  }

  private long account(int bank, String bankName, String number, String entity, String name) {
    jdbc.update(
        "insert into banks(bank_id,name) values(?,?) on conflict(bank_id) do update set"
            + " name=coalesce(banks.name,excluded.name)",
        bank,
        bankName);
    String entityToken = protector.token("entity", entity);
    jdbc.update(
        "insert into"
            + " private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version)"
            + " values(?,?,?,?,?) on conflict(entity_lookup_token) do nothing",
        UUID.randomUUID(),
        entityToken,
        protector.encrypt("entity-id", entity),
        protector.encrypt("entity-name", name),
        protector.version());
    long entityId =
        jdbc.queryForObject(
            "select entity_id from private.entities where entity_lookup_token=?",
            Long.class,
            entityToken);
    String token = protector.token("account", Integer.toString(bank), number);
    jdbc.update(
        "insert into"
            + " private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version)"
            + " values(?,?,?,?,?,?) on conflict(bank_id,account_lookup_token) do nothing",
        bank,
        UUID.randomUUID(),
        token,
        entityId,
        protector.encrypt("account:" + bank, number),
        protector.version());
    return jdbc.queryForObject(
        "select account_id from private.accounts where bank_id=? and account_lookup_token=?",
        Long.class,
        bank,
        token);
  }
}
