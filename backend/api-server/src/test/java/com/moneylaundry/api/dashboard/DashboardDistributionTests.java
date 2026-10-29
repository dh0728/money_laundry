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
  void counts_alert_types_in_the_detection_period_with_one_query() {
    var jdbc = mock(JdbcTemplate.class);
    List<Map<String, Object>> counts =
        List.of(Map.of("type", 1L, "count", 4L), Map.of("type", 2L, "count", 5L));
    when(jdbc.queryForList(anyString(), any(Timestamp.class), any(Timestamp.class)))
        .thenReturn(counts);
    var result =
        new DashboardQueries(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-01"), LocalDate.parse("2023-09-02"));
    assertThat(result).isEqualTo(Map.of("types", counts));
    verify(jdbc)
        .queryForList(
            anyString(),
            eq(
                Timestamp.from(
                    LocalDate.parse("2023-09-01").atStartOfDay(BusinessTime.KST).toInstant())),
            eq(
                Timestamp.from(
                    LocalDate.parse("2023-09-03").atStartOfDay(BusinessTime.KST).toInstant())));
    verifyNoMoreInteractions(jdbc);
  }
}
