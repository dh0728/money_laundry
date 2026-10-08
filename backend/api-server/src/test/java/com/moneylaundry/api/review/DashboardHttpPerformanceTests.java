package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.*;

import com.moneylaundry.api.TestcontainersConfiguration;
import com.moneylaundry.api.analysis.AnalysisScheduler;
import java.net.*;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.ObjectMapper;

/** Opt-in synthetic TOP10 counts, real HTTP/session/JSON, not dev or browser timings. */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "spring.profiles.active=local")
@Import(TestcontainersConfiguration.class)
@EnabledIfEnvironmentVariable(named = "AML_PERFORMANCE_TESTS", matches = "true")
class DashboardHttpPerformanceTests {
  @Autowired JdbcTemplate jdbc;
  @Autowired DashboardProjection projection;
  @Autowired PasswordEncoder passwords;
  @Autowired ObjectMapper json;

  @Value("${local.server.port}")
  int port;

  @MockitoBean AnalysisScheduler scheduler;

  @Test
  void authenticated_polling_with_concurrent_publication() throws Exception {
    jdbc.execute(
        "truncate core.owners,core.banks,analysis.jobs,review.alerts,review.episodes cascade");
    jdbc.execute("insert into core.banks(bank_id) select generate_series(1,10)");
    jdbc.execute(
        "insert into core.owners(owner_id,service_owner_id,display_name) overriding system value select n,gen_random_uuid(),'fixture#'||n from generate_series(1,50381) n");
    jdbc.execute(
        "insert into core.accounts(account_id,bank_id,service_account_id,owner_id) overriding system value select n,(n%10)+1,gen_random_uuid(),(n%50381)+1 from generate_series(1,76754) n");
    jdbc.execute(
        "insert into ledger.transactions(tx_id,occurred_at,business_date,from_account_id,to_account_id,amount_received,receiving_currency,amount_paid,payment_currency,payment_format,amount_usd,fx_rate_version) overriding system value select n,'2023-08-31 09:00+09'::timestamptz+(n%10)*interval '1 day','2023-08-31'::date+(n%10)::int,(n%76754)+1,((n+1)%76754)+1,1,'USD',1,'USD','ACH',1,'fixture' from generate_series(1,690519) n");
    long job =
        jdbc.queryForObject(
            "insert into analysis.jobs(analysis_date,analysis_cutoff_at,business_at,threshold_value,status,current_stage) values('2023-09-10',now(),'2023-09-10 09:00+09',.7,'COMPLETED','COMPLETE') returning job_id",
            Long.class);
    var run = UUID.randomUUID();
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
        "insert into review.alerts(alert_id,assignee_id,created_at,assigned_at,summary) select n,?,'2023-09-01 09:00+09'::timestamptz+n*interval '1 microsecond','2023-09-01 09:00+09'::timestamptz+n*interval '1 microsecond','{\"riskScore\":0.9}'::jsonb from generate_series(1,40389) n",
        user);
    jdbc.update(
        "insert into review.alert_versions(alert_id,version,run_id,fingerprint,evidence,published_at) select alert_id,1,?,repeat('f',64),'{}',now() from review.alerts",
        run);
    jdbc.update("update review.alerts set published_version=1");
    jdbc.update("update ops.business_clock set business_at='2023-09-10 09:00+09'");
    for (var scope : DashboardProjection.Scope.values()) {
      long start = System.nanoTime();
      assertThat(projection.refresh(scope)).isTrue();
      System.out.printf(
          "DASHBOARD_BUILD scope=%s seconds=%.3f%n", scope, (System.nanoTime() - start) / 1e9);
    }
    assertThat(
            jdbc.queryForObject(
                "select sum(n)::bigint from ops.dashboard_model_counts", Long.class))
        .isEqualTo(690519);
    assertThat(
            jdbc.queryForObject("select sum(n)::bigint from ops.dashboard_case_counts", Long.class))
        .isEqualTo(40389);
    // Ensure planner statistics for the synthetic bulk load; do not flush database caches.
    for (String table :
        List.of(
            "ops.dashboard_case_items",
            "ops.dashboard_case_counts",
            "ops.dashboard_model_counts",
            "ops.dashboard_dirty")) jdbc.execute("analyze " + table);
    String password = UUID.randomUUID().toString();
    jdbc.update(
        "update core.users set password_hash=? where user_id=?", passwords.encode(password), user);
    try (var client =
        HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
            .connectTimeout(Duration.ofSeconds(3))
            .build()) {
      String base = "http://127.0.0.1:" + port;
      var csrf =
          json.readTree(
              client
                  .send(
                      HttpRequest.newBuilder(URI.create(base + "/api/auth/csrf")).GET().build(),
                      HttpResponse.BodyHandlers.ofString())
                  .body());
      var login =
          client.send(
              HttpRequest.newBuilder(URI.create(base + "/api/auth/login"))
                  .header(csrf.get("headerName").asString(), csrf.get("token").asString())
                  .header("Content-Type", "application/x-www-form-urlencoded")
                  .POST(HttpRequest.BodyPublishers.ofString("username=l1a&password=" + password))
                  .build(),
              HttpResponse.BodyHandlers.ofString());
      assertThat(login.statusCode()).isEqualTo(200);
      var request =
          HttpRequest.newBuilder(
                  URI.create(base + "/api/v1/dashboard/summary?from=2023-08-31&to=2023-09-10"))
              .timeout(Duration.ofSeconds(5))
              .GET()
              .build();
      var first = client.send(request, HttpResponse.BodyHandlers.ofString());
      assertThat(first.statusCode()).isEqualTo(200);
      assertThat(json.readTree(first.body()).at("/investigation/data/institution/alerts").asLong())
          .isEqualTo(40389);
      assertThat(first.body()).doesNotContain("activities", "oldestOpen", "priority");
      System.out.printf(
          "DASHBOARD_HTTP bytes=%d cases=40389 transactions=690519%n",
          first.body().getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
      try (var worker = new WorkerResource(new DashboardRefreshWorker(projection, 5000, true))) {
        worker.value.start();
        for (int screens : List.of(1, 10, 50)) {
          var elapsed = Collections.synchronizedList(new ArrayList<Double>());
          var errors = new ConcurrentHashMap<Integer, AtomicInteger>();
          var start = new CountDownLatch(1);
          try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var tasks = new ArrayList<Future<?>>();
            for (int screen = 0; screen < screens; screen++)
              tasks.add(
                  executor.submit(
                      () -> {
                        start.await();
                        long origin = System.nanoTime();
                        long stop = origin + TimeUnit.SECONDS.toNanos(8);
                        long next = origin;
                        while (System.nanoTime() < stop) {
                          long wait = next - System.nanoTime();
                          if (wait > 0) TimeUnit.NANOSECONDS.sleep(wait);
                          if (System.nanoTime() >= stop) break;
                          long began = System.nanoTime();
                          var response = client.send(request, HttpResponse.BodyHandlers.ofString());
                          if (response.statusCode() == 200)
                            elapsed.add((System.nanoTime() - began) / 1e9);
                          else
                            errors
                                .computeIfAbsent(
                                    response.statusCode(), ignored -> new AtomicInteger())
                                .incrementAndGet();
                          long now = System.nanoTime();
                          next =
                              origin
                                  + ((now - origin) / TimeUnit.SECONDS.toNanos(1) + 1)
                                      * TimeUnit.SECONDS.toNanos(1);
                        }
                        return null;
                      }));
            start.countDown();
            // A real source correction and a case assignment-time change while users poll.
            jdbc.update(
                "update ledger.transactions set integration_status=case when integration_status='ACTIVE' then 'HELD' else 'ACTIVE' end where tx_id=1");
            jdbc.update(
                "update review.alerts set assigned_at=assigned_at+interval '1 second' where alert_id=1");
            for (var task : tasks) task.get(15, TimeUnit.SECONDS);
          }
          elapsed.sort(Double::compareTo);
          assertThat(elapsed).isNotEmpty();
          double p95 = elapsed.get((int) Math.ceil(elapsed.size() * .95) - 1);
          System.out.printf(
              "DASHBOARD_HTTP screens=%d ok=%d errors=%s p50=%.3f p95=%.3f p99=%.3f max=%.3f%n",
              screens,
              elapsed.size(),
              errors,
              elapsed.get(elapsed.size() / 2),
              p95,
              elapsed.get((int) Math.ceil(elapsed.size() * .99) - 1),
              elapsed.getLast());
          if (screens <= 10) {
            assertThat(errors).isEmpty();
            assertThat(p95).isLessThan(1.0);
          }
        }
      }
    }
    for (var scope : DashboardProjection.Scope.values()) projection.refresh(scope);
    assertThat(jdbc.queryForObject("select count(*) from ops.dashboard_dirty", Long.class))
        .isZero();
    assertThat(
            jdbc.queryForObject(
                "select sum(n)::bigint from ops.dashboard_model_counts", Long.class))
        .isEqualTo(690518);
    assertThat(
            jdbc.queryForObject("select sum(n)::bigint from ops.dashboard_case_counts", Long.class))
        .isEqualTo(40389);
  }

  private record WorkerResource(DashboardRefreshWorker value) implements AutoCloseable {
    public void close() throws Exception {
      value.stop();
    }
  }
}
