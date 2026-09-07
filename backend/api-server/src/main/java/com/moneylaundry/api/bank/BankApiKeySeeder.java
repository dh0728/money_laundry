package com.moneylaundry.api.bank;

import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * MVP 보고 은행 시드(API.md §1.1): 환경변수 BANK_API_KEYS="70:키,12:키" 를 기동 때 upsert — is_reporting 켜고 키 해시
 * 저장. 이름·국가는 참조 리소스에서. ADMIN 은행 등록·키 발급 API는 10월 [업로드].
 */
@Slf4j
@Component
public class BankApiKeySeeder implements ApplicationRunner {

  private final BankRepository bankRepository;
  private final BankReference bankReference;
  private final String apiKeys;

  public BankApiKeySeeder(
      BankRepository bankRepository,
      BankReference bankReference,
      @Value("${app.bank.api-keys}") String apiKeys) {
    this.bankRepository = bankRepository;
    this.bankReference = bankReference;
    this.apiKeys = apiKeys;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    if (apiKeys == null || apiKeys.isBlank()) {
      log.warn("보고 은행 시드 없음(BANK_API_KEYS 비어 있음) — 은행 수집 API는 401만 돌려준다");
      return;
    }
    Instant now = Instant.now();
    int seeded = 0;
    for (String entry : apiKeys.split(",")) {
      String[] parts = entry.trim().split(":", 2);
      if (parts.length != 2 || parts[1].isBlank()) {
        throw new IllegalArgumentException("BANK_API_KEYS 항목 형식은 bankId:key — " + entry);
      }
      int bankId = Integer.parseInt(parts[0].trim());
      Bank bank =
          bankRepository
              .findById(bankId)
              .orElseGet(
                  () -> {
                    BankReference.Entry ref = bankReference.find(bankId).orElse(null);
                    return Bank.of(
                        bankId,
                        ref == null ? null : ref.name(),
                        ref == null ? null : ref.country(),
                        now);
                  });
      bank.setReporting(true);
      bank.setApiKeyHash(ApiKeys.hash(parts[1].trim()));
      bank.setUpdatedAt(now);
      bankRepository.save(bank);
      seeded++;
    }
    log.info("보고 은행 시드 {}곳", seeded);
  }
}
