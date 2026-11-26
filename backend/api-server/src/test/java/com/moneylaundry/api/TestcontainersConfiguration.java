package com.moneylaundry.api;

import java.nio.charset.StandardCharsets;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;

@TestConfiguration(proxyBeanMethods = false)
public class TestcontainersConfiguration {

  @Bean
  org.springframework.test.context.DynamicPropertyRegistrar dashboardTestProperties() {
    return registry -> registry.add("app.dashboard.refresh-enabled", () -> false);
  }

  @Bean
  @ServiceConnection
  PostgreSQLContainer postgres() {
    return new PostgreSQLContainer("postgres:17-alpine");
  }

  /** Lets fixtures write ledger rows directly; see test_ledger_defaults.sql. */
  @Bean
  ApplicationRunner ledgerTestDefaults(JdbcTemplate jdbc) {
    return args ->
        jdbc.execute(
            new ClassPathResource("test_ledger_defaults.sql")
                .getContentAsString(StandardCharsets.UTF_8));
  }
}
