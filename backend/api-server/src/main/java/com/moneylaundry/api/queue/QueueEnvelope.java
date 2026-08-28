package com.moneylaundry.api.queue;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.moneylaundry.api.transaction.TransactionRequest;

/**
 * 관문(Java) → 수집 워커(Python) 큐 페이로드 계약 (§8 언어 경계 계약).
 *
 * 은행이 보낸 것({@code transaction})과 관문이 붙인 것(나머지)을 분리한다.
 * {@code payload_hash}는 이번 범위에서 계산하지 않으므로 항상 {@code null}이지만,
 * 키 자체는 직렬화 결과에 남아야 한다 — 클래스에 {@code @JsonInclude(NON_NULL)}을 붙이지 않는다.
 */
public record QueueEnvelope(
        @JsonProperty("ingest_id") String ingestId,
        @JsonProperty("payload_hash") String payloadHash,
        @JsonProperty("received_at") String receivedAt,
        @JsonProperty("transaction") TransactionRequest transaction) {
}
