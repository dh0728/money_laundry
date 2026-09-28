package com.moneylaundry.api.analysis;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "spring.profiles.active=local")
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class AnalysisEntryTests {
  @Autowired MockMvc mvc;
  @Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
  @org.springframework.test.context.bean.override.mockito.MockitoBean AnalysisScheduler scheduler;

  @Test
  void 분석_등록과_날짜중복을_구분한다() throws Exception {
    mvc.perform(post("/api/v1/batch-jobs/analysis"))
        .andExpect(status().isAccepted())
        .andExpect(jsonPath("$.jobId").isNumber())
        .andExpect(jsonPath("$.status").value("QUEUED"));
    mvc.perform(post("/api/v1/batch-jobs/analysis")).andExpect(status().isConflict());
  }

  @Test
  void 완료결과없는_업무목록은_빈페이지다() throws Exception {
    mvc.perform(get("/api/v1/suspicious-transactions"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(0));
  }

  @Test
  void 날짜와시각_응답은_서울_ISO_계약이다() throws Exception {
    long id =
        jdbc.queryForObject(
            "insert into batch_jobs(job_type,status,analysis_date,analysis_cutoff_at,started_at,current_stage) values('ANALYSIS','QUEUED','2099-01-01','2098-12-31T18:00:00Z','2098-12-31T18:00:00Z','WAIT_INGEST') returning job_id",
            Long.class);
    mvc.perform(get("/api/v1/batch-jobs/" + id))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.analysisDate").value("2099-01-01"))
        .andExpect(jsonPath("$.cutoffAt").value("2099-01-01T03:00:00+09:00"))
        .andExpect(jsonPath("$.startedAt").value("2099-01-01T03:00:00+09:00"));
  }
}
