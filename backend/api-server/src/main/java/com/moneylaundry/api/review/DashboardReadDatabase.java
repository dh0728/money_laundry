package com.moneylaundry.api.review;

import com.moneylaundry.api.ApiException;
import com.zaxxer.hikari.*;
import jakarta.annotation.PreDestroy;
import java.sql.*;
import java.util.concurrent.*;
import java.util.function.Function;
import javax.sql.DataSource;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** A small isolated read pool and an absolute deadline, including connection acquisition. */
@Component
public class DashboardReadDatabase {
  private static final int MAX_CONNECTIONS = 4;
  private final HikariDataSource pool;
  private final Environment environment;
  private final ScheduledExecutorService deadlines =
      Executors.newScheduledThreadPool(
          MAX_CONNECTIONS,
          r -> {
            var t = new Thread(r, "dashboard-read-deadline");
            t.setDaemon(true);
            return t;
          });

  public DashboardReadDatabase(DataSource source, Environment environment) throws SQLException {
    this.environment = environment;
    var original = source.unwrap(HikariDataSource.class);
    var config = new HikariConfig();
    config.setJdbcUrl(original.getJdbcUrl());
    config.setUsername(original.getUsername());
    config.setPassword(original.getPassword());
    var properties = new java.util.Properties();
    properties.putAll(original.getDataSourceProperties());
    properties.setProperty("cancelSignalTimeout", "1");
    config.setDataSourceProperties(properties);
    config.setPoolName("dashboard-read");
    config.setMaximumPoolSize(MAX_CONNECTIONS);
    config.setMinimumIdle(0);
    config.setConnectionTimeout(750);
    config.setValidationTimeout(500);
    config.setInitializationFailTimeout(-1);
    config.setReadOnly(true);
    config.setAutoCommit(false);
    config.setTransactionIsolation("TRANSACTION_REPEATABLE_READ");
    pool = new HikariDataSource(config);
  }

  record Context(JdbcTemplate jdbc, BusinessTime time) {}

  public static final class Unavailable extends ApiException {
    Unavailable(boolean timeout) {
      super(
          HttpStatus.SERVICE_UNAVAILABLE,
          timeout ? "DASHBOARD_READ_TIMEOUT" : "DASHBOARD_READ_UNAVAILABLE",
          "대시보드 조회를 완료하지 못했습니다. 잠시 후 다시 시도하세요.");
    }
  }

  private static final class Lease {
    Connection connection;
    final java.util.List<Statement> statements = new java.util.ArrayList<>();
    boolean expired, closed;

    synchronized void expire() {
      if (closed) return;
      expired = true;
      // Closing a TCP connection alone need not interrupt a running PostgreSQL query.
      for (var statement : statements)
        try {
          if (!statement.isClosed()) statement.cancel();
        } catch (SQLException ignored) {
          /* Abort below is the fallback. */
        }
      if (connection != null)
        try {
          connection.abort(Runnable::run);
        } catch (SQLException ignored) {
          /* The request also rolls back/closes it. */
        }
    }
  }

  <T> T read(Function<Context, T> query) {
    return read(3000, query);
  }

  <T> T read(long budgetMillis, Function<Context, T> query) {
    if (budgetMillis < 1 || budgetMillis > 3000)
      throw new IllegalArgumentException("Invalid dashboard read budget");
    var lease = new Lease();
    var timeout = deadlines.schedule(lease::expire, budgetMillis, TimeUnit.MILLISECONDS);
    try {
      var connection = pool.getConnection();
      synchronized (lease) {
        lease.connection = connection;
        if (lease.expired) throw new Unavailable(true);
      }
      var source = new SingleConnectionDataSource(connection, true);
      var jdbc =
          new JdbcTemplate(source) {
            @Override
            protected void applyStatementSettings(Statement statement) throws SQLException {
              super.applyStatementSettings(statement);
              synchronized (lease) {
                if (lease.expired) throw new SQLTimeoutException("Dashboard deadline", "57014");
                lease.statements.add(statement);
              }
            }
          };
      var time =
          new BusinessTime(
              jdbc, new TransactionTemplate(new DataSourceTransactionManager(source)), environment);
      T result = query.apply(new Context(jdbc, time));
      connection.rollback(); // Read-only snapshot; release it before returning a detached DTO.
      synchronized (lease) {
        if (lease.expired) throw new Unavailable(true);
      }
      return result;
    } catch (com.moneylaundry.api.ApiException ex) {
      throw ex;
    } catch (SQLException | org.springframework.dao.DataAccessException ex) {
      synchronized (lease) {
        throw new Unavailable(lease.expired);
      }
    } finally {
      synchronized (lease) {
        lease.closed = true;
        timeout.cancel(false);
        if (lease.connection != null)
          try {
            lease.connection.close();
          } catch (SQLException ignored) {
            /* Pool discards broken connections. */
          }
      }
    }
  }

  @PreDestroy
  public void close() {
    deadlines.shutdownNow();
    pool.close();
  }
}
