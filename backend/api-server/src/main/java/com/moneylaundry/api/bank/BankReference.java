package com.moneylaundry.api.bank;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * 은행 코드 → 이름·국가 참조(리소스 ingest/banks_hi_small.csv — HI-Small 재생 전용, kickoff §4.5 17차). 없는 코드는 empty
 * → 이름 null로 upsert.
 */
@Component
public class BankReference {

  public record Entry(String name, String country) {}

  private final Map<Integer, Entry> entries = new HashMap<>();

  public BankReference() {
    try (BufferedReader reader =
        new BufferedReader(
            new InputStreamReader(
                new ClassPathResource("ingest/banks_hi_small.csv").getInputStream(),
                StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (line.startsWith("#") || line.startsWith("bank_id,")) {
          continue;
        }
        String[] cols = line.split(",", -1);
        String country = cols[2].isBlank() ? null : cols[2];
        entries.put(Integer.parseInt(cols[0]), new Entry(cols[1], country));
      }
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  public Optional<Entry> find(int bankId) {
    return Optional.ofNullable(entries.get(bankId));
  }

  public int size() {
    return entries.size();
  }
}
