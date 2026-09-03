package com.moneylaundry.api;

import com.moneylaundry.api.upload.WorkerException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/** 에러 응답 모양(API.md §0): ProblemDetail + code. */
@Slf4j
@RestControllerAdvice
public class ApiExceptionHandler {

  @ExceptionHandler({MissingServletRequestPartException.class, MultipartException.class})
  ProblemDetail missingPart(Exception e) {
    return problem(HttpStatus.BAD_REQUEST, "MISSING_PART", e.getMessage());
  }

  @ExceptionHandler(MaxUploadSizeExceededException.class)
  ProblemDetail fileTooLarge(MaxUploadSizeExceededException e) {
    return problem(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", e.getMessage());
  }

  @ExceptionHandler(WorkerException.class)
  ProblemDetail workerFailed(WorkerException e) {
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "WORKER_FAILED", e.getMessage());
  }

  @ExceptionHandler(Exception.class)
  ProblemDetail internal(Exception e) {
    log.error("처리되지 않은 예외", e);
    return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", e.getMessage());
  }

  private static ProblemDetail problem(HttpStatus status, String code, String detail) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
    problem.setProperty("code", code);
    return problem;
  }
}
