package com.moneylaundry.api.suspicioustx;

import java.io.IOException;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/suspicious-transactions")
public class SuspiciousTransactionController {

  private final SuspiciousTransactionService suspiciousTransactionService;

  public SuspiciousTransactionController(
      SuspiciousTransactionService suspiciousTransactionService) {
    this.suspiciousTransactionService = suspiciousTransactionService;
  }

  @GetMapping
  public List<SuspiciousTransactionResponse> list() throws IOException {
    return suspiciousTransactionService.list();
  }
}
