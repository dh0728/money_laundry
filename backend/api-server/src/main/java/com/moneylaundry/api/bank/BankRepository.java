package com.moneylaundry.api.bank;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BankRepository extends JpaRepository<Bank, Integer> {

  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select b from Bank b where b.id = :id")
  Optional<Bank> lockById(int id);

  List<Bank> findByReportingTrueOrderById();
}
