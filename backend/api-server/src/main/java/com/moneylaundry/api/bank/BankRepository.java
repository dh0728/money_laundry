package com.moneylaundry.api.bank;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** core.banks JPA 저장소: 은행 행 잠금과 보고 은행 목록 조회. */
public interface BankRepository extends JpaRepository<Bank, Integer> {

  @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
  @org.springframework.data.jpa.repository.Query("select b from Bank b where b.id = :id")
  Optional<Bank> lockById(int id);

  List<Bank> findByReportingTrueOrderById();
}
