package com.moneylaundry.api;

import org.springframework.http.HttpStatus;

/** API.md §0 에러 코드 표를 그대로 실어 나르는 예외. ApiExceptionHandler가 ProblemDetail로 바꾼다. */
public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String code;

  public ApiException(HttpStatus status, String code, String detail) {
    super(detail);
    this.status = status;
    this.code = code;
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  public static ApiException notFound(String detail) {
    return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", detail);
  }

  public static ApiException invalidTransition(String detail) {
    return new ApiException(HttpStatus.CONFLICT, "INVALID_TRANSITION", detail);
  }
}
