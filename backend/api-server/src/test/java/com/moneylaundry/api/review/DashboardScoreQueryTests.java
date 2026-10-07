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
    jdbc.execute("truncate core.banks,analysis.jobs,core.owners cascade");
    jdbc.update("insert into core.banks(bank_id) values(999019)");
    long entity =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'김민준#00001') returning owner_id",
            Long.class);
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999019,gen_random_uuid(),?) returning account_id",
            Long.class,
            entity);
    transactions =
        jdbc.queryForList(
            "insert into ledger.transactions(occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) select '2023-09-01 12:00+09','2023-09-01',?,?,1,'USD',1,'USD','ACH',1,'test' from generate_series(1,3) returning tx_id",
            Long.class,
            account,
            account);
  }

  long score(long transaction, String status, double p, double nonPattern) {
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,threshold_value,analysis_date,analysis_cutoff_at,business_at,current_stage) values(?,.7,(select coalesce(max(analysis_date),'2000-01-01'::date)+1 from analysis.jobs),now(),'2023-09-02 09:00+09','COMPLETE') returning job_id",
            Long.class,
            status);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
    jdbc.update(
        """
      insert into analysis.input_transactions
      select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
      a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
      t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version
      from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
      join core.accounts b on b.account_id=t.to_account_id join core.owners e on e.owner_id=a.owner_id
      join core.owners f on f.owner_id=b.owner_id where t.tx_id=?
      """,
        run,
        transaction);
    jdbc.update(
        "insert into analysis.scores(run_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,type_class) values(?,?,?,?,.4,.4,0,0,0,0,0,0,?)",
        run,
        transaction,
        p,
        nonPattern,
        nonPattern >= .4 ? 0 : 1);
    if (status.equals("COMPLETED"))
      jdbc.update(
          "insert into analysis.current_scores values(?,?) on conflict(tx_id) do update set run_id=excluded.run_id",
          transaction,
          run);
    return job;
  }

  @Test
  void set_query_matches_point_queries_for_publication_ties_and_unscored_rows() {
    long published = score(transactions.get(0), "COMPLETED", 0.9, 0.2);
    score(transactions.get(0), "FAILED", 0.1, 0.9);
    long stale = score(transactions.get(0), "FAILED", 0.1, 0.9);
    UUID current = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,input_revision,status) values(?,?,2,'COMPLETED')",
        current,
        stale);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", current, stale);
    score(transactions.get(1), "COMPLETED", 0.2, 0.9);
    String projection = "select t.tx_id,s.job_id,s.p_laundering,w.type_class ";
    var oldRows = jdbc.queryForList(projection + LedgerQueryService.BASE + " order by t.tx_id");
    var newRows = jdbc.queryForList(projection + DashboardService.SCORE_BASE + " order by t.tx_id");
    assertThat(newRows).isEqualTo(oldRows).hasSize(3);
    assertThat(newRows.getFirst())
        .containsEntry("job_id", published)
        .containsEntry("type_class", 1L);
    assertThat(newRows.get(2)).containsEntry("job_id", null).containsEntry("type_class", null);
  }

  @Test
  void date_filter_does_not_fall_back_to_an_older_prediction_in_the_requested_period() {
    score(transactions.get(0), "COMPLETED", 0.9, 0.2);
    long newer = score(transactions.get(0), "COMPLETED", 0.9, 0.2);
    jdbc.update("update analysis.jobs set business_at='2023-09-03 09:00+09' where job_id=?", newer);
    score(transactions.get(1), "COMPLETED", 0.2, 0.9);
    var result =
        new DashboardService(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-02"), LocalDate.parse("2023-09-02"));
    assertThat(result.get("agreements"))
        .isEqualTo(List.of(Map.of("agreement", "WEAK", "count", 1L)));
    assertThat(result.get("types")).isEqualTo(List.of());
    jdbc.update(
        "update ledger.transactions set integration_status='HELD' where tx_id=?",
        transactions.get(1));
    result =
        new DashboardService(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-02"), LocalDate.parse("2023-09-02"));
    assertThat(result.get("agreements")).isEqualTo(List.of());
  }

  @Test
  void ledger_pages_keep_latest_published_scores_and_filter_before_paging() {
    score(transactions.get(0), "COMPLETED", 0.9, 0.2);
    score(transactions.get(0), "FAILED", 0.1, 0.9);
    score(transactions.get(1), "COMPLETED", 0.2, 0.9);
    var service = new LedgerQueryService(jdbc);
    for (var judgement :
        List.of(
            List.<String>of(),
            List.of("SUSPICIOUS"),
            List.of("NORMAL"),
            List.of("UNANALYZED"),
            List.of("NORMAL", "UNANALYZED"))) {
      String predicate =
          judgement.isEmpty()
              ? ""
              : " and ("
                  + String.join(
                      " or ",
                      judgement.stream()
                          .map(
                              value ->
                                  switch (value) {
                                    case "SUSPICIOUS" -> "s.p_laundering>=s.threshold_value";
                                    case "NORMAL" -> "s.p_laundering<s.threshold_value";
                                    default -> "s.job_id is null";
                                  })
                          .toList())
                  + ")";
      var expected =
          jdbc.queryForList(
              "select t.tx_id as \"txId\",s.p_laundering as \"launderingScore\",w.type_class as \"typeClass\" "
                  + LedgerQueryService.BASE
                  + predicate
                  + " order by t.occurred_at desc,t.tx_id");
      for (int page = 0; page <= expected.size(); page++) {
        var result =
            service.query(
                "transactions",
                new LedgerQueryService.Filter(null, null, null, null, judgement, null, page, 1));
        assertThat(result.get("totalElements")).isEqualTo((long) expected.size());
        var rows = ReviewJson.rows(result.get("content"));
        if (page == expected.size()) assertThat(rows).isEmpty();
        else
          assertThat(rows)
              .singleElement()
              .satisfies(
                  row ->
                      assertThat(row)
                          .containsAllEntriesOf(
                              expected.get(((Number) result.get("page")).intValue())));
      }
    }
  }

  @Test
  void owner_and_account_candidates_deduplicate_both_sides_before_paging() {
    long entity =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'다른가명#00002') returning owner_id",
            Long.class);
    long account =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999019,gen_random_uuid(),?) returning account_id",
            Long.class,
            entity);
    jdbc.update(
        "update ledger.transactions set to_account_id=? where tx_id=?",
        account,
        transactions.get(0));
    score(transactions.get(0), "COMPLETED", 0.9, 0.2);
    var service = new LedgerQueryService(jdbc);
    for (String kind : List.of("owners", "accounts")) {
      var all =
          service.query(
              kind,
              new LedgerQueryService.Filter(
                  null, null, null, null, List.of("SUSPICIOUS"), null, 0, 20));
      assertThat(all.get("totalElements")).isEqualTo(2L);
      var expected = ReviewJson.rows(all.get("content"));
      for (int page = 0; page < 3; page++) {
        var result =
            service.query(
                kind, new LedgerQueryService.Filter(null, null, null, null, null, null, page, 1));
        assertThat(result.get("totalElements")).isEqualTo(2L);
        assertThat(ReviewJson.rows(result.get("content")))
            .isEqualTo(page < 2 ? List.of(expected.get(page)) : List.of());
      }
    }
    UUID owner =
        jdbc.queryForObject(
            "select service_owner_id from core.owners where owner_id=?", UUID.class, entity);
    var result =
        service.query(
            "accounts", new LedgerQueryService.Filter(null, null, owner, null, null, null, 0, 20));
    assertThat(result.get("totalElements")).isEqualTo(1L);
    assertThat(ReviewJson.rows(result.get("content")))
        .singleElement()
        .satisfies(
            row ->
                assertThat(row)
                    .containsEntry("ownerId", owner)
                    .containsEntry("ownerName", "다른가명#00002"));
  }
}
