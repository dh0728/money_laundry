package com.moneylaundry.api.bank;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.moneylaundry.api.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class BankIdentityInterceptorTests {
  @Test
  void dev와_local에서만_은행코드를_신뢰한다() {
    for (String[] profiles : new String[][] {{"dev"}, {"local"}, {"dev", "local"}}) {
      var interceptor = interceptor(profiles);
      for (String bankId : new String[] {"0", "70", "2147483647"}) {
        var request = request(bankId);
        assertThat(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()))
            .isTrue();
        assertThat(request.getAttribute("bankId")).isEqualTo(Integer.parseInt(bankId));
      }
    }
  }

  @Test
  void 기본_미지정_운영_및_운영혼합은_차단한다() {
    for (String[] profiles :
        new String[][] {
          {}, {"default"}, {"unknown"}, {"prod"}, {"dev", "prod"}, {"local", "prod"}
        }) {
      var request = request("70");
      assertThatThrownBy(
              () ->
                  interceptor(profiles)
                      .preHandle(request, new MockHttpServletResponse(), new Object()))
          .isInstanceOfSatisfying(
              ApiException.class,
              error -> {
                assertThat(error.status()).isEqualTo(HttpStatus.FORBIDDEN);
                assertThat(error.code()).isEqualTo("BANK_IDENTITY_DISABLED");
              });
      assertThat(request.getAttribute("bankId")).isNull();
    }
  }

  @Test
  void 누락_빈값_음수_문자_범위초과를_거절한다() {
    for (String value :
        new String[] {null, "", " ", "-1", "a", "1.5", "2147483648", "+1", " 70", "99999999999"}) {
      var request = request(value);
      assertThatThrownBy(
              () ->
                  interceptor("local")
                      .preHandle(request, new MockHttpServletResponse(), new Object()))
          .isInstanceOfSatisfying(
              ApiException.class,
              error -> {
                assertThat(error.status()).isEqualTo(HttpStatus.BAD_REQUEST);
                assertThat(error.code()).isEqualTo("VALIDATION_FAILED");
              });
      assertThat(request.getAttribute("bankId")).isNull();
    }
  }

  private BankIdentityInterceptor interceptor(String... profiles) {
    MockEnvironment environment = new MockEnvironment();
    environment.setActiveProfiles(profiles);
    return new BankIdentityInterceptor(environment);
  }

  private MockHttpServletRequest request(String value) {
    var request = new MockHttpServletRequest();
    if (value != null) request.addHeader("X-Bank-Id", value);
    return request;
  }
}
