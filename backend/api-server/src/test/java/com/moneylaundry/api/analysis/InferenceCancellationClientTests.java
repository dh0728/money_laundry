package com.moneylaundry.api.analysis;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

class InferenceCancellationClientTests {
  final ObjectMapper mapper = new ObjectMapper();
  final HttpClient http = mock(HttpClient.class);
  final UUID cancel = UUID.randomUUID();
  final ObjectNode payload =
      mapper
          .createObjectNode()
          .put("contract_version", 2)
          .put("job_id", 4)
          .put("run_id", UUID.randomUUID().toString())
          .put("request_id", UUID.randomUUID().toString())
          .put("execution_round", 1)
          .put("model_kind", "BINARY")
          .put("cancel_id", cancel.toString())
          .put("reason_code", "REPORT_CORRECTED")
          .put("requested_at", "2026-09-21T00:00:00Z");

  InferenceCancellationClient client() {
    var client = new InferenceCancellationClient(mapper, http);
    client.configure("https://inference.example", "a".repeat(32));
    return client;
  }

  @SuppressWarnings("unchecked")
  void response(int code, ObjectNode body) throws Exception {
    HttpResponse<byte[]> response = mock(HttpResponse.class);
    when(response.statusCode()).thenReturn(code);
    when(response.body()).thenReturn(mapper.writeValueAsBytes(body));
    when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
        .thenReturn(response);
  }

  @Test
  void pending_is_not_stopped_and_put_has_authentication() throws Exception {
    var body = payload.deepCopy().put("status", "CANCEL_REQUESTED");
    response(202, body);
    var client = client();
    client.publish(cancel, payload.toString());
    var request = ArgumentCaptor.forClass(HttpRequest.class);
    verify(http).send(request.capture(), any());
    assertThat(request.getValue().method()).isEqualTo("PUT");
    assertThat(request.getValue().uri().getPath()).endsWith("/rounds/1/cancellation");
    assertThat(request.getValue().headers().firstValue("Authorization"))
        .contains("Bearer " + "a".repeat(32));
    response(200, body);
    assertThat(client.acknowledgement(cancel, payload.toString())).isNull();
  }

  @Test
  void confirms_only_matching_terminal_acknowledgements() throws Exception {
    var client = client();
    for (String status : List.of("STOPPED", "ALREADY_FINISHED")) {
      response(
          200,
          payload
              .deepCopy()
              .put("cancellation_status", status)
              .put("status", status.equals("STOPPED") ? "STOPPED" : "COMPLETED"));
      assertThat(client.acknowledgement(cancel, payload.toString())).isEqualTo(status);
    }
  }

  @Test
  void every_identity_field_is_checked() throws Exception {
    var client = client();
    for (String field :
        List.of(
            "contract_version",
            "job_id",
            "run_id",
            "model_kind",
            "request_id",
            "execution_round",
            "cancel_id")) {
      var body = payload.deepCopy().put("status", "STOPPED").put("cancellation_status", "STOPPED");
      body.put(field, "different");
      response(200, body);
      assertThatThrownBy(() -> client.acknowledgement(cancel, payload.toString()))
          .hasMessage("CANCEL_ACK_IDENTITY_MISMATCH");
    }
  }

  @Test
  void absent_cancel_or_request_is_pending_and_recovery_is_not_stop() throws Exception {
    var client = client();
    var body = payload.deepCopy().put("status", "COMPLETED");
    body.remove("cancel_id");
    response(200, body);
    assertThat(client.acknowledgement(cancel, payload.toString())).isNull();
    response(404, mapper.createObjectNode());
    assertThat(client.acknowledgement(cancel, payload.toString())).isNull();
    response(
        200, payload.deepCopy().put("status", "FAILED").put("error_code", "RECOVERY_REQUIRED"));
    assertThat(client.acknowledgement(cancel, payload.toString())).isNull();
    response(
        200, payload.deepCopy().put("status", "RUNNING").put("cancellation_status", "STOPPED"));
    assertThatThrownBy(() -> client.acknowledgement(cancel, payload.toString()))
        .hasMessage("CANCEL_ACK_INVALID_STATUS");
  }

  @Test
  void http_errors_redirects_and_bad_json_do_not_acknowledge() throws Exception {
    var client = client();
    for (int code : List.of(302, 401, 409, 500)) {
      response(code, payload);
      assertThatThrownBy(() -> client.publish(cancel, payload.toString()))
          .hasMessage("INFERENCE_CONTROL_FAILED");
    }
    response(200, mapper.createObjectNode());
    assertThatThrownBy(() -> client.publish(cancel, payload.toString()))
        .hasMessage("CANCEL_ACK_IDENTITY_MISMATCH");
  }

  @Test
  void configuration_rejects_insecure_or_partial_settings() {
    var client = new InferenceCancellationClient(mapper, http);
    client.configure("", "");
    assertThat(client.enabled()).isFalse();
    for (String url :
        List.of(
            "",
            "http://inference.example",
            "https://user@inference.example",
            "https://inference.example?secret=value"))
      assertThatThrownBy(() -> client.configure(url, "a".repeat(32)))
          .hasMessage("INVALID_INFERENCE_CONFIGURATION");
    assertThatThrownBy(() -> client.configure("https://inference.example", "short"))
        .hasMessage("INVALID_INFERENCE_CONFIGURATION");
  }
}
