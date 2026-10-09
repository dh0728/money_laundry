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
                "select tx_id from analysis.input_transactions where run_id=? and input_role='CONTEXT' order by tx_id",
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
                "select tx_id from analysis.input_transactions where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(1), ids.get(2), ids.get(3));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and tx_id=?",
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
                "select tx_id from analysis.input_transactions where run_id=? and input_role='CONTEXT' order by tx_id",
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
                "select count(*) from analysis.input_transactions where run_id=? and input_role='CONTEXT'",
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
                "select count(*) from analysis.input_transactions where run_id=? and input_role='CONTEXT'",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_reports where run_id=?", Integer.class, run))
        .isEqualTo(100_001);
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
                "select count(*) from analysis.input_transactions where run_id=?",
                Integer.class,
                run))
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
