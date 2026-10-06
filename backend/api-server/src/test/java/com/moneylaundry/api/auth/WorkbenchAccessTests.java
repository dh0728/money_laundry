package com.moneylaundry.api.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.moneylaundry.api.ApiException;
import com.moneylaundry.api.review.BusinessTime;
import java.sql.Timestamp;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

class WorkbenchAccessTests {
  @Test
  void production_requires_explicit_opt_in_even_with_local_profile() {
    var env = new MockEnvironment();
    env.setActiveProfiles("prod", "local");
    assertThat(WorkbenchAccess.enabled(env)).isFalse();
    env.setProperty("app.presentation.enabled", "true");
    assertThat(WorkbenchAccess.enabled(env)).isTrue();
    env.setProperty("app.presentation.enabled", "false");
    assertThat(WorkbenchAccess.enabled(env)).isFalse();
    env.setActiveProfiles("dev");
    assertThat(WorkbenchAccess.enabled(env)).isTrue();
  }

  @Test
  void presentation_reads_copied_clock_but_cannot_enable_destructive_controls() {
    var env = new MockEnvironment().withProperty("app.presentation.enabled", "true");
    env.setActiveProfiles("prod");
    var jdbc = mock(JdbcTemplate.class);
    var expected = Instant.parse("2023-09-02T00:00:00Z");
    when(jdbc.queryForObject("select business_at from demo_business_clock where id", Timestamp.class))
        .thenReturn(Timestamp.from(expected));
    var time = new BusinessTime(jdbc, null, env);
    time.workbenchOnly();
    assertThat(time.now()).isEqualTo(expected);
    assertThatThrownBy(time::demoOnly).isInstanceOf(ApiException.class);
    assertThatThrownBy(() -> time.set(expected, 0)).isInstanceOf(ApiException.class);
  }
}
