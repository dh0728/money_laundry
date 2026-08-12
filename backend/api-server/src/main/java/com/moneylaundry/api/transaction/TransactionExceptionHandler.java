package com.moneylaundry.api.transaction;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/**
 * 400 조건(§ 확정된 계약) — JSON 파싱 실패 / 11키 중 누락 / null / 빈 문자열.
 * 그 밖의 값(금액 부호, 통화 코드, 타임스탬프 형식)은 검증하지 않으므로 여기서 다루지 않는다.
 */
@RestControllerAdvice
public class TransactionExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> handleInvalid(MethodArgumentNotValidException ex) {
        String reason = ex.getBindingResult().getFieldErrors().stream()
                .map(e -> toWireKey(e.getField()) + ": " + e.getDefaultMessage())
                .findFirst()
                .orElse("invalid request");
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", reason));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> handleUnreadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "malformed request body"));
    }

    // 거절 사유는 송신자가 아는 와이어 키(snake_case)로 내보낸다 — Java 필드명(camelCase)이
    // 아니라 TransactionRequest의 @JsonProperty 이름과 일치시킨다.
    private static String toWireKey(String javaFieldName) {
        return javaFieldName.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase();
    }
}
