package com.moneylaundry.api.bank;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BankRepository extends JpaRepository<Bank, Integer> {

  Optional<Bank> findByApiKeyHash(String apiKeyHash);

  List<Bank> findByReportingTrueOrderById();
}
