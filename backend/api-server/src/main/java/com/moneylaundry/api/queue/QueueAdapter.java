package com.moneylaundry.api.queue;

/**
 * 큐 어댑터 경계 (§8). 관문(Java)은 발행만 하므로 {@code publish} 하나만 정의한다.
 * {@code consume}/{@code ack}/{@code fail}은 Python 수집 워커 어댑터 소유다.
 */
public interface QueueAdapter {

    void publish(QueueEnvelope envelope) throws QueuePublishException;
}
