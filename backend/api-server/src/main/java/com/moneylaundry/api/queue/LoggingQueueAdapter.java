package com.moneylaundry.api.queue;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/** 로컬 로깅 구현. 실제 큐(SQS 등) 연결은 이번 범위가 아니다. */
@Component
public class LoggingQueueAdapter implements QueueAdapter {

    private static final Logger log = LoggerFactory.getLogger(LoggingQueueAdapter.class);

    private final ObjectMapper objectMapper;

    public LoggingQueueAdapter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void publish(QueueEnvelope envelope) {
        String json;
        try {
            json = objectMapper.writeValueAsString(envelope);
        } catch (JacksonException e) {
            throw new QueuePublishException("failed to serialize queue payload", e);
        }
        log.info("queue publish: {}", json);
    }
}
