package com.moneylaundry.api.db;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class FlywayMigrationTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired PostgreSQLContainer postgres;
  @Autowired PlatformTransactionManager manager;

  @Test
  void initial_schema_has_one_migration_and_configuration_seeds() {
    assertThat(
            jdbc.queryForList(
                "select version from flyway_schema_history where success and version is not null",
                String.class))
        .containsExactly("1");
    assertThat(
            jdbc.queryForList(
                "select role||'='||count(*) from core.users group by role", String.class))
        .containsExactlyInAnyOrder("STAFF=4", "ADMIN=1");
    assertThat(jdbc.queryForObject("select count(*) from core.fx_rates", Integer.class))
        .isEqualTo(15);
    assertThat(
            jdbc.queryForList(
                "select indexname from pg_indexes where schemaname='ledger' and tablename='transactions'",
                String.class))
        .contains("transactions_from_time", "transactions_to_time");
    assertThat(
            jdbc.queryForList(
                "select table_name from information_schema.tables where table_schema='public'",
                String.class))
        .containsExactly("flyway_schema_history");
  }

  @Test
  @Transactional
  void account_identity_is_unique_within_a_bank() {
    jdbc.update("insert into core.banks(bank_id) values(999001)");
    long owner =
        jdbc.queryForObject(
            "insert into core.owners(service_owner_id,display_name) values(gen_random_uuid(),'fixture') returning owner_id",
            Long.class);
    long first =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999001,gen_random_uuid(),?) returning account_id",
            Long.class,
            owner);
    long second =
        jdbc.queryForObject(
            "insert into core.accounts(bank_id,service_account_id,owner_id) values(999001,gen_random_uuid(),?) returning account_id",
            Long.class,
            owner);
    jdbc.update(
        "insert into private.account_identities values(?,999001,'same-token','cipher','test')",
        first);
    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into private.account_identities values(?,999001,'same-token','cipher','test')",
                    second))
        .isInstanceOf(DataIntegrityViolationException.class);
  }

  @Test
  void migration_rerun_is_read_only() {
    var before = jdbc.queryForList("select * from core.users order by user_id");
    var flyway =
        Flyway.configure()
            .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
            .locations("classpath:db/migration")
            .load();
    assertThat(flyway.migrate().migrationsExecuted).isZero();
    assertThat(jdbc.queryForList("select * from core.users order by user_id")).isEqualTo(before);
  }

  @Test
  void populated_legacy_database_requires_explicit_reset() throws Exception {
    String name = "initial_schema_legacy_guard";
    jdbc.execute("create database " + name);
    String url =
        "jdbc:postgresql://" + postgres.getHost() + ":" + postgres.getMappedPort(5432) + "/" + name;
    try (var connection =
            java.sql.DriverManager.getConnection(
                url, postgres.getUsername(), postgres.getPassword());
        var statement = connection.createStatement()) {
      statement.execute("create table batch_jobs(job_id bigint primary key)");
      statement.execute("insert into batch_jobs values(123)");
      assertThatThrownBy(
              () ->
                  Flyway.configure()
                      .dataSource(url, postgres.getUsername(), postgres.getPassword())
                      .locations("classpath:db/migration")
                      .load()
                      .migrate())
          .isInstanceOf(org.flywaydb.core.api.FlywayException.class);
      try (var rows = statement.executeQuery("select job_id from batch_jobs")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getLong(1)).isEqualTo(123);
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
      jdbc.execute("grant usage on schema ledger to " + role);
      jdbc.execute("grant select on ledger.transactions to " + role);
      for (String table :
          List.of(
              "private.owner_identities",
              "private.account_identities",
              "private.bank_reports",
              "evaluation.report_labels",
              "evaluation.transaction_labels")) {
        assertThatThrownBy(
                () ->
                    new TransactionTemplate(manager)
                        .executeWithoutResult(
                            status -> {
                              jdbc.execute("set local role " + role);
                              jdbc.queryForList("select * from " + table);
                            }))
            .isInstanceOf(DataAccessException.class);
      }
      new TransactionTemplate(manager)
          .executeWithoutResult(
              status -> {
                jdbc.execute("set local role " + role);
                jdbc.queryForList("select tx_id from ledger.transactions");
              });
    } finally {
      jdbc.execute("drop owned by " + role);
      jdbc.execute("drop role " + role);
    }
  }
}
