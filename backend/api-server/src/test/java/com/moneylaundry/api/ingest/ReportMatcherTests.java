package com.moneylaundry.api.ingest;

import static org.assertj.core.api.Assertions.*;

import java.io.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ReportMatcherTests {
  static final String HEADER =
      "Timestamp,From Bank,From Account,To Bank,To Account,Amount Received,Receiving"
          + " Currency,Amount Paid,Payment Currency,Payment Format,From Bank Name,To Bank Name,From"
          + " Entity ID,From Entity Name,To Entity ID,To Entity Name\n";

  static TransactionRow row(String format) throws Exception {
    return read("2026/09/15 12:00,10,001,20,001,100,US Dollar,100,US Dollar,"
            + format
            + ",Bank10,Bank20,E1,Alice,E2,Bob\n")
        .next();
  }

  static CsvTransactionReader read(String body) throws Exception {
    return new CsvTransactionReader(
        new BufferedReader(new StringReader(HEADER + body)), ZoneId.of("Asia/Seoul"));
  }

  @Test
  void format_priority_and_repeated_occurrences_ignore_hash_collisions() throws Exception {
    var ach = row("ACH");
    var wire = row("Wire");
    // Deliberately identical content hashes must not join different exact fields.
    var changed =
        new TransactionRow(
            2,
            ach.occurredAt().plusSeconds(1),
            10,
            "001",
            20,
            "001",
            ach.amountReceived(),
            "USD",
            ach.amountPaid(),
            "USD",
            "ACH",
            null,
            ach.rowHash(),
            "Bank10",
            "Bank20",
            "E1",
            "Alice",
            "E2",
            "Bob");
    var reports =
        List.of(
            new ReportMatcher.Report(1, 1, 10, ach),
            new ReportMatcher.Report(2, 1, 10, wire),
            new ReportMatcher.Report(3, 1, 10, ach),
            new ReportMatcher.Report(4, 2, 20, wire),
            new ReportMatcher.Report(5, 2, 20, ach),
            new ReportMatcher.Report(6, 2, 20, ach));
    var result = ReportMatcher.match(reports, Set.of(10, 20), Set.of(), Set.of());
    assertThat(result.matches()).hasSize(3);
    assertThat(result.heldVersions()).isEmpty();
    assertThat(result.matches())
        .allMatch(m -> m.first().row().paymentFormat().equals(m.second().row().paymentFormat()));
    var mismatch =
        ReportMatcher.match(
            List.of(
                new ReportMatcher.Report(1, 1, 10, ach),
                new ReportMatcher.Report(2, 2, 20, changed)),
            Set.of(10, 20),
            Set.of(),
            Set.of());
    assertThat(mismatch.matches()).isEmpty();
    assertThat(mismatch.heldVersions()).containsExactlyInAnyOrder(1L, 2L);
  }

  @Test
  void quoted_fields_bom_and_physical_line_numbers() throws Exception {
    for (String newline : List.of("\n", "\r\n", "\r")) {
      String first =
          "2026/09/15 12:00,10,001,20,001,1,US Dollar,1,US Dollar,ACH,Bank10,Bank20,E1,\"Alice,"
              + " \"\"A\"\""
              + newline
              + "next\",E2,Bob"
              + newline;
      var reader =
          read(
              first
                  + "2026/09/15 12:00,10,001,20,001,1,US Dollar,1,US"
                  + " Dollar,ACH,Bank10,Bank20,E1,Alice,E2,Bob\n");
      assertThat(reader.next().fromEntityName()).contains("Alice, \"A\"");
      assertThat(reader.next().fileRow()).isEqualTo(4);
    }
    var bom =
        new CsvTransactionReader(
            new BufferedReader(
                new StringReader(
                    "\uFEFF"
                        + HEADER
                        + "2026/09/15 12:00,10,001,20,001,1,US Dollar,1,US"
                        + " Dollar,ACH,Bank10,Bank20,E1,Alice,E2,Bob\n")),
            ZoneId.of("Asia/Seoul"));
    assertThat(bom.next().fromAccount()).isEqualTo("001");
  }

  @Test
  void duplicate_headers_and_malformed_quoting_fail() {
    assertThatThrownBy(
            () ->
                new CsvTransactionReader(
                    new BufferedReader(new StringReader(HEADER.strip() + ",Timestamp\n")),
                    ZoneId.of("Asia/Seoul")))
        .isInstanceOf(ValidationFailedException.class);
    assertThatThrownBy(() -> read("\"unterminated").next())
        .isInstanceOf(CsvTransactionReader.RowException.class);
    assertThatThrownBy(() -> read("ab\"cd\n").next())
        .isInstanceOf(CsvTransactionReader.RowException.class);
  }

  @Test
  void direct_held_does_not_spread_to_independent_counterparty_rows() throws Exception {
    var ab = row("ACH");
    var bc =
        new TransactionRow(
            3,
            ab.occurredAt(),
            20,
            "001",
            30,
            "C",
            ab.amountReceived(),
            "USD",
            ab.amountPaid(),
            "USD",
            "ACH",
            null,
            "same",
            "Bank20",
            "Bank30",
            "E2",
            "Bob",
            "E3",
            "Carol");
    var reports =
        List.of(
            new ReportMatcher.Report(1, 1, 10, ab),
            new ReportMatcher.Report(2, 2, 20, ab),
            new ReportMatcher.Report(3, 2, 20, bc),
            new ReportMatcher.Report(4, 3, 30, bc));
    for (var ordering : List.of(reports, reports.reversed())) {
      var result = ReportMatcher.match(ordering, Set.of(10, 20, 30), Set.of(1L), Set.of(10));
      assertThat(result.matches()).hasSize(1);
      assertThat(result.heldVersions()).containsExactly(1L);
      assertThat(result.dependencyReports()).containsExactly(2L);
    }
  }

  @Test
  void multiplicity_mismatch_holds_source_file_and_matched_counterpart_is_dependent()
      throws Exception {
    var a = row("ACH");
    var reports =
        List.of(
            new ReportMatcher.Report(1, 1, 10, a),
            new ReportMatcher.Report(2, 1, 10, a),
            new ReportMatcher.Report(3, 2, 20, a));
    for (var order : List.of(reports, reports.reversed())) {
      var result = ReportMatcher.match(order, Set.of(10, 20), Set.of(), Set.of());
      assertThat(result.matches()).isEmpty();
      assertThat(result.heldVersions()).containsExactly(1L);
      assertThat(result.dependencyReports()).containsExactly(3L);
      assertThat(result.reasons().get(1L)).isEqualTo("COUNTERPART_MISSING");
    }
  }

  @Test
  void internal_and_outside_scope_rows_preserve_each_occurrence() throws Exception {
    var a = row("ACH");
    var internal =
        new TransactionRow(
            2,
            a.occurredAt(),
            10,
            "001",
            10,
            "002",
            a.amountReceived(),
            "USD",
            a.amountPaid(),
            "USD",
            "ACH",
            null,
            "same",
            "Bank10",
            "Bank10",
            "E1",
            "Alice",
            "E2",
            "Bob");
    var result =
        ReportMatcher.match(
            List.of(
                new ReportMatcher.Report(1, 1, 10, internal),
                new ReportMatcher.Report(2, 1, 10, internal),
                new ReportMatcher.Report(3, 1, 10, a)),
            Set.of(10),
            Set.of(),
            Set.of());
    assertThat(result.matches()).hasSize(3);
    assertThat(result.heldVersions()).isEmpty();
  }

  @Test
  void format_mismatch_and_identity_conflicts_have_explicit_reasons() throws Exception {
    var result =
        ReportMatcher.match(
            List.of(
                new ReportMatcher.Report(1, 1, 10, row("ACH")),
                new ReportMatcher.Report(2, 2, 20, row("Wire"))),
            Set.of(10, 20),
            Set.of(),
            Set.of());
    assertThat(result.matches()).isEmpty();
    assertThat(result.reasons().values()).containsOnly("PAYMENT_FORMAT_CONFLICT");
    var a = row("ACH");
    var changed =
        new TransactionRow(
            2,
            a.occurredAt(),
            10,
            "001",
            20,
            "001",
            a.amountReceived(),
            "USD",
            a.amountPaid(),
            "USD",
            "ACH",
            null,
            a.rowHash(),
            "Bank10",
            "Bank20",
            "E1",
            "Other",
            "E2",
            "Bob");
    assertThat(
            ReportMatcher.identityConflicts(
                List.of(
                    new ReportMatcher.Report(1, 1, 10, a),
                    new ReportMatcher.Report(2, 2, 20, changed))))
        .containsExactlyInAnyOrder(1L, 2L);
  }
}
