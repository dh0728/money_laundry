package com.moneylaundry.api.transaction;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.moneylaundry.api.queue.QueueAdapter;
import com.moneylaundry.api.queue.QueueEnvelope;
import com.moneylaundry.api.queue.QueuePublishException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 성공 기준 A(1~7) — collab/ACTIVE_PLAN.md 「성공 기준 · 검증 방법」.
 * Spring 컨텍스트 없이 MockMvc standalone + 자체 QueueAdapter 테스트 더블로 검증한다.
 */
class TransactionControllerTest {

    private static final List<String> FIELD_NAMES = List.of(
            "transaction_id", "timestamp", "from_bank", "from_account", "to_bank", "to_account",
            "amount_received", "receiving_currency", "amount_paid", "payment_currency", "payment_format");

    private final ObjectMapper objectMapper = new ObjectMapper();

    static Stream<String> fieldNames() {
        return FIELD_NAMES.stream();
    }

    private static Map<String, Object> validPayload() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("transaction_id", "HI-Small-000000003");
        m.put("timestamp", "2022/09/01 00:20");
        m.put("from_bank", "03209");
        m.put("from_account", "8000F4670");
        m.put("to_bank", "011");
        m.put("to_account", "100428660");
        m.put("amount_received", "12000.00");
        m.put("receiving_currency", "Euro");
        m.put("amount_paid", "14675.57");
        m.put("payment_currency", "US Dollar");
        m.put("payment_format", "Cheque");
        return m;
    }

    private static MockMvc mockMvc(QueueAdapter adapter) {
        return MockMvcBuilders.standaloneSetup(new TransactionController(adapter))
                .setControllerAdvice(new TransactionExceptionHandler())
                .build();
    }

    private static MvcResult doPost(MockMvc mockMvc, String body) throws Exception {
        return mockMvc.perform(post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    /** publish를 기록만 하는 테스트 더블. 실패 주입도 지원한다. */
    private static class RecordingQueueAdapter implements QueueAdapter {
        boolean shouldFail = false;
        boolean called = false;
        QueueEnvelope lastEnvelope;

        @Override
        public void publish(QueueEnvelope envelope) {
            called = true;
            if (shouldFail) {
                throw new QueuePublishException("simulated publish failure", null);
            }
            lastEnvelope = envelope;
        }
    }

    // 1. 정상 요청 → 202 + ingest_id 존재
    @Test
    void validRequest_returns202WithIngestId() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(validPayload()));

        assertThat(result.getResponse().getStatus()).isEqualTo(202);
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.has("ingest_id")).isTrue();
        assertThat(body.get("ingest_id").asText()).isNotBlank();
        assertThat(adapter.called).isTrue();
    }

    // 2. 같은 본문 2회 → ingest_id가 서로 다름 (§5.4)
    @Test
    void sameBodyTwice_producesDifferentIngestIds() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        String body = objectMapper.writeValueAsString(validPayload());

        MvcResult r1 = doPost(mockMvc, body);
        MvcResult r2 = doPost(mockMvc, body);

        String id1 = objectMapper.readTree(r1.getResponse().getContentAsString()).get("ingest_id").asText();
        String id2 = objectMapper.readTree(r2.getResponse().getContentAsString()).get("ingest_id").asText();
        assertThat(id1).isNotEqualTo(id2);
    }

    // 3a. 필수 키 누락 → 400, 어댑터 미호출
    @ParameterizedTest
    @MethodSource("fieldNames")
    void missingKey_returns400AndDoesNotCallAdapter(String field) throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();
        payload.remove(field);

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(adapter.called).isFalse();
    }

    // 3b. 값이 null → 400, 어댑터 미호출
    @ParameterizedTest
    @MethodSource("fieldNames")
    void nullValue_returns400AndDoesNotCallAdapter(String field) throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();
        payload.put(field, null);

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(adapter.called).isFalse();
    }

    // 3c. 값이 빈 문자열 → 400, 어댑터 미호출
    @ParameterizedTest
    @MethodSource("fieldNames")
    void blankValue_returns400AndDoesNotCallAdapter(String field) throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();
        payload.put(field, "");

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(adapter.called).isFalse();
    }

    // 3d. 깨진 JSON → 400, 어댑터 미호출
    @Test
    void malformedJson_returns400AndDoesNotCallAdapter() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);

        MvcResult result = doPost(mockMvc, "{not valid json");

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(adapter.called).isFalse();
    }

    // 4. 음수 금액 / 미지 통화 / 비ISO 타임스탬프 → 202 (§6 의미 이상 수용)
    @Test
    void semanticAnomalies_areStillAccepted() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();
        payload.put("amount_received", "-100.00");
        payload.put("receiving_currency", "Zorkmid");
        payload.put("timestamp", "not-a-date");

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(result.getResponse().getStatus()).isEqualTo(202);
        assertThat(adapter.called).isTrue();
    }

    // 5. publish 실패 주입 → 5xx
    @Test
    void publishFailure_returns5xx() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        adapter.shouldFail = true;
        MockMvc mockMvc = mockMvc(adapter);

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(validPayload()));

        assertThat(result.getResponse().getStatus()).isGreaterThanOrEqualTo(500);
        assertThat(result.getResponse().getStatus()).isLessThan(600);
    }

    // 6. 어댑터에 전달된 페이로드 — payload_hash 키 존재(값 null), received_at 밀리초 3자리
    //    ISO-8601, 11키가 transaction 아래 값 그대로. 키 존재 여부는 직렬화 결과 기준으로 단언한다.
    //    픽스처의 11개 값이 서로 달라야 이 단언이 필드 교차·오배선(예: from_↔to_,
    //    amount_received↔amount_paid)을 실제로 잡는다.
    @Test
    void queuePayload_matchesContract() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();

        doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(adapter.lastEnvelope).isNotNull();
        JsonNode envelope = objectMapper.readTree(objectMapper.writeValueAsString(adapter.lastEnvelope));

        assertThat(envelope.has("payload_hash")).isTrue();
        assertThat(envelope.get("payload_hash").isNull()).isTrue();

        String receivedAt = envelope.get("received_at").asText();
        assertThat(receivedAt).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");

        JsonNode transaction = envelope.get("transaction");
        assertThat(transaction).isNotNull();
        assertThat(transaction.size()).isEqualTo(FIELD_NAMES.size());
        for (String field : FIELD_NAMES) {
            assertThat(transaction.has(field)).isTrue();
            assertThat(transaction.get(field).asText()).isEqualTo((String) payload.get(field));
        }
    }

    // 7. 미지 키가 섞인 요청 → 202, 큐 페이로드에는 그 키가 없음
    @Test
    void unknownKey_isAcceptedButNotForwardedToQueue() throws Exception {
        RecordingQueueAdapter adapter = new RecordingQueueAdapter();
        MockMvc mockMvc = mockMvc(adapter);
        Map<String, Object> payload = validPayload();
        payload.put("unexpected_field", "should be ignored");

        MvcResult result = doPost(mockMvc, objectMapper.writeValueAsString(payload));

        assertThat(result.getResponse().getStatus()).isEqualTo(202);
        JsonNode transaction = objectMapper.readTree(objectMapper.writeValueAsString(adapter.lastEnvelope))
                .get("transaction");
        assertThat(transaction.has("unexpected_field")).isFalse();
        assertThat(transaction.size()).isEqualTo(FIELD_NAMES.size());
    }
}
