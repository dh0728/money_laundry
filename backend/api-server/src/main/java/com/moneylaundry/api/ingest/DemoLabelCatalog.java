package com.moneylaundry.api.ingest;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Explicit synthetic dataset annotations; never used for a real model's input. */
@Component
public class DemoLabelCatalog {
  private record Hint(boolean label, int type) {}

  private final Map<String, Hint> hints = new HashMap<>();

  public DemoLabelCatalog(
      @Value("${app.worker.mode:unconfigured}") String mode, Environment environment)
      throws IOException {
    var profiles = Set.of(environment.getActiveProfiles());
    if (!mode.equals("demo")
        || profiles.contains("prod")
        || Collections.disjoint(profiles, Set.of("local", "dev"))) return;
    try (var reader =
        new BufferedReader(
            new InputStreamReader(
                new ClassPathResource("demo/pattern5-2023-v1.csv").getInputStream(),
                StandardCharsets.UTF_8))) {
      if (!"row_hash,is_laundering,type_code".equals(reader.readLine()))
        throw new IOException("Invalid demo catalog");
      for (String line; (line = reader.readLine()) != null; ) {
        var parts = line.split(",");
        if (parts.length != 3
            || !parts[0].matches("[0-9a-f]{64}")
            || !parts[1].matches("[01]")
            || !parts[2].matches("[0-8]")) throw new IOException("Invalid demo catalog");
        var hint = new Hint(parts[1].equals("1"), Integer.parseInt(parts[2]));
        if ((!hint.label() && hint.type() != 0) || hints.putIfAbsent(parts[0], hint) != null)
          throw new IOException("Conflicting demo catalog");
      }
    }
  }

  public void save(JdbcTemplate jdbc, long version, List<TransactionRow> rows) {
    var args = new ArrayList<Object[]>();
    for (var row : rows) {
      var hint = hints.get(row.rowHash());
      if (hint == null) continue;
      if (!Objects.equals(row.isLaundering(), hint.label()))
        throw new IllegalArgumentException("DEMO_LABEL_MISMATCH");
      args.add(new Object[] {hint.label(), hint.type(), version, row.fileRow()});
    }
    if (!args.isEmpty())
      jdbc.batchUpdate(
          "insert into evaluation.demo_report_hints(report_id,dataset_version,is_laundering,type_code) "
              + "select report_id,'pattern5-2023-v1',?,? from private.bank_reports where version_id=? and source_row=?",
          args);
  }
}
