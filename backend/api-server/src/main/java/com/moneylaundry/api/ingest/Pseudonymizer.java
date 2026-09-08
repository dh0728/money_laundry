package com.moneylaundry.api.ingest;

/**
 * 계좌 가명화 경계. 입력 키는 (은행, 계좌) 쌍이며 결정적이어야 한다(같은 계좌 = 날·은행 불문 같은 가명, kickoff §2.1). 규칙 정의는 Data, 구현은
 * BE(kickoff §4.5 17차) — Data 규칙 도착 전까지 항등.
 */
public interface Pseudonymizer {

  String pseudonymize(int bankId, String accountNumber);
}
