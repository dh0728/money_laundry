package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Synthetic TOP10 cardinalities; distributions and evidence are not the dev data. */
@SpringBootTest(properties = "spring.profiles.active=local")
@Import(TestcontainersConfiguration.class)
@EnabledIfEnvironmentVariable(named = "AML_PERFORMANCE_TESTS", matches = "true")
class QueryPerformanceTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired LedgerQueryService ledger;
  @Autowired ReviewService review;
  @Autowired DashboardService dashboard;
  @Autowired DashboardProjection projection;
  @Autowired com.moneylaundry.api.analysis.AnalysisRunService runs;
  @MockitoBean AnalysisScheduler scheduler;

  @Test
  void measure_top10_with_dense_evidence() {
    for (String table :
        jdbc.queryForList(
            "select schemaname||'.'||relname from pg_stat_user_tables where schemaname in ('analysis','review')",
            String.class)) {
      jdbc.execute("alter table " + table + " set (autovacuum_enabled=false)");
    }
    jdbc.execute(
        "truncate core.owners,core.banks,analysis.jobs,review.alerts,review.episodes cascade");
    jdbc.execute("insert into core.banks(bank_id) select generate_series(1,10)");
    jdbc.execute(
        "insert into core.owners(owner_id,service_owner_id,display_name) overriding system value select n,gen_random_uuid(),'가명#'||n from generate_series(1,50381) n");
    jdbc.execute(
        "insert into core.accounts(account_id,service_account_id,bank_id,owner_id) overriding system value select n,gen_random_uuid(),1+(n%10),1+((n-1)%50381) from generate_series(1,76754) n");
    long ledgerStarted = System.nanoTime();
    jdbc.execute(
        "insert into ledger.transactions(tx_id,occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) overriding system value select n,timestamptz '2023-08-31 00:00+09'+((n-1)%864000)*interval '1 second',date '2023-08-31'+((n-1)%10),1+((n-1)%76754),1+(n%76754),100,'USD',100,'USD','ACH',100,'fx_rates_usd_v1' from generate_series(1,690519) n");
    System.out.printf(
        "DASHBOARD_SOURCE_INSERT transactions=690519 seconds=%.3f%n",
        (System.nanoTime() - ledgerStarted) / 1_000_000_000.0);
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-10','2023-09-10 00:00+09','2023-09-09 09:00+09',.7,'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    UUID run = UUID.randomUUID();
    jdbc.update(
        "insert into analysis.runs(run_id,job_id,status) values(?,?,'COMPLETED')", run, job);
    jdbc.update("update analysis.jobs set current_run_id=? where job_id=?", run, job);
    jdbc.update(
        "insert into analysis.input_transactions select ?,t.tx_id,'TARGET',t.occurred_at,t.business_date,f.bank_id,r.bank_id,f.service_account_id,r.service_account_id,fo.service_owner_id,ro.service_owner_id,t.amount_received,t.receiving_currency,t.amount_paid,t.payment_currency,t.payment_format,t.amount_usd,t.fx_rate_version from ledger.transactions t join core.accounts f on f.account_id=t.from_account_id join core.accounts r on r.account_id=t.to_account_id join core.owners fo on fo.owner_id=f.owner_id join core.owners ro on ro.owner_id=r.owner_id",
        run);
    jdbc.update(
        "insert into analysis.scores select ?,tx_id,.9,.1,.9,0,0,0,0,0,0,0,90,1 from ledger.transactions",
        run);
    jdbc.update("insert into analysis.current_scores select tx_id,? from ledger.transactions", run);
    long user =
        jdbc.queryForObject("select user_id from core.users where username='l1a'", Long.class);
    jdbc.update(
        "insert into review.alerts(alert_id,assignee_id,created_at,assigned_at) select n,?,'2023-09-09 09:00+09'::timestamptz,'2023-09-09 09:00+09'::timestamptz from generate_series(1,40389) n",
        user);
    jdbc.update(
        """
      insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence)
      select a.alert_id,1,?,repeat('f',64),jsonb_build_object('transactions',jsonb_agg(jsonb_build_object(
       'txId',t.tx_id,'role',case when t.tx_id<a.alert_id*7+9 then 'SEED' else 'CONTEXT' end,'occurredAt','2023-09-01T00:00:00Z',
       'fromAccountId',f.service_account_id,'toAccountId',r.service_account_id,
       'amountPaid',100,'amountReceived',100,'paymentCurrency','USD','receivingCurrency','USD',
       'paymentFormat','ACH','scores',jsonb_build_object('p_laundering',.9,'p_0',.1,'p_1',.9))),
       'seeds',jsonb_agg(jsonb_build_object('txId',t.tx_id,'threshold',.7)),'summary',jsonb_build_object('scoreMax',.9))
      from review.alerts a join ledger.transactions t on t.tx_id between a.alert_id*7 and a.alert_id*7+30
      join core.accounts f on f.account_id=t.from_account_id join core.accounts r on r.account_id=t.to_account_id
      group by a.alert_id
      """,
        run);
    jdbc.execute(
        "insert into review.alert_transactions select a.alert_id,1,t.tx_id,case when t.tx_id<a.alert_id*7+9 then 'SEED' else 'CONTEXT' end,'[]'::jsonb,case when t.tx_id<a.alert_id*7+9 then .9 end from review.alerts a join ledger.transactions t on t.tx_id between a.alert_id*7 and a.alert_id*7+30");
    jdbc.execute("update review.alert_versions set published_at=now()");
    jdbc.execute(
        "update review.alerts set published_version=1,summary=jsonb_build_object('riskScore',.9,'txCount',31,'seedCount',9,'primaryType','Fan-out','primaryTypes',jsonb_build_array('Fan-out'),'pendingCount',9)");
    jdbc.execute("update ops.business_clock set business_at='2023-09-10 09:00+09'");
    for (String table :
        new String[] {
          "core.owners",
          "core.accounts",
          "core.banks",
          "ledger.transactions",
          "analysis.scores",
          "analysis.current_scores",
          "analysis.input_transactions",
          "review.alerts",
          "review.alert_versions",
          "review.alert_transactions"
        }) jdbc.execute("analyze " + table);
    assertThat(
            jdbc.queryForObject(
                "select count(*) from pg_stats where schemaname='analysis' and tablename in ('jobs','runs')",
                Integer.class))
        .isZero();
    for (var scope : DashboardProjection.Scope.values()) {
      long started = System.nanoTime();
      projection.refresh(scope);
      System.out.printf(
          "DASHBOARD_REFRESH scope=%s seconds=%.3f%n",
          scope, (System.nanoTime() - started) / 1_000_000_000.0);
    }
    System.out.println(
        "DASHBOARD_STORED_ROWS "
            + jdbc.queryForMap(
                "select (select count(*) from ops.dashboard_model_counts) as model,(select count(*) from ops.dashboard_case_counts) as cases"));
    jdbc.setQueryTimeout(15);
    String plan =
        String.join(
            "\n",
            jdbc.queryForList(
                "explain (analyze,buffers,timing off) select case_id from "
                    + ReviewCaseSql.WITH_RISK
                    + " c where kind='ALERT' order by risk desc,created_at desc,case_id desc limit 20",
                String.class));
    System.out.println("ALERT_RISK_PLAN\n" + plan);
    assertThat(plan).doesNotContain("jsonb_array_elements");
    var from = LocalDate.parse("2023-08-31");
    var to = LocalDate.parse("2023-09-09");
    var filter = new LedgerQueryService.Filter(from, to, null, null, null, null, 0, 20);
    for (int i = 1; i <= 3; i++) {
      measure("owners", i, 50381, () -> ledger.query("owners", filter));
      measure("transactions", i, 690519, () -> ledger.query("transactions", filter));
      measure("alerts", i, 40389, () -> review.list("ALERT", null, null, from, to, 0, 20));
      measure("episodes", i, 0, () -> review.list("EPISODE", null, null, from, to, 0, 20));
      measure("dashboard", i, -1, () -> dashboard.view(user, from, to));
    }
    long changed = System.nanoTime();
    jdbc.update(
        "update review.alerts set assigned_at=assigned_at+interval '1 second' where alert_id=1");
    assertThat(projection.refresh(DashboardProjection.Scope.PIPELINE)).isFalse();
    assertThat(projection.refresh(DashboardProjection.Scope.INVESTIGATION)).isTrue();
    System.out.printf(
        "DASHBOARD_CASE_CHANGE seconds=%.3f%n", (System.nanoTime() - changed) / 1_000_000_000.0);
    jdbc.execute(
        "update review.alerts set assigned_at='2023-09-01 00:00+09'::timestamptz+alert_id*interval '1 second'");
    long fragmented = System.nanoTime();
    projection.refresh(DashboardProjection.Scope.INVESTIGATION);
    assertThat(jdbc.queryForObject("select count(*) from ops.dashboard_case_counts", Long.class))
        .isEqualTo(40389L);
    System.out.printf(
        "DASHBOARD_FRAGMENTED_REFRESH rows=40389 seconds=%.3f%n",
        (System.nanoTime() - fragmented) / 1_000_000_000.0);
    for (int round = 1; round <= 3; round++)
      measure("dashboard_fragmented", round, -1, () -> dashboard.view(user, from, to));
    runs.refreshQueryStatistics();
    measure(
        "alerts_after_analyze", 1, 40389, () -> review.list("ALERT", null, null, from, to, 0, 20));
    measure("dashboard_after_analyze", 1, -1, () -> dashboard.view(user, from, to));
  }

  private void measure(String name, int round, long count, Supplier<?> query) {
    long start = System.nanoTime();
    var result = query.get();
    System.out.printf(
        "PERFORMANCE %s #%d %.3fs count=%s%n",
        name,
        round,
        (System.nanoTime() - start) / 1e9,
        (result instanceof Map<?, ?> page ? page.get("totalElements") : null));
    if (count >= 0)
      assertThat(
              ((Number) (result instanceof Map<?, ?> page ? page.get("totalElements") : null))
                  .longValue())
          .isEqualTo(count);
  }
}
