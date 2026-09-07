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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** banks 한 행(V1). 원장에 등장하는 모든 은행 코드가 들어오고, 보고 은행만 is_reporting·api_key_hash를 가진다. */
@Entity
@Table(name = "banks")
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

  @JdbcTypeCode(SqlTypes.CHAR)
  @Column(name = "api_key_hash")
  private String apiKeyHash;

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
