package com.moneylaundry.api.queue;

/** 큐 발행 실패. 관문은 이를 5xx로 변환해 송신자에게 재전송을 요청한다. */
public class QueuePublishException extends RuntimeException {

    public QueuePublishException(String message, Throwable cause) {
        super(message, cause);
    }
}
