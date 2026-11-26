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

/** FREEZE_INPUT over loaded ledger files: eligibility, TARGET selection and incremental ledgers. */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FreezeInputTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired AnalysisRunService runs;
  @Autowired AnalysisService analysis;
  @Autowired org.springframework.transaction.support.TransactionTemplate transactions;
  @MockitoBean AnalysisScheduler scheduler;
  long job;
  long account;
  final Instant cutoff = Instant.parse("2023-09-02T00:00:00Z");

  @BeforeEach
  void setup() {
    jdbc.execute("truncate core.banks,analysis.jobs,core.owners,ingest.uploads cascade");
    jdbc.update("insert into core.banks(bank_id) values(12)");
    long entity =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(?,'가명#00001') returning owner_id",
            Long.class,
            UUID.randomUUID());
    account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,owner_id) values(12,?) returning account_id",
            Long.class,
            entity);
    job = nextJob(cutoff);
  }

  long nextJob(Instant at) {
    return jdbc.queryForObject(
        "insert into analysis.jobs(business_at,threshold_value,status,current_stage,analysis_date,analysis_cutoff_at) values(now(),0.7,'RUNNING','FREEZE_INPUT',date '2100-01-01'+nextval('core.work_id')::int,?) returning job_id",
        Long.class,
        Timestamp.from(at));
  }

  /** One loaded file per date, received at the given time; its transactions occur at noon KST. */
  long load(String day, Instant received, int count) {
    long upload =
        jdbc.queryForObject(
            """
            insert into ingest.uploads(file_name,file_hash,size_bytes,status,business_date,received_at,row_count)
            values('ledger.csv',repeat('a',64),1,'COMPLETED',?::date,?,?) returning upload_id
            """,
            Long.class,
            day,
            Timestamp.from(received),
            count);
    jdbc.update(
        """
        insert into ledger.transactions(upload_id,occurred_at,from_account_id,to_account_id,amount_received,
          receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date)
        select ?,(?::date+time '12:00')::timestamp at time zone 'Asia/Seoul',?,?,n,'USD',n,'USD','ACH',n,'test',?::date
        from generate_series(1,?) n
        """,
        upload,
        day,
        account,
        account,
        day,
        count);
    jdbc.execute("analyze ledger.transactions");
    return upload;
  }

  long load(String day, int count) {
    return load(day, Instant.parse(day + "T09:00:00Z"), count);
  }

  /** Registration fixes the job's receipts: every upload received by its cutoff. */
  void receive(long forJob, Instant at) {
    jdbc.update(
        "insert into analysis.receipts select ?,upload_id from ingest.uploads where received_at<=? on conflict do nothing",
        forJob,
        Timestamp.from(at));
  }

  UUID freeze(long forJob, Instant at) {
    receive(forJob, at);
    return runs.freeze(forJob, at);
  }

  List<Long> ids(String day) {
    return jdbc.queryForList(
        "select tx_id from ledger.transactions where business_date=?::date order by tx_id",
        Long.class,
        day);
  }

  List<Long> role(UUID run, String role) {
    return jdbc.queryForList(
        "select tx_id from analysis.run_inputs where run_id=? and input_role=? order by tx_id",
        Long.class,
        run,
        role);
  }

  void finish(UUID run) {
    jdbc.update("update analysis.runs set status='COMPLETED' where run_id=?", run);
    jdbc.update(
        "update analysis.jobs set status='COMPLETED',current_stage='COMPLETE' where current_run_id=?",
        run);
  }

  @Test
  void freezes_one_hundred_thousand_targets_with_their_file_and_is_idempotent() {
    long upload = load("2023-09-01", 100_000);
    long start = System.nanoTime();
    UUID run = freeze(job, cutoff);
    long millis = Duration.ofNanos(System.nanoTime() - start).toMillis();
    System.out.printf("FREEZE_INPUT_BENCH targets=100000 elapsedMs=%d%n", millis);
    assertThat(
            jdbc.queryForObject(
                "select row_count from analysis.jobs where job_id=?", Integer.class, job))
        .isEqualTo(100_000);
    assertThat(
            jdbc.queryForList(
                "select upload_id from analysis.source_manifest where run_id=?", Long.class, run))
        .containsExactly(upload);
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
    assertThat(freeze(job, cutoff)).isEqualTo(run);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.runs where job_id=?", Integer.class, job))
        .isEqualTo(1);
  }

  @Test
  void a_freeze_leaves_no_loaded_table_without_statistics() {
    load("2023-09-01", 5);
    freeze(job, cutoff);
    assertThat(
            jdbc.queryForList(
                """
                select oid::regclass::text from pg_class where reltuples<0 and oid in (
                  'ledger.transactions'::regclass,'core.accounts'::regclass,'core.owners'::regclass,
                  'ingest.uploads'::regclass)
                """,
                String.class))
        .isEmpty();
  }

  @Test
  void scored_or_owned_transactions_are_frozen_only_as_context() {
    load("2023-09-01", 3);
    var ids = ids("2023-09-01");
    long scored = nextJob(cutoff.minus(Duration.ofDays(1)));
    UUID completed = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')",
        completed,
        scored);
    runs.snapshot(completed, ids.get(1), "TARGET");
    UUID owner = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'ACTIVE')",
        owner,
        nextJob(cutoff));
    runs.snapshot(owner, ids.get(2), "TARGET");
    jdbc.update("insert into analysis.target_ownership values(?,?)", ids.get(2), owner);
    UUID run = freeze(job, cutoff);
    assertThat(role(run, "TARGET")).containsExactly(ids.getFirst());
    assertThat(role(run, "CONTEXT")).containsExactly(ids.get(1), ids.get(2));
  }

  @Test
  void files_received_or_transactions_occurring_after_the_cutoff_are_not_input() {
    load("2023-09-01", 2);
    // A file received after the cutoff stays out even though its transactions are older.
    load("2023-08-31", cutoff.plusSeconds(60), 3);
    // A transaction after the cutoff stays out even though its file was received before it.
    long early = load("2023-09-03", cutoff.minusSeconds(60), 1);
    UUID run = freeze(job, cutoff);
    assertThat(role(run, "TARGET")).containsExactlyElementsOf(ids("2023-09-01"));
    assertThat(role(run, "CONTEXT")).isEmpty();
    assertThat(
            jdbc.queryForList(
                "select upload_id from analysis.source_manifest where run_id=?", Long.class, run))
        .contains(early)
        .hasSize(2);
    var coverage =
        jdbc.queryForList(
            "select business_date::text as day,complete,row_count from analysis.input_coverage where run_id=? and business_date between '2023-08-31' and '2023-09-02' order by 1",
            run);
    assertThat(coverage)
        .extracting(r -> r.get("day") + ":" + r.get("complete") + ":" + r.get("row_count"))
        .containsExactly("2023-08-31:false:0", "2023-09-01:true:2", "2023-09-02:false:0");
  }

  @Test
  void a_later_freeze_reevaluates_only_new_files_and_matches_a_full_evaluation() {
    load("2023-09-01", 4);
    UUID first = freeze(job, cutoff);
    finish(first);
    Instant later = cutoff.plus(Duration.ofDays(1));
    load("2023-09-02", 3);
    // Received after the first cutoff but before the second: input for the second run only.
    load("2023-08-30", cutoff.plusSeconds(3600), 2);
    long second = nextJob(later);
    UUID next = freeze(second, later);
    var expected = new ArrayList<Long>();
    expected.addAll(ids("2023-08-30"));
    expected.addAll(ids("2023-09-02"));
    assertThat(role(next, "TARGET")).containsExactlyInAnyOrderElementsOf(expected);
    assertThat(role(next, "CONTEXT")).containsExactlyElementsOf(ids("2023-09-01"));
    // The first run still sees exactly what it saw.
    assertThat(role(first, "TARGET")).containsExactlyElementsOf(ids("2023-09-01"));
    assertThat(role(first, "CONTEXT")).isEmpty();
    // The shared ledger's open versions equal a fresh evaluation of every transaction.
    assertThat(
            jdbc.queryForList(
                "select tx_id from analysis.input_ledger where valid_to_seq is null order by tx_id",
                Long.class))
        .containsExactlyElementsOf(
            jdbc.queryForList(
                """
                select t.tx_id from ledger.transactions t join ingest.uploads u using(upload_id)
                where u.received_at<=? and t.occurred_at<=? order by t.tx_id
                """,
                Long.class,
                Timestamp.from(later),
                Timestamp.from(later)));
  }

  @Test
  void backfill_job_completes_after_freeze_and_its_transactions_stay_unscored_history() {
    load("2023-09-01", 3);
    var backfilled = ids("2023-09-01");
    jdbc.update(
        "update analysis.jobs set status='QUEUED',completion_reason='BACKFILL' where job_id=?",
        job);
    receive(job, cutoff);
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
            "select status,current_stage,completion_reason,row_count,alert_count from analysis.jobs where job_id=?",
            job);
    assertThat(done)
        .containsEntry("status", "COMPLETED")
        .containsEntry("current_stage", "COMPLETE")
        .containsEntry("completion_reason", "BACKFILL")
        .containsEntry("row_count", 3)
        .containsEntry("alert_count", 0);
    assertThat(jdbc.queryForObject("select count(*) from analysis.scores", Integer.class)).isZero();
    load("2023-09-02", 2);
    Instant later = cutoff.plus(Duration.ofDays(1));
    UUID next = freeze(nextJob(later), later);
    assertThat(role(next, "TARGET")).hasSize(2).doesNotContainAnyElementsOf(backfilled);
    assertThat(role(next, "CONTEXT")).containsExactlyInAnyOrderElementsOf(backfilled);
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
    load("2023-09-01", 2);
    jdbc.execute(
        "alter table analysis.input_coverage add constraint freeze_test_reject check(false) not valid");
    try {
      assertThatThrownBy(() -> freeze(job, cutoff))
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.input_transactions", Integer.class))
          .isZero();
      assertThat(
              jdbc.queryForObject(
                  "select count(*) from analysis.runs where job_id=?", Integer.class, job))
          .isZero();
    } finally {
      jdbc.execute("alter table analysis.input_coverage drop constraint freeze_test_reject");
    }
    UUID run = freeze(job, cutoff);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from analysis.run_inputs where run_id=?", Integer.class, run))
        .isEqualTo(2);
  }

  @Test
  void rejects_a_frozen_target_outside_the_eligible_set_that_already_has_a_completed_score() {
    load("2023-09-01", 1);
    UUID first = freeze(job, cutoff);
    long tx = ids("2023-09-01").getFirst();
    jdbc.update(
        "insert into analysis.scores(run_id,tx_id,p_laundering,score_pct) values(?,?,0.5,50)",
        first,
        tx);
    runs.complete(first);
    finish(first);
    // A later run that holds the scored transaction as TARGET outside its eligible set.
    long later = nextJob(cutoff.minus(Duration.ofDays(2)));
    UUID run = UUID.randomUUID();
    jdbc.update("insert into analysis.runs(run_id,job_id,status) values(?,?,'READY')", run, later);
    runs.snapshot(run, tx, "TARGET");
    assertThatThrownBy(
            () ->
                transactions.executeWithoutResult(
                    s ->
                        new AlertInputSnapshot(jdbc).freeze(run, cutoff.minus(Duration.ofDays(2)))))
        .hasMessageContaining("FROZEN_TARGET_ALREADY_SCORED");
  }
}
