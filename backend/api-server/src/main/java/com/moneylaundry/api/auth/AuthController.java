package com.moneylaundry.api.auth;

import java.security.Principal;
import java.util.Map;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

/** 직원 세션용 CSRF 토큰 발급과 현재 로그인 사용자 조회. */
@RestController
public class AuthController {
  private final StaffAccounts accounts;

  public AuthController(StaffAccounts accounts) {
    this.accounts = accounts;
  }

  @GetMapping("/api/auth/csrf")
  public Map<String, String> csrf(CsrfToken token) {
    return Map.of("headerName", token.getHeaderName(), "token", token.getToken());
  }

  @GetMapping("/api/me")
  public Map<String, Object> me(Principal principal) {
    return accounts.view(principal);
  }
}
