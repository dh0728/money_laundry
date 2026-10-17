package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FreezeInputTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired AnalysisRunService runs;
  @MockitoBean AnalysisScheduler scheduler;
  long job;
  long account;
  long version;
  long set;
  final Instant cutoff = Instant.parse("2023-09-02T00:00:00Z");

  @BeforeEach
  void setup() {
    jdbc.execute("truncate core.banks,analysis.jobs,core.owners,ingest.reporting_scopes cascade");
    jdbc.update("insert into core.banks(bank_id) values(12)");
    long entity =
        jdbc.queryForObject(
            """
        insert into core.owners(service_owner_id,display_name)
        values(?,'가명#00001') returning owner_id
        """,
            Long.class,
            UUID.randomUUID());
    account =
        jdbc.queryForObject(
            """
        insert into core.accounts(bank_id,service_account_id,owner_id)
        values(12,?,?) returning account_id
        """,
            Long.class,
            UUID.randomUUID(),
            entity);
    job =
        jdbc.queryForObject(
            """
        insert into analysis.jobs(business_at,threshold_value,status,current_stage,analysis_date,analysis_cutoff_at)
        values(now(),0.7,'RUNNING','FREEZE_INPUT','2023-09-02',?) returning job_id
        """,
            Long.class,
            Timestamp.from(cutoff));
    long upload =
        jdbc.queryForObject(
            """
        insert into ingest.uploads(file_name,file_hash,size_bytes,status,bank_id,business_date,received_at)
        values('fixture.csv',repeat('a',64),1,'COMPLETED',12,'2023-09-01','2023-09-01 18:00+09') returning upload_id
        """,
            Long.class);
    set =
        jdbc.queryForObject(
            "insert into ingest.report_sets(bank_id,business_date) values(12,'2023-09-01') returning set_id",
            Long.class);
    version =
        jdbc.queryForObject(
            """
        insert into ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count)
        values(?,?,1,'2023-09-01 18:00+09','ACTIVE',0) returning version_id
        """,
            Long.class,
            set,
            upload);
    jdbc.update(
        "update ingest.report_sets set current_version_id=?,generation=1 where set_id=?",
        version,
        set);
    jdbc.update("insert into analysis.selected_versions values(?,?,?,1)", job, set, version);
    jdbc.update("insert into analysis.receipts values(?,?)", job, upload);
    jdbc.update("insert into ingest.reporting_scopes(business_date) values('2023-09-01')");
    jdbc.update("insert into ingest.reporting_scope_banks values('2023-09-01',1,12)");
  }

  void completed(long scoredJob, String condition) {
    UUID completed = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')",
        completed,
        scoredJob);
    snapshot(completed, condition);
  }

  void snapshot(UUID run, String condition) {
    jdbc.update(
        """
        insert into analysis.input_transactions
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
          a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id
        join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id
        where
        """
            + condition,
        run);
  }

  void seed(int count) {
    jdbc.update(
        """
        insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,
          amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)
        select '2023-09-01 12:00+09'::timestamptz,?,?,n,'USD',n,'USD','ACH',n,'test','2023-09-01'
        from generate_series(1,?) n
        """,
        account,
        account,
        count);
    jdbc.update(
        """
        insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status)
        select ?,row_number() over(order by tx_id),tx_id::text,'cipher','test','ACTIVE' from ledger.transactions
        """,
        version);
    jdbc.update(
        """
        insert into ledger.transaction_reports select t.tx_id,br.report_id,'INTERNAL'
        from ledger.transactions t join private.bank_reports br on br.match_key=t.tx_id::text
        """);
    jdbc.execute("analyze ledger.transactions");
    jdbc.execute("analyze private.bank_reports");
    jdbc.execute("analyze ledger.transaction_reports");
  }

  @Test
  void freezes_one_hundred_thousand_targets_with_report_links_and_is_idempotent() {
    seed(100_000);
    long start = System.nanoTime();
    UUID run = runs.freeze(job, cutoff);
    long millis = Duration.ofNanos(System.nanoTime() - start).toMillis();
    System.out.printf("FREEZE_INPUT_BENCH targets=100000 elapsedMs=%d%n", millis);
    assertThat(
            jdbc.queryForObject(
                "select row_count from analysis.jobs where job_id=?", Integer.class, job))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_reports where run_id=?", Integer.class, run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.target_ownership where run_id=?",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select sum(amount_paid) from analysis.input_transactions where run_id=?",
                java.math.BigDecimal.class,
                run))
        .isEqualByComparingTo("5000050000");
    assertThat(runs.freeze(job, cutoff)).isEqualTo(run);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.runs where job_id=?", Integer.class, job))
        .isEqualTo(1);
  }

  @Test
  void preserves_eligibility_and_freezes_scored_or_owned_transactions_only_as_context() {
    seed(5);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id=" + ids.get(1));
    UUID owner = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'ACTIVE')", owner, scored);
    snapshot(owner, "t.tx_id=" + ids.get(2));
    jdbc.update("insert into analysis.target_ownership values(?,?)", ids.get(2), owner);
    jdbc.update(
        "update ledger.transactions set integration_status='HELD' where tx_id=?", ids.get(3));
    jdbc.update("delete from ledger.transaction_reports where tx_id=?", ids.get(4));
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.input_transactions where run_id=? and input_role='TARGET'",
                Long.class,
                run))
        .containsExactly(ids.getFirst());
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(1), ids.get(2));
    assertThat(
            jdbc.queryForObject(
                "select run_id from analysis.target_ownership where tx_id=?",
                UUID.class,
                ids.get(2)))
        .isEqualTo(owner);
  }

  @Test
  void context_keeps_full_history_and_cutoff_boundaries_without_duplicate_targets() {
    seed(6);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id<>" + ids.getFirst());
    var timestamps =
        List.of(
            "2023-08-25T15:00:00Z", // History is not trimmed by the former calendar window.
            "2023-08-25T14:59:59Z",
            "2023-09-02T00:00:00Z", // The cutoff itself is included.
            "2023-09-02T00:00:01Z",
            "2023-09-01T00:00:00Z");
    for (int i = 0; i < timestamps.size(); i++)
      jdbc.update(
          "update ledger.transactions set occurred_at=?::timestamptz where tx_id=?",
          timestamps.get(i),
          ids.get(i + 1));
    jdbc.update("delete from ledger.transaction_reports where tx_id=?", ids.get(5));
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(1), ids.get(2), ids.get(3));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=? and tx_id=?",
                Integer.class,
                run,
                ids.getFirst()))
        .isEqualTo(1);
  }

  @Test
  void context_includes_history_between_distant_target_days_for_flow_matching() {
    seed(6);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id>" + ids.get(1));
    var timestamps =
        List.of(
            "2023-08-01T00:00:00Z",
            "2023-09-01T00:00:00Z",
            "2023-08-07T14:59:59Z",
            "2023-08-07T15:00:00Z",
            "2023-08-15T00:00:00Z",
            "2023-08-25T15:00:00Z");
    for (int i = 0; i < timestamps.size(); i++)
      jdbc.update(
          "update ledger.transactions set occurred_at=?::timestamptz where tx_id=?",
          timestamps.get(i),
          ids.get(i));
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(2), ids.get(3), ids.get(4), ids.get(5));
  }

  @Test
  void context_rejects_a_transaction_with_both_before_and_after_cutoff_current_reports() {
    seed(2);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id=" + ids.get(1));
    long upload =
        jdbc.queryForObject(
            "insert into ingest.uploads(file_name,file_hash,size_bytes,status,bank_id,business_date) values('later.csv',repeat('b',64),1,'COMPLETED',12,'2023-09-02') returning upload_id",
            Long.class);
    long laterSet =
        jdbc.queryForObject(
            "insert into ingest.report_sets(bank_id,business_date) values(12,'2023-09-02') returning set_id",
            Long.class);
    long laterVersion =
        jdbc.queryForObject(
            "insert into ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count) values(?,?,1,?,'ACTIVE',1) returning version_id",
            Long.class,
            laterSet,
            upload,
            Timestamp.from(cutoff.plusSeconds(1)));
    jdbc.update(
        "update ingest.report_sets set current_version_id=? where set_id=?",
        laterVersion,
        laterSet);
    long report =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status) values(?,1,'later','cipher','test','ACTIVE') returning report_id",
            Long.class,
            laterVersion);
    jdbc.update(
        "insert into ledger.transaction_reports values(?,?,'INTERNAL')", ids.get(1), report);
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=? and input_role='CONTEXT'",
                Integer.class,
                run))
        .isZero();
  }

  @Test
  void freezes_one_hundred_thousand_context_rows_without_expanding_target_count() {
    seed(100_001);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id<>(select min(tx_id) from ledger.transactions)");
    long start = System.nanoTime();
    UUID run = runs.freeze(job, cutoff);
    System.out.printf(
        "FREEZE_INPUT_BENCH contexts=100000 elapsedMs=%d%n",
        Duration.ofNanos(System.nanoTime() - start).toMillis());
    assertThat(
            jdbc.queryForObject(
                "select row_count from analysis.jobs where job_id=?", Integer.class, job))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=? and input_role='CONTEXT'",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*)||'/'||(select count(*) from analysis.input_report_sets where run_id=?) from analysis.input_reports where run_id=?",
                String.class,
                run,
                run))
        .isEqualTo("1/1");
  }

  @Test
  void split_stays_exact_when_statistics_know_only_an_earlier_run() {
    seed(40_000);
    long scored =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,analysis_date,analysis_cutoff_at,status,current_stage) values(now(),0.7,'2023-09-01',now(),'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    completed(scored, "t.tx_id<(select min(tx_id)+20000 from ledger.transactions)");
    // As after the previous day's analysis, the planner knows only the completed run.
    jdbc.execute("analyze analysis.input_transactions");
    long start = System.nanoTime();
    UUID run = runs.freeze(job, cutoff);
    System.out.printf(
        "FREEZE_INPUT_BENCH unseenRun targets=20000 contexts=20000 elapsedMs=%d%n",
        Duration.ofNanos(System.nanoTime() - start).toMillis());
    assertThat(
            jdbc.queryForObject(
                "select count(*) filter(where input_role='TARGET')||'/'||count(*) filter(where input_role='CONTEXT') from analysis.run_inputs where run_id=?",
                String.class,
                run))
        .isEqualTo("20000/20000");
    assertThat(
            jdbc.queryForObject(
                "select count(*)||'/'||(select count(*) from analysis.input_report_sets where run_id=?) from analysis.input_reports where run_id=?",
                String.class,
                run,
                run))
        .isEqualTo("20000/1");
  }

  static final String INPUT_COLUMNS =
      "tx_id,occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version";

  /** The former per-run CONTEXT copy, recomputed now: eligible ledger minus the run's TARGET. */
  void assertContextMatchesFullCopy(UUID run, Instant at) {
    String oracle =
        """
        select t.tx_id,t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,
          e.service_owner_id,f.service_owner_id,t.amount_received,t.receiving_currency::text,t.amount_paid,
          t.payment_currency::text,t.payment_format::text,t.amount_usd,t.fx_rate_version::text
        from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id
        join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id
        where t.tx_id in(select t.tx_id from ledger.transactions t
          join ledger.transaction_reports tr using(tx_id) join private.bank_reports br using(report_id)
          join ingest.report_sets rs on rs.current_version_id=br.version_id join ingest.report_versions rv using(version_id)
          where t.integration_status='ACTIVE' and t.occurred_at<=:at group by t.tx_id
          having bool_or(rv.received_at<=:at) and not bool_or(rv.received_at>:at))
        and t.tx_id not in(select tx_id from analysis.input_transactions where run_id=:run)
        """;
    String frozen =
        "select "
            + INPUT_COLUMNS
            + " from analysis.run_inputs where run_id=:run and input_role='CONTEXT'";
    var params =
        new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
            .addValue("at", Timestamp.from(at))
            .addValue("run", run);
    var named = new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc);
    assertThat(
            named.queryForObject(
                "select count(*) from ((" + oracle + ") except all (" + frozen + ")) x",
                params,
                Integer.class))
        .isZero();
    assertThat(
            named.queryForObject(
                "select count(*) from ((" + frozen + ") except all (" + oracle + ")) x",
                params,
                Integer.class))
        .isZero();
  }

  long nextJob(Instant at) {
    long next =
        jdbc.queryForObject(
            "insert into analysis.jobs(business_at,threshold_value,status,current_stage,analysis_date,analysis_cutoff_at) values(now(),0.7,'RUNNING','FREEZE_INPUT',date '2100-01-01'+nextval('core.work_id')::int,?) returning job_id",
            Long.class,
            Timestamp.from(at));
    jdbc.update("insert into analysis.selected_versions values(?,?,?,1)", next, set, version);
    return next;
  }

  void addTransactions(int count) {
    jdbc.update(
        """
        insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,
          amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)
        select '2023-09-01 12:00+09'::timestamptz,?,?,n,'USD',n,'USD','ACH',n,'test','2023-09-01'
        from generate_series(1,?) n
        """,
        account,
        account,
        count);
    jdbc.update(
        """
        insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status)
        select ?,(select max(source_row) from private.bank_reports)+row_number() over(order by tx_id),
          tx_id::text,'cipher','test','ACTIVE'
        from ledger.transactions where tx_id not in(select tx_id from ledger.transaction_reports)
        """,
        version);
    jdbc.update(
        """
        insert into ledger.transaction_reports select t.tx_id,br.report_id,'INTERNAL'
        from ledger.transactions t join private.bank_reports br on br.match_key=t.tx_id::text
        where t.tx_id not in(select tx_id from ledger.transaction_reports)
        """);
  }

  void finish(UUID run) {
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE' where current_run_id=?",
        run);
  }

  @Test
  void shared_ledger_reproduces_each_runs_full_context_copy_across_days() {
    seed(6);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    UUID first = runs.freeze(job, cutoff);
    assertContextMatchesFullCopy(first, cutoff);
    finish(first);
    var firstInput =
        jdbc.queryForList(
            "select " + INPUT_COLUMNS + ",input_role from analysis.run_inputs where run_id=?",
            first);
    // New rows, a superseded row, a row whose frozen value changed and one moved past the cutoff.
    addTransactions(3);
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", ids.get(0));
    jdbc.update("update ledger.transactions set amount_usd=amount_usd+1 where tx_id=?", ids.get(1));
    Instant later = cutoff.plus(Duration.ofDays(1));
    jdbc.update(
        "update ledger.transactions set occurred_at=? where tx_id=?",
        Timestamp.from(later.minusSeconds(60)),
        ids.get(2));
    UUID second = runs.freeze(nextJob(later), later);
    assertContextMatchesFullCopy(second, later);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=? and input_role='CONTEXT'",
                Integer.class,
                second))
        .isEqualTo(5);
    finish(second);
    var secondInput =
        jdbc.queryForList(
            "select " + INPUT_COLUMNS + ",input_role from analysis.run_inputs where run_id=?",
            second);
    // An earlier cutoff after a later one, as when a failed earlier date is resumed.
    UUID third = runs.freeze(nextJob(cutoff), cutoff);
    assertContextMatchesFullCopy(third, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? order by tx_id",
                Long.class,
                third))
        .doesNotContain(ids.get(0), ids.get(2));
    // Earlier runs keep exactly what they froze.
    assertThat(
            jdbc.queryForList(
                "select " + INPUT_COLUMNS + ",input_role from analysis.run_inputs where run_id=?",
                first))
        .containsExactlyInAnyOrderElementsOf(firstInput);
    assertThat(
            jdbc.queryForList(
                "select " + INPUT_COLUMNS + ",input_role from analysis.run_inputs where run_id=?",
                second))
        .containsExactlyInAnyOrderElementsOf(secondInput);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where input_role='CONTEXT'",
                Integer.class))
        .isZero();
  }

  void assertSameRows(String expected, String frozen, UUID run) {
    var named = new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc);
    var params =
        new org.springframework.jdbc.core.namedparam.MapSqlParameterSource().addValue("run", run);
    for (String sql :
        List.of(
            "select count(*) from ((" + expected + ") except all (" + frozen + ")) x",
            "select count(*) from ((" + frozen + ") except all (" + expected + ")) x"))
      assertThat(named.queryForObject(sql, params, Integer.class)).as(sql).isZero();
  }

  /** The former per-run score, Alert origin and fact copies, recomputed now for this run. */
  void assertSnapshotsMatchFormerCopies(UUID run) {
    assertSameRows(
        """
        select c.tx_id,s.run_id,to_jsonb(s)-'run_id'-'tx_id' from analysis.current_scores c
        join analysis.scores s on s.run_id=c.run_id and s.tx_id=c.tx_id
        join analysis.runs r on r.run_id=c.run_id join analysis.jobs b on b.job_id=r.job_id
        where r.status='COMPLETED' and b.status='COMPLETED'
          and c.tx_id in(select tx_id from analysis.run_inputs where run_id=:run)
        """,
        "select tx_id,score_run_id,scores from analysis.run_scores where run_id=:run",
        run);
    assertSameRows(
        "select tx_id,scores->'p_laundering' from analysis.run_scores where run_id=:run",
        "select tx_id,p_laundering from analysis.run_scores where run_id=:run",
        run);
    assertSameRows(
        "select alert_id,published_version from review.alerts where published_version is not null",
        "select alert_id,version from analysis.run_alert_origins where run_id=:run",
        run);
    assertSameRows(
        """
        select distinct t.tx_id,t.integration_status from review.alerts a
        join review.alert_transactions m on m.alert_id=a.alert_id and m.version=a.published_version
        join ledger.transactions t using(tx_id)
        """,
        "select tx_id,integration_status from analysis.run_fact_checks where run_id=:run",
        run);
  }

  List<Map<String, Object>> snapshots(UUID run) {
    return jdbc.queryForList(
        """
        select 's' kind,tx_id::text k,score_run_id::text v,scores::text extra from analysis.run_scores where run_id=?
        union all select 'o',alert_id::text,version::text,null from analysis.run_alert_origins where run_id=?
        union all select 'f',tx_id::text,integration_status,null from analysis.run_fact_checks where run_id=?
        """,
        run,
        run,
        run);
  }

  void score(UUID run, long tx) {
    jdbc.update(
        "insert into analysis.scores(run_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,score_pct,type_class) values(?,?,.5,1,0,0,0,0,0,0,0,0,12.5,0)",
        run,
        tx);
  }

  long publish(Long alert, int version, UUID run, long... members) {
    long user = jdbc.queryForObject("select min(user_id) from core.users", Long.class);
    long id =
        alert != null
            ? alert
            : jdbc.queryForObject(
                "insert into review.alerts(assignee_id,created_at,assigned_at) values(?,now(),now()) returning alert_id",
                Long.class,
                user);
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence) values(?,?,?,repeat('a',64),'{}')",
        id,
        version,
        run);
    for (long member : members)
      jdbc.update(
          "insert into review.alert_transactions values(?,?,?,'SEED','[]',null)",
          id,
          version,
          member);
    jdbc.update("update review.alerts set published_version=? where alert_id=?", version, id);
    return id;
  }

  @Test
  void frozen_scores_and_alert_facts_match_former_copies_and_stay_fixed_per_run() {
    seed(4);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    UUID first = runs.freeze(job, cutoff);
    for (long id : ids) score(first, id);
    runs.complete(first);
    finish(first);
    long alert = publish(null, 1, first, ids.get(0), ids.get(1));
    Instant later = cutoff.plus(Duration.ofDays(1));
    UUID second = runs.freeze(nextJob(later), later);
    assertSnapshotsMatchFormerCopies(second);
    var secondSnapshots = snapshots(second);
    assertThat(secondSnapshots).hasSize(4 + 1 + 2);
    // A superseded member, a new Alert version and Alert, and a replaced current score.
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", ids.get(1));
    publish(alert, 2, second, ids.get(1), ids.get(2));
    publish(null, 1, second, ids.get(3));
    long rescoreJob = nextJob(later);
    UUID rescore = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", rescore, rescoreJob);
    runs.snapshot(rescore, ids.get(0), "TARGET");
    score(rescore, ids.get(0));
    jdbc.update("update analysis.current_scores set run_id=? where tx_id=?", rescore, ids.get(0));
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", rescore);
    jdbc.update("update analysis.jobs set status='COMPLETED' where job_id=?", rescoreJob);
    Instant last = later.plus(Duration.ofDays(1));
    UUID third = runs.freeze(nextJob(last), last);
    assertSnapshotsMatchFormerCopies(third);
    assertThat(
            jdbc.queryForObject(
                "select (select integration_status from analysis.run_fact_checks where run_id=? and tx_id=?)||'/'||(select version from analysis.run_alert_origins where run_id=? and alert_id=?)||'/'||(select score_run_id from analysis.run_scores where run_id=? and tx_id=?)",
                String.class,
                third,
                ids.get(1),
                third,
                alert,
                third,
                ids.get(0)))
        .isEqualTo("SUPERSEDED/2/" + rescore);
    // The earlier run, whose proposals may be checked much later, keeps what it froze.
    assertThat(snapshots(second)).containsExactlyInAnyOrderElementsOf(secondSnapshots);
    assertThat(
            jdbc.queryForObject(
                "select (select count(*) from analysis.input_scores)+(select count(*) from analysis.alert_origins)+(select count(*) from analysis.alert_fact_checks)",
                Integer.class))
        .isZero();
  }

  @Test
  void snapshot_refuses_to_run_outside_a_transaction() {
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, job);
    assertThatThrownBy(() -> new AlertInputSnapshot(jdbc).freeze(run, cutoff))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("FREEZE_INPUT_REQUIRES_TRANSACTION");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.source_manifest where run_id=?", Integer.class, run))
        .isZero();
  }

  @Test
  void failure_after_target_insert_rolls_back_and_same_job_can_retry() {
    seed(2);
    jdbc.execute(
        "alter table analysis.input_reports add constraint freeze_test_reject check(false) not valid");
    try {
      assertThatThrownBy(() -> runs.freeze(job, cutoff))
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions", Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.runs where job_id=?", Integer.class, job))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select current_run_id from analysis.jobs where job_id=?", UUID.class, job))
          .isNull();
      assertThat(jdbc.queryForObject("select count(*) from ledger.transactions", Integer.class))
          .isEqualTo(2);
    } finally {
      jdbc.execute("alter table analysis.input_reports drop constraint freeze_test_reject");
    }
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=?", Integer.class, run))
        .isEqualTo(2);
  }

  @Test
  void excludes_reports_received_after_cutoff() {
    seed(2);
    jdbc.update(
        "update ingest.report_versions set received_at=? where version_id=?",
        Timestamp.from(cutoff.plusSeconds(1)),
        version);
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForObject(
                "select row_count from analysis.jobs where job_id=?", Integer.class, job))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=?",
                Integer.class,
                run))
        .isZero();
  }

  @Test
  void revision_mismatch_rolls_back_without_publishing_partial_input() {
    seed(2);
    jdbc.update("update ingest.report_sets set generation=2 where set_id=?", set);
    assertThatThrownBy(() -> runs.freeze(job, cutoff))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("INPUT_REVISION_CHANGED");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.runs where job_id=?", Integer.class, job))
        .isZero();
    assertThat(
            jdbc.queryForObject("select count(*) from analysis.input_transactions", Integer.class))
        .isZero();
  }
}
