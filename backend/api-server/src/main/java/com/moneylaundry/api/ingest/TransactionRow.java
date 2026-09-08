package com.moneylaundry.api.ingest;

import java.math.BigDecimal;
import java.time.Instant;

/** 표준화·가명화가 끝난 원장 입력 행(API.md §1.4). rowHash는 아래 값 전체의 SHA-256. */
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
    String rowHash) {}
