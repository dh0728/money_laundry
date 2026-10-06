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
    jdbc.execute("truncate banks,batch_jobs,private.entities,reporting_scopes cascade");
    jdbc.update("insert into banks(bank_id) values(12)");
    long entity =
        jdbc.queryForObject(
            """
        insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version)
        values(?,'test','test','test','test') returning entity_id
        """,
            Long.class,
            UUID.randomUUID());
    account =
        jdbc.queryForObject(
            """
        insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version)
        values(12,?,'test',?,'test','test') returning account_id
        """,
            Long.class,
            UUID.randomUUID(),
            entity);
    job =
        jdbc.queryForObject(
            """
        insert into batch_jobs(job_type,status,current_stage,analysis_date,analysis_cutoff_at)
        values('ANALYSIS','RUNNING','FREEZE_INPUT','2023-09-02',?) returning job_id
        """,
            Long.class,
            Timestamp.from(cutoff));
    long upload =
        jdbc.queryForObject(
            """
        insert into batch_jobs(job_type,status,bank_id,business_date,received_at)
        values('INGEST','COMPLETED',12,'2023-09-01','2023-09-01 18:00+09') returning job_id
        """,
            Long.class);
    set =
        jdbc.queryForObject(
            "insert into report_sets(bank_id,business_date) values(12,'2023-09-01') returning set_id",
            Long.class);
    version =
        jdbc.queryForObject(
            """
        insert into report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count)
        values(?,?,1,'2023-09-01 18:00+09','ACTIVE',0) returning version_id
        """,
            Long.class,
            set,
            upload);
    jdbc.update(
        "update report_sets set current_version_id=?,generation=1 where set_id=?", version, set);
    jdbc.update("insert into analysis_selected_versions values(?,?,?,1)", job, set, version);
    jdbc.update("insert into analysis_receipts values(?,?)", job, upload);
    jdbc.update("insert into reporting_scopes(business_date) values('2023-09-01')");
    jdbc.update("insert into reporting_scope_banks values('2023-09-01',1,12)");
  }

  void seed(int count) {
    jdbc.update(
        """
        insert into transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,
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
        select ?,row_number() over(order by tx_id),tx_id::text,'cipher','test','ACTIVE' from transactions
        """,
        version);
    jdbc.update(
        """
        insert into transaction_reports select t.tx_id,br.report_id,'INTERNAL'
        from transactions t join private.bank_reports br on br.match_key=t.tx_id::text
        """);
    jdbc.execute("analyze transactions");
    jdbc.execute("analyze private.bank_reports");
    jdbc.execute("analyze transaction_reports");
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
                "select row_count from batch_jobs where job_id=?", Integer.class, job))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and input_role='TARGET'",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_input_reports where run_id=?", Integer.class, run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_target_ownership where run_id=?",
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
                "select count(*) from analysis_runs where job_id=?", Integer.class, job))
        .isEqualTo(1);
  }

  @Test
  void preserves_eligibility_and_freezes_scored_or_owned_transactions_only_as_context() {
    seed(5);
    var ids = jdbc.queryForList("select tx_id from transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','COMPLETED') returning job_id",
            Long.class);
    jdbc.update("update transactions set scored_job_id=? where tx_id=?", scored, ids.get(1));
    UUID owner = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,status) values(?,?,'ACTIVE')", owner, scored);
    jdbc.update("insert into analysis_target_ownership values(?,?)", ids.get(2), owner);
    jdbc.update("update transactions set integration_status='HELD' where tx_id=?", ids.get(3));
    jdbc.update("delete from transaction_reports where tx_id=?", ids.get(4));
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
                "select run_id from analysis_target_ownership where tx_id=?",
                UUID.class,
                ids.get(2)))
        .isEqualTo(owner);
  }

  @Test
  void context_keeps_calendar_and_cutoff_boundaries_without_duplicate_targets() {
    seed(6);
    var ids = jdbc.queryForList("select tx_id from transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','COMPLETED') returning job_id",
            Long.class);
    jdbc.update("update transactions set scored_job_id=? where tx_id<>?", scored, ids.getFirst());
    var timestamps =
        List.of(
            "2023-08-25T15:00:00Z", // Aug 26 KST: inclusive lower bound.
            "2023-08-25T14:59:59Z",
            "2023-09-02T00:00:00Z", // The cutoff itself is included.
            "2023-09-02T00:00:01Z",
            "2023-09-01T00:00:00Z");
    for (int i = 0; i < timestamps.size(); i++)
      jdbc.update(
          "update transactions set occurred_at=?::timestamptz where tx_id=?",
          timestamps.get(i),
          ids.get(i + 1));
    jdbc.update("delete from transaction_reports where tx_id=?", ids.get(5));
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.input_transactions where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(1), ids.get(3));
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and tx_id=?",
                Integer.class,
                run,
                ids.getFirst()))
        .isEqualTo(1);
  }

  @Test
  void context_does_not_fill_the_gap_between_distant_target_days() {
    seed(6);
    var ids = jdbc.queryForList("select tx_id from transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','COMPLETED') returning job_id",
            Long.class);
    jdbc.update("update transactions set scored_job_id=? where tx_id>?", scored, ids.get(1));
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
          "update transactions set occurred_at=?::timestamptz where tx_id=?",
          timestamps.get(i),
          ids.get(i));
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.input_transactions where run_id=? and input_role='CONTEXT' order by tx_id",
                Long.class,
                run))
        .containsExactly(ids.get(2), ids.get(5));
  }

  @Test
  void context_rejects_a_transaction_with_both_before_and_after_cutoff_current_reports() {
    seed(2);
    var ids = jdbc.queryForList("select tx_id from transactions order by tx_id", Long.class);
    long scored =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('ANALYSIS','COMPLETED') returning job_id",
            Long.class);
    jdbc.update("update transactions set scored_job_id=? where tx_id=?", scored, ids.get(1));
    long upload =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('INGEST','COMPLETED') returning job_id",
            Long.class);
    long laterSet =
        jdbc.queryForObject(
            "insert into report_sets(bank_id,business_date) values(12,'2023-09-02') returning set_id",
            Long.class);
    long laterVersion =
        jdbc.queryForObject(
            "insert into report_versions(set_id,upload_id,version_no,received_at,stage_status,row_count) values(?,?,1,?,'ACTIVE',1) returning version_id",
            Long.class,
            laterSet,
            upload,
            Timestamp.from(cutoff.plusSeconds(1)));
    jdbc.update(
        "update report_sets set current_version_id=? where set_id=?", laterVersion, laterSet);
    long report =
        jdbc.queryForObject(
            "insert into private.bank_reports(version_id,source_row,match_key,payload_cipher,key_version,report_status) values(?,1,'later','cipher','test','ACTIVE') returning report_id",
            Long.class,
            laterVersion);
    jdbc.update("insert into transaction_reports values(?,?,'INTERNAL')", ids.get(1), report);
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
            "insert into batch_jobs(job_type,status) values('ANALYSIS','COMPLETED') returning job_id",
            Long.class);
    jdbc.update(
        "update transactions set scored_job_id=? where tx_id<>(select min(tx_id) from transactions)",
        scored);
    long start = System.nanoTime();
    UUID run = runs.freeze(job, cutoff);
    System.out.printf(
        "FREEZE_INPUT_BENCH contexts=100000 elapsedMs=%d%n",
        Duration.ofNanos(System.nanoTime() - start).toMillis());
    assertThat(
            jdbc.queryForObject(
                "select row_count from batch_jobs where job_id=?", Integer.class, job))
        .isEqualTo(1);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.input_transactions where run_id=? and input_role='CONTEXT'",
                Integer.class,
                run))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_input_reports where run_id=?", Integer.class, run))
        .isEqualTo(100_001);
  }

  @Test
  void failure_after_target_insert_rolls_back_and_same_job_can_retry() {
    seed(2);
    jdbc.execute(
        "alter table analysis_input_reports add constraint freeze_test_reject check(false) not valid");
    try {
      assertThatThrownBy(() -> runs.freeze(job, cutoff))
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions", Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis_runs where job_id=?", Integer.class, job))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select current_run_id from batch_jobs where job_id=?", UUID.class, job))
          .isNull();
      assertThat(jdbc.queryForObject("select count(*) from transactions", Integer.class))
          .isEqualTo(2);
    } finally {
      jdbc.execute("alter table analysis_input_reports drop constraint freeze_test_reject");
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
        "update report_versions set received_at=? where version_id=?",
        Timestamp.from(cutoff.plusSeconds(1)),
        version);
    UUID run = runs.freeze(job, cutoff);
    assertThat(
            jdbc.queryForObject(
                "select row_count from batch_jobs where job_id=?", Integer.class, job))
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
    jdbc.update("update report_sets set generation=2 where set_id=?", set);
    assertThatThrownBy(() -> runs.freeze(job, cutoff))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("INPUT_REVISION_CHANGED");
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis_runs where job_id=?", Integer.class, job))
        .isZero();
    assertThat(
            jdbc.queryForObject("select count(*) from analysis.input_transactions", Integer.class))
        .isZero();
  }
}
