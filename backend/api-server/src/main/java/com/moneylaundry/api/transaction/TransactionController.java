package com.moneylaundry.api.transaction;

import com.moneylaundry.api.queue.QueueAdapter;
import com.moneylaundry.api.queue.QueueEnvelope;
import com.moneylaundry.api.queue.QueuePublishException;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.UUID;

/** 최소 수신 관문. §6 — 형식 실패만 400, 의미 이상은 수용한다. */
@RestController
public class TransactionController {

    // Instant.toString()은 밀리초 자릿수가 흔들려 쓰지 않는다 — 3자리를 항상 출력한다.
    private static final DateTimeFormatter RECEIVED_AT_FORMATTER =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final QueueAdapter queueAdapter;

    public TransactionController(QueueAdapter queueAdapter) {
        this.queueAdapter = queueAdapter;
    }

    @PostMapping("/api/transactions")
    public ResponseEntity<Map<String, String>> receive(@Valid @RequestBody TransactionRequest request) {
        String ingestId = UUID.randomUUID().toString();
        String receivedAt = RECEIVED_AT_FORMATTER.format(Instant.now());
        QueueEnvelope envelope = new QueueEnvelope(ingestId, null, receivedAt, request);

        try {
            queueAdapter.publish(envelope);
        } catch (QueuePublishException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "queue publish failed"));
        }

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of("ingest_id", ingestId));
    }
}
