package com.moneylaundry.api.review;

import com.moneylaundry.api.common.BusinessTime;
import java.time.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/** Transactions 화면 API(/api/v1): 소유주·계좌·거래 원장 조회, 계좌 노드와 결제 형식 목록. */
@RestController
@RequestMapping("/api/v1")
public class LedgerController {
  private final LedgerQueryService ledger;
  private final BusinessTime time;

  public LedgerController(LedgerQueryService ledger, BusinessTime time) {
    this.ledger = ledger;
    this.time = time;
  }

  @GetMapping("/ledger/{kind}")
  public Object ledger(
      @PathVariable String kind,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) UUID owner,
      @RequestParam(required = false) UUID account,
      @RequestParam(required = false) List<String> judgement,
      @RequestParam(required = false) List<String> payments,
      @RequestParam(required = false) String query,
      @RequestParam(required = false) List<String> directions,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    time.workbenchOnly();
    return ledger.query(
        kind,
        new LedgerQueryService.Filter(
            from, to, owner, account, judgement, payments, page, size, query, directions));
  }

  @GetMapping("/review/account-nodes")
  public Object nodes(@RequestParam List<String> ids) {
    time.workbenchOnly();
    if (ids.size() > 1000) throw com.moneylaundry.api.analysis.AnalysisService.invalid();
    return ledger.accounts(ids);
  }

  @GetMapping("/review/payment-formats")
  public Object payments() {
    time.workbenchOnly();
    return ledger.payments();
  }
}
