package com.moneylaundry.api.transaction;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

/**
 * 은행(생성기)이 보내는 거래 1건. 11개 키 모두 문자열이다 — 은행 코드에 선행 0이 있어
 * 숫자로 바인딩하면 값이 깨진다. timestamp도 원본 형식(비 ISO-8601)이라 문자열로만 받는다.
 *
 * 계약에 없는 키는 무시한다({@code @JsonIgnoreProperties}) — 미지 키는 400이 아니다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TransactionRequest(
        @JsonProperty("transaction_id") @NotBlank String transactionId,
        @JsonProperty("timestamp") @NotBlank String timestamp,
        @JsonProperty("from_bank") @NotBlank String fromBank,
        @JsonProperty("from_account") @NotBlank String fromAccount,
        @JsonProperty("to_bank") @NotBlank String toBank,
        @JsonProperty("to_account") @NotBlank String toAccount,
        @JsonProperty("amount_received") @NotBlank String amountReceived,
        @JsonProperty("receiving_currency") @NotBlank String receivingCurrency,
        @JsonProperty("amount_paid") @NotBlank String amountPaid,
        @JsonProperty("payment_currency") @NotBlank String paymentCurrency,
        @JsonProperty("payment_format") @NotBlank String paymentFormat) {
}
