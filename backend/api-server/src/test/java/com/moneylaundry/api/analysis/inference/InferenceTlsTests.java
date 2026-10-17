package com.moneylaundry.api.analysis.inference;

import static org.assertj.core.api.Assertions.*;

import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;

class InferenceTlsTests {
  @TempDir Path directory;

  @Test
  void cancellation_and_observation_use_scoped_ca_and_reject_wrong_identity() throws Exception {
    Path storeFile = directory.resolve("server.p12");
    Path caFile = directory.resolve("ca.crt");
    String keytool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString();
    var generated =
        new ProcessBuilder(
                keytool,
                "-genkeypair",
                "-alias",
                "test",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-dname",
                "CN=Ephemeral Test",
                "-validity",
                "2",
                "-ext",
                "bc:c=ca:true",
                "-ext",
                "SAN=ip:127.0.0.1",
                "-keystore",
                storeFile.toString(),
                "-storetype",
                "PKCS12",
                "-storepass",
                "synthetic-test-only",
                "-noprompt")
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .start();
    assertThat(generated.waitFor()).isZero();
    var store = KeyStore.getInstance("PKCS12");
    try (var input = Files.newInputStream(storeFile)) {
      store.load(input, "synthetic-test-only".toCharArray());
    }
    String pem =
        "-----BEGIN CERTIFICATE-----\n"
            + java.util.Base64.getMimeEncoder(64, new byte[] {'\n'})
                .encodeToString(store.getCertificate("test").getEncoded())
            + "\n-----END CERTIFICATE-----\n";
    Files.writeString(caFile, pem);
    var keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keys.init(store, "synthetic-test-only".toCharArray());
    var context = SSLContext.getInstance("TLS");
    context.init(keys.getKeyManagers(), null, null);
    var server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setHttpsConfigurator(new HttpsConfigurator(context));
    var mapper = new ObjectMapper();
    UUID cancel = UUID.randomUUID();
    var payload =
        mapper
            .createObjectNode()
            .put("contract_version", 2)
            .put("job_id", 1)
            .put("run_id", UUID.randomUUID().toString())
            .put("request_id", UUID.randomUUID().toString())
            .put("execution_round", 1)
            .put("model_kind", "BINARY")
            .put("cancel_id", cancel.toString());
    var reply = payload.deepCopy().put("status", "STOPPED").put("cancellation_status", "STOPPED");
    List<String> methods = new ArrayList<>();
    server.createContext(
        "/",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          methods.add(exchange.getRequestMethod());
          boolean authorized =
              ("Bearer " + "x".repeat(32))
                  .equals(exchange.getRequestHeaders().getFirst("Authorization"));
          byte[] response = mapper.writeValueAsBytes(reply);
          exchange.sendResponseHeaders(authorized ? 200 : 401, response.length);
          try (var output = exchange.getResponseBody()) {
            output.write(response);
          }
        });
    server.start();
    try {
      String base = "https://127.0.0.1:" + server.getAddress().getPort();
      var client = new InferenceCancellationClient(mapper);
      client.configure(base, "x".repeat(32), false, caFile.toString());
      client.publish(cancel, mapper.writeValueAsString(payload));
      assertThat(client.acknowledgement(cancel, mapper.writeValueAsString(payload)))
          .isEqualTo("STOPPED");
      assertThat(methods).containsExactly("PUT", "GET");
      // Trusted CA alone must not bypass IP/DNS identity checking.
      var wrongHost =
          HttpRequest.newBuilder(URI.create("https://localhost:" + server.getAddress().getPort()))
              .timeout(Duration.ofSeconds(5))
              .build();
      try (var scoped = InferenceTls.client(caFile.toString())) {
        assertThatThrownBy(() -> scoped.send(wrongHost, HttpResponse.BodyHandlers.discarding()))
            .isInstanceOf(javax.net.ssl.SSLHandshakeException.class);
      }
      try (var untrusted = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()) {
        var request =
            HttpRequest.newBuilder(URI.create(base)).timeout(Duration.ofSeconds(5)).build();
        assertThatThrownBy(() -> untrusted.send(request, HttpResponse.BodyHandlers.discarding()))
            .isInstanceOf(javax.net.ssl.SSLHandshakeException.class);
      }
    } finally {
      server.stop(0);
    }
  }

  @Test
  void missing_or_empty_ca_fails_closed() throws Exception {
    Path empty = directory.resolve("empty.crt");
    Files.writeString(empty, "");
    for (Path ca : List.of(empty, directory.resolve("missing.crt"))) {
      assertThatThrownBy(() -> InferenceTls.client(ca.toString()))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("INVALID_INFERENCE_CA_CONFIGURATION");
    }
  }
}
