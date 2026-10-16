package com.moneylaundry.api.analysis;

import java.net.http.HttpClient;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/** Trust only the configured CA bundle for this inference client; leave S3/JVM trust alone. */
final class InferenceTls {
  private InferenceTls() {}

  static HttpClient client(String caFile) {
    try (var input = Files.newInputStream(Path.of(caFile))) {
      var certificates = CertificateFactory.getInstance("X.509").generateCertificates(input);
      if (certificates.isEmpty()) throw new IllegalArgumentException();
      var store = KeyStore.getInstance(KeyStore.getDefaultType());
      store.load(null, null);
      int index = 0;
      for (var certificate : certificates) {
        var ca = (X509Certificate) certificate;
        ca.checkValidity();
        if (ca.getBasicConstraints() < 0) throw new IllegalArgumentException();
        store.setCertificateEntry("inference-ca-" + index++, ca);
      }
      var managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
      managers.init(store);
      var context = SSLContext.getInstance("TLS");
      context.init(null, managers.getTrustManagers(), null);
      return HttpClient.newBuilder()
          .connectTimeout(Duration.ofSeconds(5))
          .followRedirects(HttpClient.Redirect.NEVER)
          .sslContext(context)
          .build();
    } catch (Exception error) {
      throw new IllegalArgumentException("INVALID_INFERENCE_CA_CONFIGURATION");
    }
  }
}
