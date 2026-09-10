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
    jdbc.execute("truncate batch_jobs cascade");
    jdbc.update("insert into banks(bank_id) values(991),(992),(993) on conflict do nothing");
    long from =
        jdbc.queryForObject(
            "insert into accounts(bank_id,account_number) values(991,?) returning account_id",
            Long.class,
            java.util.UUID.randomUUID().toString());
    long to =
        jdbc.queryForObject(
            "insert into accounts(bank_id,account_number) values(992,?) returning account_id",
            Long.class,
            java.util.UUID.randomUUID().toString());
    long ingest =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status) values('INGEST','COMPLETED') returning job_id",
            Long.class);
    analysis =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,threshold_value) values('ANALYSIS','COMPLETED','2026-09-10',0.7) returning job_id",
            Long.class);
    for (int n = 0; n < 3; n++) {
      long tx =
          jdbc.queryForObject(
              "insert into transactions(bank_id,occurred_at,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version,row_hash,ingest_job_id) values(993,now(),?,?,1,'USD',1,'USD','ACH',1,'fixture',?,?) returning tx_id",
              Long.class,
              from,
              to,
              String.format("%064d", n),
              ingest);
      jdbc.update(
          "insert into inference_results(job_id,tx_id,p_laundering,p_0,p_1,p_2,p_3,p_4,p_5,p_6,p_7,p_8,score_pct) values(?,?,?,0.4,0.4,0.2,0,0,0,0,0,0,50)",
          analysis,
          tx,
          n == 0 ? 0.6 : n == 1 ? 0.7 : 0.95);
    }
  }

  @Test
  void db_threshold_ties_candidates_paging_and_participant_bank_filter() throws Exception {
    mvc.perform(get("/api/v1/suspicious-transactions").param("size", "1").param("bankId", "992"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(2))
        .andExpect(jsonPath("$.content[0].launderingScore").value(0.95))
        .andExpect(jsonPath("$.content[0].typeClass").value(0))
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
    jdbc.update("update batch_jobs set status='RUNNING' where job_id=?", analysis);
    mvc.perform(get("/api/v1/suspicious-transactions").param("analysisDate", "2026-09-10"))
        .andExpect(jsonPath("$.totalElements").value(0));
    org.assertj.core.api.Assertions.assertThat(
            jdbc.queryForObject("select count(*) from inference_results", Integer.class))
        .isEqualTo(3);
  }

  @Test
  void unsupported_sort_and_invalid_filters_are_rejected() throws Exception {
    mvc.perform(get("/api/v1/suspicious-transactions").param("sort", "drop table"))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/suspicious-transactions").param("size", "201"))
        .andExpect(status().isBadRequest());
  }
}
