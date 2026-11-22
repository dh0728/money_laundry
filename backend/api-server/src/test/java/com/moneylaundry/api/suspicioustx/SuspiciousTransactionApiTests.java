package com.moneylaundry.api.suspicioustx;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@org.springframework.test.context.ActiveProfiles("local")
@org.springframework.security.test.context.support.WithMockUser(roles = "STAFF")
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class SuspiciousTransactionApiTests {
  @Autowired MockMvc mvc;
  @Autowired JdbcTemplate jdbc;
  @MockitoBean AnalysisScheduler scheduler;
  long analysis;

  @BeforeEach
  void setup() {
    jdbc.execute("truncate analysis.jobs,core.owners cascade");
    jdbc.update("insert into core.banks(bank_id) values(991),(992),(993) on conflict do nothing");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'가명#00001') returning owner_id",
            Long.class);
    long from =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(991,gen_random_uuid(),?) returning account_id",
            Long.class,
            owner);
    long to =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(992,gen_random_uuid(),?) returning account_id",
            Long.class,
            owner);
    analysis =
        jdbc.queryForObject(
            "insert into analysis.jobs(status,analysis_date,threshold_value,analysis_cutoff_at,business_at,current_stage) values('COMPLETED','2026-09-10',0.7,now(),now(),'COMPLETE') returning job_id",
            Long.class);
    java.util.UUID run = java.util.UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, analysis);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, analysis);
    for (int n = 0; n < 3; n++) {
      long tx =
          jdbc.queryForObject(
              "insert into ledger.transactions(occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,business_date) values(now(),?,?,1,'USD',1,'USD','ACH',1,'fixture','2026-09-10') returning tx_id",
              Long.class,
              from,
              to);
      jdbc.update(
          """
        insert into analysis.input_transactions
        select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,a.bank_id,b.bank_id,
          a.service_account_id,b.service_account_id,e.service_owner_id,f.service_owner_id,
          t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,
          t.payment_format,t.amount_usd,t.fx_rate_version
        from ledger.transactions t join core.accounts a on a.account_id=t.from_account_id
        join core.accounts b on b.account_id=t.to_account_id
        join core.owners e on e.owner_id=a.owner_id join core.owners f on f.owner_id=b.owner_id where t.tx_id=?
        """,
          run,
          tx);
      jdbc.update(
          "insert into analysis.scores(run_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,score_pct,type_class) values(?,?,?,0.4,0.4,0.2,0,0,0,0,0,0,50,0)",
          run,
          tx,
          n == 0 ? 0.6 : n == 1 ? 0.7 : 0.95);
      jdbc.update("insert into analysis.current_scores(tx_id,run_id) values(?,?)", tx, run);
    }
  }

  @Test
  void db_threshold_ties_candidates_paging_and_participant_bank_filter() throws Exception {
    mvc.perform(get("/api/v1/suspicious-transactions").param("size", "1").param("bankId", "992"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(2))
        .andExpect(jsonPath("$.content[0].launderingScore").value(0.95))
        .andExpect(jsonPath("$.content[0].typeClass").value(0))
        .andExpect(jsonPath("$.content[0].typeName").value("NON_PATTERN"))
        .andExpect(jsonPath("$.content[0].typeCandidates[0].name").value("NON_PATTERN"))
        .andExpect(jsonPath("$.content[0].typeCandidates.length()").value(2))
        .andExpect(jsonPath("$.content[0].agreement").value("ATYPICAL"));
    mvc.perform(get("/api/v1/suspicious-transactions").param("bankId", "993"))
        .andExpect(jsonPath("$.totalElements").value(0));
    mvc.perform(get("/api/v1/suspicious-transactions").param("typeClass", "1"))
        .andExpect(jsonPath("$.totalElements").value(0));
    mvc.perform(get("/api/v1/suspicious-transactions").param("minScore", "0.9"))
        .andExpect(jsonPath("$.totalElements").value(1));
  }

  @Test
  void unfinished_results_are_hidden_without_deleting_rows() throws Exception {
    jdbc.update("update analysis.jobs set status='RUNNING' where job_id=?", analysis);
    mvc.perform(get("/api/v1/suspicious-transactions").param("analysisDate", "2026-09-10"))
        .andExpect(jsonPath("$.totalElements").value(0));
    org.assertj.core.api.Assertions.assertThat(
            jdbc.queryForObject("select count(*) from analysis.scores", Integer.class))
        .isEqualTo(3);
  }

  @Test
  void ledger_non_pattern_does_not_imply_suspicious() {
    var ledger = new com.moneylaundry.api.review.LedgerQueryService(jdbc);
    var page =
        ledger.query(
            "transactions",
            new com.moneylaundry.api.review.LedgerQueryService.Filter(
                null, null, null, null, null, null, 0, 200));
    var rows = (java.util.List<java.util.Map<String, Object>>) page.get("content");
    org.assertj.core.api.Assertions.assertThat(rows).hasSize(3);
    for (var row : rows) {
      org.assertj.core.api.Assertions.assertThat(row.get("typeName")).isEqualTo("NON_PATTERN");
      org.assertj.core.api.Assertions.assertThat(row.get("amountUsd").toString()).startsWith("1");
    }
    org.assertj.core.api.Assertions.assertThat(
            rows.stream().filter(r -> Boolean.TRUE.equals(r.get("isSuspicious"))).count())
        .isEqualTo(2);
    org.assertj.core.api.Assertions.assertThat(
            rows.stream().filter(r -> Boolean.FALSE.equals(r.get("isSuspicious"))).count())
        .isEqualTo(1);
  }

  @Test
  void unsupported_sort_and_invalid_filters_are_rejected() throws Exception {
    mvc.perform(get("/api/v1/suspicious-transactions").param("sort", "drop table"))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/suspicious-transactions").param("size", "201"))
        .andExpect(status().isBadRequest());
  }
}
