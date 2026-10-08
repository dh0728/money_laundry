package com.moneylaundry.api.review;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.moneylaundry.api.ApiExceptionHandler;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DashboardApiContractTests {
  DashboardService dashboard;
  MockMvc mvc;

  @BeforeEach
  void setup() {
    dashboard = mock(DashboardService.class);
    var reviews = mock(ReviewService.class);
    when(reviews.userId(any())).thenReturn(42L);
    mvc =
        MockMvcBuilders.standaloneSetup(
                new ReviewController(
                    reviews, mock(LedgerQueryService.class), mock(BusinessTime.class), dashboard))
            .setControllerAdvice(new ApiExceptionHandler())
            .build();
  }

  @Test
  void unavailable_has_retry_hint_and_does_not_expose_internal_failure() throws Exception {
    when(dashboard.view(eq(42L), any(), any()))
        .thenThrow(new DashboardReadDatabase.Unavailable(true));
    mvc.perform(
            get("/api/v1/dashboard/summary")
                .principal(() -> "l1a")
                .param("from", "2023-09-01")
                .param("to", "2023-09-01"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(header().string("Retry-After", "2"))
        .andExpect(header().string("Cache-Control", "private, no-store"))
        .andExpect(jsonPath("$.code").value("DASHBOARD_READ_TIMEOUT"));
  }

  @Test
  void lists_are_separate_typed_contracts() throws Exception {
    var instant = Instant.parse("2023-09-01T00:00:00Z");
    when(dashboard.activities(eq(42L), any(), any()))
        .thenReturn(List.of(new DashboardLists.Activity("1", "2", "REVIEW_START", null, instant)));
    when(dashboard.queues(42L))
        .thenReturn(
            new DashboardLists.Queues(
                instant.toString(),
                List.of(new DashboardLists.Priority("2", "EPISODE", null, instant, .5)),
                List.of()));
    mvc.perform(
            get("/api/v1/dashboard/activities")
                .principal(() -> "l1a")
                .param("from", "2023-09-01")
                .param("to", "2023-09-01"))
        .andExpect(status().isOk())
        .andExpect(header().string("Cache-Control", "private, no-store"))
        .andExpect(jsonPath("$[0].eventId").value("1"))
        .andExpect(jsonPath("$[0].businessAt").exists());
    mvc.perform(get("/api/v1/dashboard/queues").principal(() -> "l1a"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.priority[0].caseId").value("2"))
        .andExpect(jsonPath("$.priority[0].alertId").isEmpty())
        .andExpect(jsonPath("$.oldestOpen").isArray());
  }

  @Test
  void old_endpoint_is_removed_and_missing_range_is_rejected() throws Exception {
    mvc.perform(get("/api/v1/dashboard").principal(() -> "l1a")).andExpect(status().isNotFound());
    mvc.perform(get("/api/v1/dashboard/summary").principal(() -> "l1a"))
        .andExpect(status().isBadRequest());
    verifyNoInteractions(dashboard);
  }
}
