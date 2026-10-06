package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class DashboardScoreQueryTests {
  @Autowired JdbcTemplate jdbc;
  @MockitoBean AnalysisScheduler scheduler;
  List<Long> transactions;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate banks,batch_jobs,private.entities cascade");
    jdbc.update("insert into banks(bank_id) values(999019)");
    long entity =
        jdbc.queryForObject(
            "insert into private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version) values(gen_random_uuid(),'score-test','x','x','test') returning entity_id",
            Long.class);
    long account =
        jdbc.queryForObject(
            "insert into private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version) values(999019,gen_random_uuid(),'score-test',?,'x','test') returning account_id",
            Long.class,
            entity);
    transactions =
        jdbc.queryForList(
            "insert into transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) select '2023-09-01 12:00+09','2023-09-01',?,?,1,'USD',1,'USD','ACH',1,'test' from generate_series(1,3) returning tx_id",
            Long.class,
            account,
            account);
  }

  long score(long transaction, String status, boolean legacy, double p, double nonPattern) {
    long job =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,threshold_value) values('ANALYSIS',?,0.7) returning job_id",
            Long.class,
            status);
    UUID run = legacy ? null : UUID.randomUUID();
    if (run != null) {
      jdbc.update(
          "insert into analysis_runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
      jdbc.update("update batch_jobs set current_run_id=? where job_id=?", run, job);
    }
    jdbc.update(
        "update batch_jobs set business_at='2023-09-02 09:00+09' where job_id=?", job);
    // Classes 1 and 2 tie: the lower ordinal must win.
    jdbc.update(
        "insert into inference_results(job_id,tx_id,run_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8) values(?,?,?,?,?,0.4,0.4,0,0,0,0,0,0)",
        job,
        transaction,
        run,
        p,
        nonPattern);
    return job;
  }

  @Test
  void set_query_matches_point_queries_for_publication_ties_and_unscored_rows() {
    long published = score(transactions.get(0), "COMPLETED", false, 0.9, 0.2);
    score(transactions.get(0), "FAILED", false, 0.1, 0.9);
    long stale = score(transactions.get(0), "COMPLETED", false, 0.1, 0.9);
    UUID current = UUID.randomUUID();
    jdbc.update(
        "insert into analysis_runs(run_id,job_id,input_revision,status) values(?,?,2,'COMPLETED')",
        current,
        stale);
    jdbc.update("update batch_jobs set current_run_id=? where job_id=?", current, stale);
    score(transactions.get(1), "COMPLETED", true, 0.2, 0.9);
    String projection = "select t.tx_id,s.job_id,s.p_laundering,w.type_class ";
    var oldRows = jdbc.queryForList(projection + LedgerQueryService.BASE + " order by t.tx_id");
    var newRows = jdbc.queryForList(projection + DashboardService.SCORE_BASE + " order by t.tx_id");
    assertThat(newRows).isEqualTo(oldRows).hasSize(3);
    assertThat(newRows.getFirst()).containsEntry("job_id", published).containsEntry("type_class", 1L);
    assertThat(newRows.get(2)).containsEntry("job_id", null).containsEntry("type_class", null);
  }

  @Test
  void date_filter_does_not_fall_back_to_an_older_prediction_in_the_requested_period() {
    score(transactions.get(0), "COMPLETED", false, 0.9, 0.2);
    long newer = score(transactions.get(0), "COMPLETED", false, 0.9, 0.2);
    jdbc.update("update batch_jobs set business_at='2023-09-03 09:00+09' where job_id=?", newer);
    score(transactions.get(1), "COMPLETED", true, 0.2, 0.9);
    var result =
        new DashboardService(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-02"), LocalDate.parse("2023-09-02"));
    assertThat(result.get("agreements"))
        .isEqualTo(List.of(Map.of("agreement", "WEAK", "count", 1L)));
    assertThat(result.get("types")).isEqualTo(List.of());
    jdbc.update(
        "update transactions set integration_status='HELD' where tx_id=?", transactions.get(1));
    result =
        new DashboardService(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-02"), LocalDate.parse("2023-09-02"));
    assertThat(result.get("agreements")).isEqualTo(List.of());
  }
}
