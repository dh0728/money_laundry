package com.moneylaundry.api.bank;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** core.banks의 은행 참조 정보. 보고 은행은 is_reporting으로 구분한다. */
@Entity
@Table(name = "banks", schema = "core")
@Getter
@Setter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Bank {

  @Id
  @Column(name = "bank_id")
  private Integer id;

  private String name;

  private String country;

  @Column(name = "is_reporting", nullable = false)
  private boolean reporting;

  @Column(name = "created_at", nullable = false)
  private Instant createdAt;

  @Column(name = "updated_at", nullable = false)
  private Instant updatedAt;

  public static Bank of(int id, String name, String country, Instant now) {
    Bank bank = new Bank();
    bank.id = id;
    bank.name = name;
    bank.country = country;
    bank.createdAt = now;
    bank.updatedAt = now;
    return bank;
  }
}
