package com.moneylaundry.api.ingest;

import java.math.BigDecimal;
import java.time.Instant;

/** 표준화된 민감 원문 입력. 로그/API에 직접 사용하지 않는다. */
public record TransactionRow(
    int fileRow,
    Instant occurredAt,
    int fromBank,
    String fromAccount,
    int toBank,
    String toAccount,
    BigDecimal amountReceived,
    String receivingCurrency,
    BigDecimal amountPaid,
    String paymentCurrency,
    String paymentFormat,
    Boolean isLaundering,
    String rowHash,
    String fromBankName,
    String toBankName,
    String fromEntityId,
    String fromEntityName,
    String toEntityId,
    String toEntityName) {
  @Override
  public String toString() {
    return "TransactionRow[redacted]";
  }
}
