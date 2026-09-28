package com.moneylaundry.api.config;

import com.moneylaundry.api.bank.BankIdentityInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** 은행 수집 식별은 직원 세션 인증과 별도다. 비동기 적재는 Boot 기본 실행기를 사용한다. */
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
