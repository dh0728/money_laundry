package com.moneylaundry.api.suspicioustx;

import java.util.List;

/** 파일 기반 W1 초안 — 필드 확정은 [API 계약]에서. W2에서 DB 조회로 교체. */
public record SuspiciousTransactionResponse(
    String uploadId,
    int txRow,
    double anomalyScore,
    double typeScore,
    int typeClass,
    List<String> ruleHits) {}
