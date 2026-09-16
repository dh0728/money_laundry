package com.moneylaundry.api.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FlywayMigrationTests {

  @Autowired JdbcTemplate jdbc;

  @Test
  void V1이_적용되고_시드가_들어간다() {
    Boolean v1Success =
        jdbc.queryForObject(
            "select success from flyway_schema_history where version = '1'", Boolean.class);
    assertThat(v1Success).isTrue();

    List<Map<String, Object>> byRole =
        jdbc.queryForList("select role, count(*) as n from users group by role");
    assertThat(byRole)
        .extracting(r -> r.get("role") + "=" + r.get("n"))
        .containsExactlyInAnyOrder("L1=2", "L2=2", "ADMIN=1");

    Integer fxCount = jdbc.queryForObject("select count(*) from fx_rates", Integer.class);
    assertThat(fxCount).isEqualTo(15);

    List<String> indexes =
        jdbc.queryForList(
            "select indexname from pg_indexes where tablename = 'transactions'", String.class);
    assertThat(indexes).contains("ix_transactions_from_time", "ix_transactions_to_time");

    Integer labelTable =
        jdbc.queryForObject(
            "select count(*) from information_schema.tables"
                + " where table_schema = 'evaluation' and table_name = 'transaction_labels'",
            Integer.class);
    assertThat(labelTable).isEqualTo(1);
  }

  @Test
  @Transactional
  void 같은_은행의_같은_계좌번호는_두_번_들어가지_않는다() {
    jdbc.update("insert into banks (bank_id) values (999001)");
    long entity =
        jdbc.queryForObject(
            "insert into"
                + " private.entities(service_entity_id,entity_lookup_token,identity_cipher,name_cipher,key_version)"
                + " values(gen_random_uuid(),'entity-test','test','test','test') returning"
                + " entity_id",
            Long.class);
    jdbc.update(
        "insert into"
            + " private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version)"
            + " values(999001,gen_random_uuid(),'ACC1',?,'test','test')",
        entity);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into"
                        + " private.accounts(bank_id,service_account_id,account_lookup_token,entity_id,identity_cipher,key_version)"
                        + " values(999001,gen_random_uuid(),'ACC1',?,'test','test')",
                    entity))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Autowired org.testcontainers.postgresql.PostgreSQLContainer postgres;
  @Autowired org.springframework.transaction.PlatformTransactionManager manager;

  @Test
  void v3_refuses_populated_legacy_database_without_changing_it() throws Exception {
    String name = "migration_guard_test";
    jdbc.execute("create database " + name);
    String url =
        "jdbc:postgresql://" + postgres.getHost() + ":" + postgres.getMappedPort(5432) + "/" + name;
    try {
      org.flywaydb.core.Flyway.configure()
          .dataSource(url, postgres.getUsername(), postgres.getPassword())
          .target("2")
          .load()
          .migrate();
      try (var connection =
              java.sql.DriverManager.getConnection(
                  url, postgres.getUsername(), postgres.getPassword());
          var statement = connection.createStatement()) {
        statement.execute("insert into banks(bank_id) values(1)");
        statement.execute("insert into accounts(bank_id,account_number) values(1,'LEGACY')");
      }
      assertThatThrownBy(
              () ->
                  org.flywaydb.core.Flyway.configure()
                      .dataSource(url, postgres.getUsername(), postgres.getPassword())
                      .load()
                      .migrate())
          .isInstanceOf(org.flywaydb.core.api.FlywayException.class);
      try (var connection =
              java.sql.DriverManager.getConnection(
                  url, postgres.getUsername(), postgres.getPassword());
          var statement = connection.createStatement();
          var rows = statement.executeQuery("select account_number from accounts")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString(1)).isEqualTo("LEGACY");
        assertThat(rows.next()).isFalse();
      }
    } finally {
      jdbc.execute("drop database " + name);
    }
  }

  @Test
  void restricted_role_cannot_read_private_or_evaluation_tables() {
    String role = "integration_reader_test";
    jdbc.execute("create role " + role);
    try {
      jdbc.execute("grant usage on schema public to " + role);
      jdbc.execute("grant select on transactions to " + role);
      for (String table :
          List.of(
              "private.entities",
              "private.accounts",
              "private.bank_reports",
              "evaluation.report_labels",
              "evaluation.transaction_labels")) {
        assertThatThrownBy(
                () ->
                    new org.springframework.transaction.support.TransactionTemplate(manager)
                        .executeWithoutResult(
                            status -> {
                              jdbc.execute("set local role " + role);
                              jdbc.queryForList("select * from " + table);
                            }))
            .isInstanceOf(org.springframework.dao.DataAccessException.class);
      }
      new org.springframework.transaction.support.TransactionTemplate(manager)
          .executeWithoutResult(
              status -> {
                jdbc.execute("set local role " + role);
                jdbc.queryForList("select tx_id from transactions");
              });
    } finally {
      jdbc.execute("drop owned by " + role);
      jdbc.execute("drop role " + role);
    }
  }
}
