package com.moneylaundry.api.ingest;

import org.springframework.stereotype.Component;

/** 항등 가명화 자리(Data 규칙 미도착). */
@Component
public class IdentityPseudonymizer implements Pseudonymizer {

  @Override
  public String pseudonymize(int bankId, String accountNumber) {
    return accountNumber;
  }
}
