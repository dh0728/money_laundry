package com.moneylaundry.api.correction;

import com.moneylaundry.api.bank.BankIdentityInterceptor;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** 은행용 정정 요청 조회 API(/api/v1/bank/corrections). 은행은 임시 코드로 식별한다. */
@RestController
@RequestMapping("/api/v1/bank/corrections")
public class CorrectionController {
  private final CorrectionService service;

  public CorrectionController(CorrectionService service) {
    this.service = service;
  }

  @GetMapping
  public Map<String, Object> list(
      @RequestAttribute(BankIdentityInterceptor.BANK_ID) int bank,
      @RequestParam(required = false) String status,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return service.list(bank, status, page, size);
  }

  @GetMapping("/{id}")
  public Map<String, Object> detail(
      @RequestAttribute(BankIdentityInterceptor.BANK_ID) int bank, @PathVariable long id) {
    return service.detail(bank, id);
  }
}
