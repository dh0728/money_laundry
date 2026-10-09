package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class DashboardDistributionTests {
  @Test
  void shares_one_aggregation_and_preserves_populations_and_order() {
    var jdbc = mock(JdbcTemplate.class);
    List<Map<String, Object>> counts =
        List.of(
            Map.of("suspicious", true, "type_class", 2L, "count", 5L),
            Map.of("suspicious", false, "type_class", 0L, "count", 7L),
            Map.of("suspicious", true, "type_class", 0L, "count", 3L),
            Map.of("suspicious", true, "type_class", 1L, "count", 4L),
            Map.of("suspicious", false, "type_class", 2L, "count", 2L));
    when(jdbc.queryForList(anyString(), any(Timestamp.class), any(Timestamp.class)))
        .thenReturn(counts);
    var result =
        new DashboardQueries(jdbc, null)
            .modelDistribution(LocalDate.parse("2023-09-01"), LocalDate.parse("2023-09-02"));
    assertThat(result.get("agreements"))
        .isEqualTo(
            List.of(
                Map.of("agreement", "ATYPICAL", "count", 3L),
                Map.of("agreement", "PATTERN_ONLY", "count", 2L),
                Map.of("agreement", "STRONG", "count", 9L),
                Map.of("agreement", "WEAK", "count", 7L)));
    assertThat(result.get("types"))
        .isEqualTo(
            List.of(
                Map.of("type", 0L, "count", 3L),
                Map.of("type", 1L, "count", 4L),
                Map.of("type", 2L, "count", 5L)));
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
