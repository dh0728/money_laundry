package com.moneylaundry.api.bank;

import com.moneylaundry.api.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** /api/bank/** 의 X-Api-Key를 banks.api_key_hash로 해석해 요청 속성 {@link #BANK_ID}에 bankId를 넣는다. */
@Component
public class BankApiKeyInterceptor implements HandlerInterceptor {

  public static final String HEADER = "X-Api-Key";
  public static final String BANK_ID = "bankId";

  private final BankRepository bankRepository;

  public BankApiKeyInterceptor(BankRepository bankRepository) {
    this.bankRepository = bankRepository;
  }

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    String apiKey = request.getHeader(HEADER);
    if (apiKey == null || apiKey.isBlank()) {
      throw unauthenticated();
    }
    Bank bank =
        bankRepository.findByApiKeyHash(ApiKeys.hash(apiKey)).orElseThrow(this::unauthenticated);
    request.setAttribute(BANK_ID, bank.getId());
    return true;
  }

  private ApiException unauthenticated() {
    return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "은행 API 키가 없거나 일치하지 않음");
  }
}
