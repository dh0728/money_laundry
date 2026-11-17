package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.freeze.AlertInputSnapshot;
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
        with numbered as (select tx_id,row_number() over(order by tx_id) n from ledger.transactions),
        added as (insert into private.bank_reports(version_id,source_row,report_status)
          select ?,n,'ACTIVE' from numbered returning report_id,source_row)
        insert into ledger.transaction_reports select t.tx_id,a.report_id,'INTERNAL'
        from numbered t join added a on a.source_row=t.n
        """,
        version);
    jdbc.execute("analyze ledger.transactions");
    jdbc.execute("analyze private.bank_reports");
    jdbc.execute("analyze ledger.transaction_reports");
  }

  @Test
  void freezes_one_hundred_thousand_targets_with_report_sets_and_is_idempotent() {
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
                "select count(*) from analysis.input_report_sets where run_id=?",
                Integer.class,
                run))
        .isEqualTo(1);
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
            "insert into private.bank_reports(version_id,source_row,report_status) values(?,1,'ACTIVE') returning report_id",
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
                "select count(*) from analysis.input_report_sets where run_id=?",
                Integer.class,
                run))
        .isEqualTo(1);
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
                "select count(*) from analysis.input_report_sets where run_id=?",
                Integer.class,
                run))
        .isEqualTo(1);
  }

  static final String INPUT_COLUMNS =
      "tx_id,occurred_at,business_date,from_bank_id,to_bank_id,from_account_id,to_account_id,from_owner_id,to_owner_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version";

  /** The run's expected CONTEXT, recomputed now: eligible ledger minus the run's TARGET. */
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
        with numbered as (
          select tx_id,(select max(source_row) from private.bank_reports)+row_number() over(order by tx_id) n
          from ledger.transactions where tx_id not in(select tx_id from ledger.transaction_reports)),
        added as (insert into private.bank_reports(version_id,source_row,report_status)
          select ?,n,'ACTIVE' from numbered returning report_id,source_row)
        insert into ledger.transaction_reports select t.tx_id,a.report_id,'INTERNAL'
        from numbered t join added a on a.source_row=t.n
        """,
        version);
    revise(version);
  }

  /**
   * Integration bumps a version's revision whenever it changes the version's transactions, links or
   * their status; FREEZE_INPUT re-evaluates what such a bump marks. Fixtures that edit those rows
   * directly bump it the same way.
   */
  void revise(long changedVersion) {
    jdbc.update(
        "update ingest.report_versions set revision=revision+1 where version_id=?", changedVersion);
  }

  void finish(UUID run) {
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE' where current_run_id=?",
        run);
  }

  @Autowired AnalysisService analysis;

  @Test
  void backfill_job_completes_after_freeze_and_its_transactions_stay_unscored_history() {
    seed(3);
    var backfilled =
        jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    jdbc.update(
        "update analysis.jobs set status='QUEUED',completion_reason='BACKFILL' where job_id=?",
        job);
    var runner =
        new AnalysisRunner(
            analysis,
            c -> {
              throw new AssertionError("a backfill job runs no model or Alert stage");
            },
            runs);
    try {
      runner.scan();
    } finally {
      runner.close();
    }
    var done =
        jdbc.queryForMap(
            "select status,current_stage,completion_reason,row_count,suspicious_tx_count,alert_count from analysis.jobs where job_id=?",
            job);
    assertThat(done)
        .containsEntry("status", "COMPLETED")
        .containsEntry("current_stage", "COMPLETE")
        .containsEntry("completion_reason", "BACKFILL")
        .containsEntry("row_count", 3)
        .containsEntry("alert_count", 0);
    assertThat(jdbc.queryForObject("select count(*) from analysis.scores", Integer.class)).isZero();
    assertThat(jdbc.queryForObject("select count(*) from analysis.current_scores", Integer.class))
        .isZero();
    // The next analysis scores only new transactions and reads the backfilled ones as history.
    addTransactions(2);
    Instant later = cutoff.plus(Duration.ofDays(1));
    UUID next = runs.freeze(nextJob(later), later);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? and input_role='TARGET'",
                Long.class,
                next))
        .hasSize(2)
        .doesNotContainAnyElementsOf(backfilled);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.run_inputs where run_id=? and input_role='CONTEXT'",
                Long.class,
                next))
        .containsExactlyInAnyOrderElementsOf(backfilled);
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
    revise(version);
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

  /** Completed scores, published Alerts and member states as they stand now, at this freeze. */
  void assertSnapshotsMatchStateAtFreeze(UUID run) {
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
  void frozen_scores_and_alert_facts_match_state_at_freeze_and_stay_fixed_per_run() {
    seed(4);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    UUID first = runs.freeze(job, cutoff);
    for (long id : ids) score(first, id);
    runs.complete(first);
    finish(first);
    long alert = publish(null, 1, first, ids.get(0), ids.get(1));
    Instant later = cutoff.plus(Duration.ofDays(1));
    UUID second = runs.freeze(nextJob(later), later);
    assertSnapshotsMatchStateAtFreeze(second);
    var secondSnapshots = snapshots(second);
    assertThat(secondSnapshots).hasSize(4 + 1 + 2);
    // A superseded member, a new Alert version and Alert, and a replaced current score.
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", ids.get(1));
    revise(version);
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
    assertSnapshotsMatchStateAtFreeze(third);
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
  }

  @Autowired org.springframework.transaction.support.TransactionTemplate transactions;

  @Test
  void rejects_a_frozen_target_outside_the_eligible_set_that_already_has_a_completed_score() {
    seed(2);
    var ids = jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    UUID first = runs.freeze(job, cutoff);
    for (long id : ids) score(first, id);
    runs.complete(first);
    finish(first);
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?", ids.get(0));
    revise(version);
    Instant later = cutoff.plus(Duration.ofDays(1));
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, nextJob(later));
    runs.snapshot(run, ids.get(0), "TARGET");
    assertThatThrownBy(
            () ->
                transactions.executeWithoutResult(
                    s -> new AlertInputSnapshot(jdbc).freeze(run, later)))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("FROZEN_TARGET_ALREADY_SCORED");
  }

  long upload(int bank, String day, Instant received) {
    jdbc.update("insert into core.banks(bank_id) values(?) on conflict do nothing", bank);
    return jdbc.queryForObject(
        """
        insert into ingest.uploads(file_name,file_hash,size_bytes,status,bank_id,business_date,received_at)
        values('fixture.csv',md5(random()::text)||md5(random()::text),1,'COMPLETED',?,?::date,?) returning upload_id
        """,
        Long.class,
        bank,
        day,
        Timestamp.from(received));
  }

  /** A report set with one current version received at the given time. */
  long[] reportSet(int bank, String day, Instant received) {
    long upload = upload(bank, day, received);
    long newSet =
        jdbc.queryForObject(
            "insert into ingest.report_sets(bank_id,business_date) values(?,?::date) returning set_id",
            Long.class,
            bank,
            day);
    long newVersion = reportVersion(newSet, upload, 1, received);
    jdbc.update(
        "update ingest.report_sets set current_version_id=?,generation=1 where set_id=?",
        newVersion,
        newSet);
    return new long[] {newSet, newVersion};
  }

  long reportVersion(long ofSet, long upload, int number, Instant received) {
    return jdbc.queryForObject(
        """
        insert into ingest.report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count)
        values(?,?,?,?,'ACTIVE',0) returning version_id
        """,
        Long.class,
        ofSet,
        upload,
        number,
        Timestamp.from(received));
  }

  /** New transactions reported through a version, the way integration leaves them. */
  List<Long> reported(long throughVersion, String day, Instant occurred, int count) {
    var ids =
        jdbc.queryForList(
            """
        insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,
          amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)
        select ?,?,?,n,'USD',n,'USD','ACH',n,'test',?::date from generate_series(1,?) n returning tx_id
        """,
            Long.class,
            Timestamp.from(occurred),
            account,
            account,
            day,
            count);
    for (long id : ids) link(id, throughVersion);
    return ids;
  }

  void link(long tx, long throughVersion) {
    jdbc.update(
        """
        with added as (insert into private.bank_reports(version_id,source_row,report_status)
          select ?,coalesce(max(source_row),0)+1,'ACTIVE' from private.bank_reports returning report_id)
        insert into ledger.transaction_reports select ?,report_id,'INTERNAL' from added
        """,
        throughVersion,
        tx);
    revise(throughVersion);
  }

  /** Freezes a run without TARGET rows, so the ledgers alone are under test. */
  UUID freezeLedgers(Instant at, Set<Long> blocked) {
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, nextJob(at));
    transactions.executeWithoutResult(s -> new AlertInputSnapshot(jdbc).freeze(run, at, blocked));
    return run;
  }

  /** A completed run of a completed job holding the current score of these transactions. */
  UUID scored(List<Long> ids) {
    long scoringJob = nextJob(cutoff);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, scoringJob);
    for (long id : ids) {
      runs.snapshot(run, id, "TARGET");
      score(run, id);
      jdbc.update(
          "insert into analysis.current_scores values(?,?) on conflict(tx_id) do update set run_id=excluded.run_id",
          id,
          run);
    }
    jdbc.update("update analysis.jobs set status='COMPLETED' where job_id=?", scoringJob);
    return run;
  }

  /**
   * Everything the freeze derives from the eligible set, compared with evaluating every transaction
   * from scratch: the open input ledger, the run's report sets, its first coverage date and the
   * open score ledger.
   */
  void assertLedgersMatchFullEvaluation(UUID run, Instant at, Set<Long> blocked) {
    String eligible =
        """
        select t.tx_id from ledger.transactions t
        join ledger.transaction_reports tr using(tx_id) join private.bank_reports br using(report_id)
        join ingest.report_sets rs on rs.current_version_id=br.version_id join ingest.report_versions rv using(version_id)
        where t.integration_status='ACTIVE' and t.occurred_at<=:at
          and not exists(select 1 from ledger.transaction_reports btr join private.bank_reports bbr using(report_id)
            join ingest.report_versions bv using(version_id) where btr.tx_id=t.tx_id and bv.set_id=any(:blocked::bigint[]))
        group by t.tx_id having bool_or(rv.received_at<=:at) and not bool_or(rv.received_at>:at)
        """;
    var named = new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(jdbc);
    var params =
        new org.springframework.jdbc.core.namedparam.MapSqlParameterSource()
            .addValue("at", Timestamp.from(at))
            .addValue("run", run)
            .addValue(
                "blocked",
                blocked.stream()
                    .map(String::valueOf)
                    .collect(java.util.stream.Collectors.joining(",", "{", "}")));
    var pairs =
        List.of(
            List.of(
                """
                select t.tx_id,t.occurred_at,t.business_date,a.bank_id,b.bank_id,a.service_account_id,b.service_account_id,
                  e.service_owner_id,f.service_owner_id,t.amount_received,t.receiving_currency::text,t.amount_paid,
                  t.payment_currency::text,t.payment_format::text,t.amount_usd,t.fx_rate_version::text
                from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
                join core.accounts b on b.account_id=t.to_account_id
                join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id
                where t.tx_id in(%s)
                """
                    .formatted(eligible),
                "select "
                    + INPUT_COLUMNS
                    + " from analysis.input_ledger where valid_to_seq is null"),
            List.of(
                """
                select distinct s.set_id from (%s) i join ledger.transaction_reports tr using(tx_id)
                join private.bank_reports br using(report_id) join ingest.report_sets s on s.current_version_id=br.version_id
                """
                    .formatted(eligible),
                "select set_id from analysis.input_report_sets where run_id=:run"),
            List.of(
                "select min(t.business_date)-3 from ledger.transactions t where t.tx_id in(%s) having count(*)>0"
                    .formatted(eligible),
                "select min(business_date) from analysis.input_coverage where run_id=:run having count(*)>0"),
            List.of(
                """
                select c.tx_id,c.run_id from analysis.current_scores c
                join analysis.runs r on r.run_id=c.run_id join analysis.jobs b on b.job_id=r.job_id
                where r.status='COMPLETED' and b.status='COMPLETED' and c.tx_id in(%s)
                """
                    .formatted(eligible),
                "select tx_id,score_run_id from analysis.score_ledger where valid_to_seq is null"));
    for (var pair : pairs)
      for (String sql :
          List.of(
              "select count(*) from ((" + pair.get(0) + ") except all (" + pair.get(1) + ")) x",
              "select count(*) from ((" + pair.get(1) + ") except all (" + pair.get(0) + ")) x"))
        assertThat(named.queryForObject(sql, params, Integer.class)).as(sql).isZero();
  }

  int openInputs() {
    return jdbc.queryForObject(
        "select count(*) from analysis.input_ledger where valid_to_seq is null", Integer.class);
  }

  @Test
  void re_evaluating_only_changed_report_sets_matches_evaluating_every_transaction() {
    seed(4);
    var first =
        jdbc.queryForList("select tx_id from ledger.transactions order by tx_id", Long.class);
    Instant day2 = cutoff.plus(Duration.ofDays(1)), day3 = cutoff.plus(Duration.ofDays(2));
    // Timed after the first cutoff: eligible later although its report set stays as it is.
    long future = reported(version, "2023-09-01", cutoff.plusSeconds(1800), 1).getFirst();
    assertLedgersMatchFullEvaluation(freezeLedgers(cutoff, Set.of()), cutoff, Set.of());
    assertThat(openInputs()).isEqualTo(4);

    // A new day's set, a set received only after the cutoff, and a transaction two banks report.
    long[] own = reportSet(12, "2023-09-02", cutoff.plusSeconds(3600));
    long[] other = reportSet(13, "2023-09-02", cutoff.plusSeconds(3600));
    long[] late = reportSet(13, "2023-09-03", day2.plusSeconds(3600));
    var second = reported(own[1], "2023-09-02", cutoff.plusSeconds(60), 3);
    link(second.get(0), other[1]);
    var waiting = reported(late[1], "2023-09-03", cutoff.plusSeconds(120), 2);
    link(second.get(1), late[1]);
    // Dated after the cutoff's day, so the source manifest of neither run lists it.
    long[] ahead = reportSet(12, "2023-09-10", cutoff.plusSeconds(3600));
    reported(ahead[1], "2023-09-10", cutoff.plusSeconds(60), 1);
    UUID scoring = scored(List.of(first.get(0), second.get(2), waiting.get(0)));
    assertLedgersMatchFullEvaluation(freezeLedgers(day2, Set.of()), day2, Set.of());
    assertThat(openInputs()).isEqualTo(4 + 1 + 2 + 1);

    // Nothing changed: no version is opened or closed.
    long versions = jdbc.queryForObject("select count(*) from analysis.input_ledger", Long.class);
    assertLedgersMatchFullEvaluation(freezeLedgers(day2, Set.of()), day2, Set.of());
    assertThat(jdbc.queryForObject("select count(*) from analysis.input_ledger", Long.class))
        .isEqualTo(versions);

    // A still-late set changes its current version and no longer reports the two-bank transaction,
    // and the set dated ahead reports one more.
    reported(ahead[1], "2023-09-10", cutoff.plusSeconds(60), 1);
    long relate = reportVersion(late[0], upload(13, "2023-09-03", day2), 2, day2.plusSeconds(7200));
    for (long id : waiting) link(id, relate);
    jdbc.update(
        "update ingest.report_sets set current_version_id=?,generation=generation+1 where set_id=?",
        relate,
        late[0]);
    assertLedgersMatchFullEvaluation(freezeLedgers(day2, Set.of()), day2, Set.of());
    assertThat(openInputs()).isEqualTo(4 + 1 + 3 + 2);

    // The late set is in, a blocked set takes its transactions out, and the scoring job reopens.
    jdbc.update(
        "update analysis.jobs set status='RUNNING' where job_id=(select job_id from analysis.runs where run_id=?)",
        scoring);
    assertLedgersMatchFullEvaluation(freezeLedgers(day3, Set.of(other[0])), day3, Set.of(other[0]));
    assertThat(openInputs()).isEqualTo(4 + 1 + 3 + 2 + 2 - 1);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED' where job_id=(select job_id from analysis.runs where run_id=?)",
        scoring);

    // The block is lifted, and a replacement version supersedes one transaction and adds another.
    long replacement =
        reportVersion(set, upload(12, "2023-09-01", day2.plusSeconds(60)), 2, day2.plusSeconds(60));
    jdbc.update(
        "update ledger.transactions set integration_status='SUPERSEDED' where tx_id=?",
        first.get(1));
    for (long kept : List.of(first.get(0), first.get(2), first.get(3), future))
      link(kept, replacement);
    reported(replacement, "2023-09-01", cutoff.minusSeconds(3600), 1);
    jdbc.update(
        "update ingest.report_versions set stage_status='SUPERSEDED',revision=revision+1 where version_id=?",
        version);
    jdbc.update(
        "update ingest.report_sets set current_version_id=?,generation=generation+1 where set_id=?",
        replacement,
        set);
    assertLedgersMatchFullEvaluation(freezeLedgers(day3, Set.of()), day3, Set.of());
    assertThat(openInputs()).isEqualTo(4 + 1 + 3 + 2 + 2);

    // An earlier cutoff after a later one: the replacement and the late set are not received yet.
    assertLedgersMatchFullEvaluation(freezeLedgers(cutoff, Set.of()), cutoff, Set.of());
    assertThat(openInputs()).isZero();
    assertLedgersMatchFullEvaluation(freezeLedgers(day3, Set.of()), day3, Set.of());
    assertThat(openInputs()).isEqualTo(4 + 1 + 3 + 2 + 2);
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
        "alter table analysis.input_report_sets add constraint freeze_test_reject check(false) not valid");
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
      jdbc.execute("alter table analysis.input_report_sets drop constraint freeze_test_reject");
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
