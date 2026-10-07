package com.moneylaundry.api.ingest;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import org.junit.jupiter.api.Test;

class PrivateDataProtectorTests {
  @Test
  void java_cipher_is_readable_by_python_and_python_reply_by_java() throws Exception {
    String python = System.getenv("AML_TEST_PYTHON");
    org.junit.jupiter.api.Assumptions.assumeTrue(python != null);
    String encryption = Base64.getEncoder().encodeToString(new byte[32]);
    byte[] searchBytes = new byte[32];
    Arrays.fill(searchBytes, (byte) 1);
    String search = Base64.getEncoder().encodeToString(searchBytes);
    var p = new PrivateDataProtector(encryption, search, "interop");
    var process =
        new ProcessBuilder(
                python,
                "-c",
                """
        import sys
        from private_data import PrivateDataProtector
        p = PrivateDataProtector(sys.argv[1], sys.argv[2], 'interop')
        value = p.decrypt('entity-name', sys.stdin.readline().strip(), 'interop')
        print(p.encrypt('entity-name', value))
        """,
                encryption,
                search)
            .directory(new java.io.File("worker"))
            .start();
    try {
      try (var input = process.getOutputStream()) {
        input.write(
            (p.encrypt("entity-name", "민감 원문") + "\n")
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
      assertThat(process.waitFor(15, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
      assertThat(process.exitValue()).isZero();
      String reply =
          new String(
                  process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)
              .trim();
      assertThat(p.decrypt("entity-name", reply, "interop")).isEqualTo("민감 원문");
    } finally {
      if (process.isAlive()) process.destroyForcibly();
    }
  }

  @Test
  void python_cipher_and_token_are_compatible() {
    byte[] encryption = new byte[32], search = new byte[32];
    for (int i = 0; i < 32; i++) {
      encryption[i] = (byte) i;
      search[i] = (byte) (i + 32);
    }
    var p =
        new PrivateDataProtector(
            Base64.getEncoder().encodeToString(encryption),
            Base64.getEncoder().encodeToString(search),
            "test-v1");
    assertThat(
            p.decrypt(
                "entity-name",
                "IONO38yAReh/kF1igMaUAs221tqMWKkxvAdjUtGHzW7tQO+M0sIOuXE=",
                "test-v1"))
        .isEqualTo("민감 원문");
    assertThat(p.token("account", "12", "001234"))
        .isEqualTo("9c8c56c5626b12ffe857dce4b514197c51b6db3779c14389b75d92e07c2f4f5b");
  }

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
