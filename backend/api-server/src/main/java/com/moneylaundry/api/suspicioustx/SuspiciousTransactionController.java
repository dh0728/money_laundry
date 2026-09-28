package com.moneylaundry.api.suspicioustx;

import java.time.LocalDate;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/suspicious-transactions")
public class SuspiciousTransactionController {

  private final SuspiciousTransactionService suspiciousTransactionService;

  public SuspiciousTransactionController(
      SuspiciousTransactionService suspiciousTransactionService) {
    this.suspiciousTransactionService = suspiciousTransactionService;
  }

  @GetMapping
  public Map<String, Object> list(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) Long jobId,
      @RequestParam(required = false) LocalDate analysisDate,
      @RequestParam(required = false) Integer typeClass,
      @RequestParam(required = false) Double minScore,
      @RequestParam(required = false) Integer bankId,
      @RequestParam(defaultValue = "launderingScore,desc") String sort) {
    return suspiciousTransactionService.list(
        page, size, jobId, analysisDate, typeClass, minScore, bankId, sort);
  }
}
