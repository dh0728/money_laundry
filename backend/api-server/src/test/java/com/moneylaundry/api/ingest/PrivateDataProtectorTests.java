package com.moneylaundry.api.ingest;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class PrivateDataProtectorTests {
  static PrivateDataProtector protector() {
    byte[] a = new byte[32], b = new byte[32];
    new java.security.SecureRandom().nextBytes(a);
    new java.security.SecureRandom().nextBytes(b);
    return new PrivateDataProtector(
        Base64.getEncoder().encodeToString(a), Base64.getEncoder().encodeToString(b), "test");
  }

  @Test
  void authenticated_cipher_and_separated_tokens() {
    var p = protector();
    String a = p.encrypt("entity", "민감 원문"), b = p.encrypt("entity", "민감 원문");
    assertThat(a).isNotEqualTo(b).doesNotContain("민감");
    assertThat(p.decrypt("entity", a, "test")).isEqualTo("민감 원문");
    assertThatThrownBy(() -> p.decrypt("account", a, "test"))
        .isInstanceOf(IllegalStateException.class);
    byte[] changed = Base64.getDecoder().decode(a);
    changed[20] ^= 1;
    assertThatThrownBy(
            () -> p.decrypt("entity", Base64.getEncoder().encodeToString(changed), "test"))
        .isInstanceOf(IllegalStateException.class);
    assertThat(p.token("entity", "ab", "c"))
        .isNotEqualTo(p.token("entity", "a", "bc"))
        .isNotEqualTo(p.token("account", "ab", "c"));
  }

  @Test
  void no_keys_or_equal_decoded_keys_fail_closed() {
    assertThatThrownBy(() -> new PrivateDataProtector("", "", "test").encrypt("a", "b"))
        .isInstanceOf(IllegalStateException.class);
    byte[] key = new byte[32];
    new java.security.SecureRandom().nextBytes(key);
    assertThatThrownBy(
            () ->
                new PrivateDataProtector(
                        Base64.getEncoder().encodeToString(key),
                        Base64.getEncoder().withoutPadding().encodeToString(key),
                        "test")
                    .requireKeys())
        .isInstanceOf(IllegalStateException.class);
  }
}
