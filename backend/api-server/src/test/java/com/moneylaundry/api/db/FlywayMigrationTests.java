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
    jdbc.update("insert into accounts (bank_id, account_number) values (999001, 'ACC1')");

    assertThatThrownBy(
            () ->
                jdbc.update(
                    "insert into accounts (bank_id, account_number) values (999001, 'ACC1')"))
        .isInstanceOf(DataIntegrityViolationException.class);
  }
}
