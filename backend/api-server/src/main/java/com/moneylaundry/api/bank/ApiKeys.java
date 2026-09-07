package com.moneylaundry.api.bank;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** 은행 API 키는 원문을 저장하지 않고 SHA-256 hex(64자)만 banks.api_key_hash에 둔다(API.md §1.1). */
public final class ApiKeys {

  private ApiKeys() {}

  public static String hash(String apiKey) {
    try {
      byte[] digest =
          MessageDigest.getInstance("SHA-256").digest(apiKey.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(digest);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
