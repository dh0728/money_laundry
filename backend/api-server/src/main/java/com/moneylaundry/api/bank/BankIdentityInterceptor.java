package com.moneylaundry.api.bank;

import com.moneylaundry.api.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/** dev/local 업로드 테스트용 은행 식별. 실제 인증이 아니며 로그인 도입 시 이 경계를 교체한다. */
@Component
public class BankIdentityInterceptor implements HandlerInterceptor {
  public static final String HEADER = "X-Bank-Id";
  public static final String BANK_ID = "bankId";
  private final boolean enabled;

  public BankIdentityInterceptor(Environment environment) {
    List<String> profiles = Arrays.asList(environment.getActiveProfiles());
    enabled =
        !profiles.contains("prod") && (profiles.contains("dev") || profiles.contains("local"));
  }

  @Override
  public boolean preHandle(
      HttpServletRequest request, HttpServletResponse response, Object handler) {
    if (!enabled) {
      throw new ApiException(
          HttpStatus.FORBIDDEN,
          "BANK_IDENTITY_DISABLED",
          "임시 은행 식별은 dev/local에서만 사용할 수 있으며 prod에서는 금지됩니다.");
    }
    String value = request.getHeader(HEADER);
    if (value == null || !value.matches("[0-9]{1,10}")) {
      throw invalidBankId();
    }
    try {
      request.setAttribute(BANK_ID, Integer.parseInt(value));
    } catch (NumberFormatException e) {
      throw invalidBankId();
    }
    return true;
  }

  private ApiException invalidBankId() {
    return new ApiException(
        HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "X-Bank-Id는 0~2147483647 정수여야 합니다.");
  }
}
