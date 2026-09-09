package com.moneylaundry.api;

import com.moneylaundry.api.upload.WorkerException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** 에러 응답 모양(API.md §0): ProblemDetail + code. */
@Slf4j
@RestControllerAdvice
public class ApiExceptionHandler {

  @ExceptionHandler(ApiException.class)
  ProblemDetail api(ApiException e) {
    ProblemDetail result = problem(e.status(), e.code(), e.getMessage());
    if (e instanceof com.moneylaundry.api.upload.DuplicateFileException duplicate) {
      result.setProperty("fileName", duplicate.fileName());
      result.setProperty("uploadedAt", duplicate.uploadedAt());
    }
    return result;
  }

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ProblemDetail invalidBody(Exception e) {
    return problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "요청 필드와 형식을 확인하세요.");
  }

  @ExceptionHandler(WorkerException.class)
  ProblemDetail workerFailed(WorkerException e) {
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "WORKER_FAILED", e.getMessage());
  }

  @ExceptionHandler(Exception.class)
  ProblemDetail internal(Exception e) {
    log.error("처리되지 않은 예외", e);
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", "서버 처리 중 오류가 발생했습니다.");
  }

  private static ProblemDetail problem(HttpStatus status, String code, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setProperty("code", code);
    return problem;
  }
}
