package com.moneylaundry.api.analysis;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Direct cancellation control; the durable outbox remains the retry owner. */
final class InferenceCancellationClient {
  private final ObjectMapper mapper;
  private final HttpClient client;
  private String base = "", token;

  InferenceCancellationClient(ObjectMapper mapper) {
    this(
        mapper,
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build());
  }

  InferenceCancellationClient(ObjectMapper mapper, HttpClient client) {
    this.mapper = mapper;
    this.client = client;
  }

  void configure(String url, String token) {
    if (url.isBlank() && token.isBlank()) return;
    URI uri;
    try {
      uri = URI.create(url);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("INVALID_INFERENCE_CONFIGURATION");
    }
    if (!"https".equals(uri.getScheme())
        || uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getQuery() != null
        || uri.getFragment() != null
        || token.length() < 32
        || token.chars().anyMatch(c -> c <= 32 || c >= 127))
      throw new IllegalArgumentException("INVALID_INFERENCE_CONFIGURATION");
    base = url.replaceAll("/+$", "");
    this.token = token;
  }

  boolean enabled() {
    return !base.isEmpty();
  }

  private JsonNode expected(UUID cancel, String payload) {
    var node = mapper.readTree(payload);
    if (!cancel.toString().equals(node.path("cancel_id").asString())
        || node.path("contract_version").asInt() != 2
        || !node.path("execution_round").isIntegralNumber()
        || node.path("execution_round").asLong() < 1
        || node.path("execution_round").asLong() > Integer.MAX_VALUE)
      throw new IllegalArgumentException("CANCEL_IDENTITY_MISMATCH");
    return node;
  }

  private JsonNode exchange(JsonNode expected, String payload) {
    String path =
        base
            + "/api/v1/inference-requests/"
            + UUID.fromString(expected.path("request_id").asString())
            + "/rounds/"
            + expected.path("execution_round").asInt();
    var request =
        HttpRequest.newBuilder(URI.create(path + (payload == null ? "" : "/cancellation")))
            .timeout(Duration.ofSeconds(10))
            .header("Authorization", "Bearer " + token)
            .header("Accept", "application/json");
    if (payload == null) request.GET();
    else
      request
          .header("Content-Type", "application/json")
          .PUT(HttpRequest.BodyPublishers.ofString(payload));
    try {
      var response = client.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
      if (payload == null && response.statusCode() == 404) return null;
      if (response.statusCode() != 200 && !(payload != null && response.statusCode() == 202))
        throw new IllegalStateException("INFERENCE_CONTROL_FAILED");
      if (response.body().length > 65536)
        throw new IllegalStateException("INFERENCE_CONTROL_FAILED");
      return mapper.readTree(response.body());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("INFERENCE_CONTROL_INTERRUPTED");
    } catch (Exception e) {
      throw new IllegalStateException("INFERENCE_CONTROL_FAILED");
    }
  }

  private String validate(JsonNode actual, JsonNode expected, boolean publication) {
    if (actual == null) return null;
    for (String field :
        List.of(
            "contract_version", "job_id", "run_id", "model_kind", "request_id", "execution_round"))
      if (!Objects.equals(actual.get(field), expected.get(field)))
        throw new IllegalStateException("CANCEL_ACK_IDENTITY_MISMATCH");
    if (actual.hasNonNull("cancel_id")) {
      if (!Objects.equals(actual.get("cancel_id"), expected.get("cancel_id")))
        throw new IllegalStateException("CANCEL_ACK_IDENTITY_MISMATCH");
    } else {
      if (publication || actual.hasNonNull("cancellation_status"))
        throw new IllegalStateException("CANCEL_ACK_IDENTITY_MISMATCH");
      return null;
    }
    if (!actual.hasNonNull("cancellation_status")) return null;
    String status = actual.path("cancellation_status").asString();
    if (!(status.equals("STOPPED") && actual.path("status").asString().equals("STOPPED"))
        && !(status.equals("ALREADY_FINISHED")
            && actual.path("status").asString().equals("COMPLETED")))
      throw new IllegalStateException("CANCEL_ACK_INVALID_STATUS");
    return status;
  }

  void publish(UUID cancel, String payload) {
    var expected = expected(cancel, payload);
    validate(exchange(expected, payload), expected, true);
  }

  String acknowledgement(UUID cancel, String payload) {
    var expected = expected(cancel, payload);
    return validate(exchange(expected, null), expected, false);
  }
}
