package com.moneylaundry.api.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.common.BusinessTime;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class DashboardDistributionTests {
  @Test
  void counts_binary_results_and_alert_types_in_the_detection_period() {
    var jdbc = mock(JdbcTemplate.class);
    List<Map<String, Object>> types =
        List.of(Map.of("type", 1L, "count", 4L), Map.of("type", 2L, "count", 5L));
    var model = new HashMap<String, Object>();
    model.put("suspicious", null);
    model.put("count", 2L);
    List<Map<String, Object>> results =
        List.of(
            Map.of("suspicious", true, "count", 3L),
            Map.of("suspicious", false, "count", 7L),
            model);
    var from =
        Timestamp.from(LocalDate.parse("2023-09-01").atStartOfDay(BusinessTime.KST).toInstant());
    var to =
        Timestamp.from(LocalDate.parse("2023-09-03").atStartOfDay(BusinessTime.KST).toInstant());
    when(jdbc.queryForList(contains("dashboard_case_items"), eq(from), eq(to))).thenReturn(types);
    when(jdbc.queryForList(contains("dashboard_model_counts"), eq(from), eq(to)))
        .thenReturn(results);
    var result =
        new DashboardQueries(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-01"), LocalDate.parse("2023-09-02"));
    assertThat(result)
        .isEqualTo(
            Map.of(
                "agreements",
                List.of(
                    Map.of("agreement", "NORMAL", "count", 9L),
                    Map.of("agreement", "SUSPICIOUS", "count", 3L)),
                "types",
                types));
  }
}
