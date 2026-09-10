package com.moneylaundry.api.config;

import com.moneylaundry.api.bank.BankIdentityInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 은행 수집 API(/api/v1/bank/**)만 dev/local 임시 은행 식별. 사용자 인증 방식은 W4 [인증]에서 결정. 비동기 적재는 Boot 기본 태스크 실행기.
 */
@Configuration
@EnableAsync
public class WebConfig implements WebMvcConfigurer {

  private final BankIdentityInterceptor bankIdentityInterceptor;

  public WebConfig(BankIdentityInterceptor bankIdentityInterceptor) {
    this.bankIdentityInterceptor = bankIdentityInterceptor;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(bankIdentityInterceptor).addPathPatterns("/api/v1/bank/**");
  }
}
