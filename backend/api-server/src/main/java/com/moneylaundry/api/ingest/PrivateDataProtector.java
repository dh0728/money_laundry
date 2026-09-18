package com.moneylaundry.api.ingest;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Keys are supplied externally; no fallback key or identity mapping exists. */
@Component
public class PrivateDataProtector {
  private final String encryptionKey;
  private final String searchKey;
  private final String version;
  private final SecureRandom random = new SecureRandom();

  public PrivateDataProtector(
      @Value("${app.ingest.encryption-key:}") String encryptionKey,
      @Value("${app.ingest.search-key:}") String searchKey,
      @Value("${app.ingest.key-version:}") String version) {
    this.encryptionKey = encryptionKey;
    this.searchKey = searchKey;
    this.version = version;
  }

  public String version() {
    requireKeys();
    return version;
  }

  private byte[] key(String encoded) {
    try {
      byte[] key = Base64.getDecoder().decode(encoded);
      if (key.length == 32) return key;
    } catch (IllegalArgumentException ignored) {
    }
    throw new IllegalStateException("PRIVATE_DATA_KEY_INVALID");
  }

  public void requireKeys() {
    if (version.isBlank()
        || java.security.MessageDigest.isEqual(key(encryptionKey), key(searchKey)))
      throw new IllegalStateException("PRIVATE_DATA_KEYS_REQUIRED");
    key(encryptionKey);
    key(searchKey);
  }

  private byte[] framed(String... values) {
    var out = new java.io.ByteArrayOutputStream();
    for (String value : values) {
      byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
      out.writeBytes(ByteBuffer.allocate(4).putInt(bytes.length).array());
      out.writeBytes(bytes);
    }
    return out.toByteArray();
  }

  public String token(String purpose, String... values) {
    requireKeys();
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key(searchKey), "HmacSHA256"));
      mac.update(framed(purpose));
      return HexFormat.of().formatHex(mac.doFinal(framed(values)));
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException("PRIVATE_TOKEN_FAILED", e);
    }
  }

  public String encrypt(String purpose, String plaintext) {
    requireKeys();
    try {
      byte[] iv = new byte[12];
      random.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.ENCRYPT_MODE,
          new SecretKeySpec(key(encryptionKey), "AES"),
          new GCMParameterSpec(128, iv));
      cipher.updateAAD(framed(version, purpose));
      byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
      return Base64.getEncoder()
          .encodeToString(
              ByteBuffer.allocate(12 + encrypted.length).put(iv).put(encrypted).array());
    } catch (java.security.GeneralSecurityException e) {
      throw new IllegalStateException("PRIVATE_ENCRYPT_FAILED");
    }
  }

  public String decrypt(String purpose, String stored, String keyVersion) {
    requireKeys();
    if (!version.equals(keyVersion))
      throw new IllegalStateException("PRIVATE_KEY_VERSION_MISMATCH");
    try {
      byte[] encoded = Base64.getDecoder().decode(stored);
      if (encoded.length < 28) throw new IllegalArgumentException();
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key(encryptionKey), "AES"),
          new GCMParameterSpec(128, encoded, 0, 12));
      cipher.updateAAD(framed(version, purpose));
      return new String(cipher.doFinal(encoded, 12, encoded.length - 12), StandardCharsets.UTF_8);
    } catch (java.security.GeneralSecurityException | IllegalArgumentException e) {
      throw new IllegalStateException("PRIVATE_DATA_AUTHENTICATION_FAILED");
    }
  }
}
