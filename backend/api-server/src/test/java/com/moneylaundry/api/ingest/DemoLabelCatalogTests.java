package com.moneylaundry.api.ingest;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.*;
import java.time.ZoneId;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

class DemoLabelCatalogTests {
  @Test
  void externalDatasetAllRowsMatchCatalogWhenProvided() throws Exception {
    String directory = System.getenv("AML_DEMO_VERIFY_DIR");
    org.junit.jupiter.api.Assumptions.assumeTrue(directory != null);
    var catalog =
        new DemoLabelCatalog(
            "demo", new MockEnvironment().withProperty("spring.profiles.active", "local"));
    var jdbc = mock(JdbcTemplate.class);
    var matched = new java.util.concurrent.atomic.AtomicInteger();
    when(jdbc.batchUpdate(anyString(), org.mockito.ArgumentMatchers.<Object[]>anyList()))
        .thenAnswer(
            call -> {
              List<Object[]> arguments = call.getArgument(1);
              matched.addAndGet(arguments.size());
              return new int[arguments.size()];
            });
    int count = 0;
    try (var paths = java.nio.file.Files.walk(java.nio.file.Path.of(directory))) {
      for (var path : paths.filter(p -> p.toString().endsWith(".csv")).toList()) {
        try (var stream = java.nio.file.Files.newBufferedReader(path)) {
          var reader = new CsvTransactionReader(stream, ZoneId.of("Asia/Seoul"));
          var rows = new ArrayList<TransactionRow>();
          for (TransactionRow row; (row = reader.next()) != null; ) rows.add(row);
          count += rows.size();
          catalog.save(jdbc, 1, rows);
        }
      }
    }
    var manifest =
        new tools.jackson.databind.ObjectMapper()
            .readTree(
                java.nio.file.Files.readString(java.nio.file.Path.of(directory, "manifest.json")));
    assertThat(count).isEqualTo(manifest.get("report_rows").asInt());
    assertThat(matched.get()).isEqualTo(count);
  }

  static final String HEADER =
      "Timestamp,From Bank,From Account,To Bank,To Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,From Bank Name,To Bank Name,From Entity ID,From Entity Name,To Entity ID,To Entity Name,Is Laundering\n";
  static final String ROW =
      "2023/08/31 00:04,0119,811C597B0,0048309,811C599A0,34254.65,Saudi Riyal,34254.65,Saudi Riyal,ACH,Israel Bank #6,Saudi Arabia Bank #24,800F224C0,Partnership #3715,800F2F200,Sole Proprietorship #979,1\n";

  TransactionRow row(String value) throws Exception {
    return new CsvTransactionReader(
            new BufferedReader(new StringReader(HEADER + value)), ZoneId.of("Asia/Seoul"))
        .next();
  }

  @Test
  void realCsvNormalizationFindsCatalogAndMismatchFails() throws Exception {
    var catalog =
        new DemoLabelCatalog(
            "demo", new MockEnvironment().withProperty("spring.profiles.active", "dev"));
    var jdbc = mock(JdbcTemplate.class);
    catalog.save(jdbc, 42, List.of(row(ROW)));
    var captor = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(jdbc).batchUpdate(contains("evaluation.demo_report_hints"), captor.capture());
    assertThat((Object[]) captor.getValue().getFirst()).containsExactly(true, 3, 42L, 2);
    assertThatThrownBy(() -> catalog.save(jdbc, 42, List.of(row(ROW.replace(",1\n", ",0\n")))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("DEMO_LABEL_MISMATCH");
  }

  @Test
  void prodAndNonDemoCannotPublishLabelHints() throws Exception {
    for (var values :
        List.of(
            new String[] {"demo", "prod"},
            new String[] {"real", "dev"},
            new String[] {"demo", "dev,prod"})) {
      var catalog =
          new DemoLabelCatalog(
              values[0], new MockEnvironment().withProperty("spring.profiles.active", values[1]));
      var jdbc = mock(JdbcTemplate.class);
      catalog.save(jdbc, 1, List.of(row(ROW)));
      verifyNoInteractions(jdbc);
    }
  }

  @Test
  void unrelatedTransactionDoesNotAcquireFixtureType() throws Exception {
    var catalog =
        new DemoLabelCatalog(
            "demo", new MockEnvironment().withProperty("spring.profiles.active", "local"));
    var jdbc = mock(JdbcTemplate.class);
    catalog.save(jdbc, 1, List.of(row(ROW.replace("34254.65", "34254.66"))));
    verifyNoInteractions(jdbc);
  }
}
