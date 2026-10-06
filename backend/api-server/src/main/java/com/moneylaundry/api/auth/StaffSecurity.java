package com.moneylaundry.api.auth;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.password.*;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.ObjectMapper;

@Configuration
public class StaffSecurity {
  @Bean
  org.springframework.boot.web.servlet.ServletContextInitializer sessionCookies(Environment env) {
    boolean secure =
        Arrays.asList(env.getActiveProfiles()).contains("dev")
            || !Arrays.asList(env.getActiveProfiles()).contains("local")
            || Arrays.asList(env.getActiveProfiles()).contains("prod");
    return context -> {
      context.getSessionCookieConfig().setSecure(secure);
      context.getSessionCookieConfig().setHttpOnly(true);
      context.setSessionTrackingModes(java.util.Set.of(jakarta.servlet.SessionTrackingMode.COOKIE));
    };
  }

  @Bean
  PasswordEncoder passwordEncoder() {
    return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();
  }

  private static void error(HttpServletResponse response, int status, String code)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    response.getWriter().write("{\"status\":" + status + ",\"code\":\"" + code + "\"}");
  }

  @Bean
  SecurityFilterChain staffFilterChain(HttpSecurity http, Environment env, StaffAccounts accounts)
      throws Exception {
    boolean enabled = WorkbenchAccess.enabled(env);
    http.csrf(c -> c.ignoringRequestMatchers("/api/v1/bank/**"))
        .requestCache(c -> c.disable())
        .exceptionHandling(
            c ->
                c.authenticationEntryPoint((q, r, e) -> error(r, 401, "UNAUTHENTICATED"))
                    .accessDeniedHandler((q, r, e) -> error(r, 403, "FORBIDDEN")))
        .authorizeHttpRequests(
            c -> {
              c.requestMatchers("/actuator/health", "/actuator/health/**", "/api/v1/bank/**")
                  .permitAll();
              if (enabled) {
                c.requestMatchers("/api/auth/csrf", "/api/auth/login")
                    .permitAll()
                    .requestMatchers(HttpMethod.POST, "/api/v1/demo/**", "/api/v1/batch-jobs/**")
                    .hasRole("ADMIN")
                    .requestMatchers("/api/**")
                    .hasAnyRole("STAFF", "ADMIN");
              }
              c.anyRequest().denyAll();
            });
    if (enabled) {
      http.formLogin(
              c ->
                  c.loginProcessingUrl("/api/auth/login")
                      .successHandler(
                          (q, r, a) -> {
                            r.setContentType("application/json;charset=UTF-8");
                            r.getWriter()
                                .write(new ObjectMapper().writeValueAsString(accounts.view(a)));
                          })
                      .failureHandler((q, r, e) -> error(r, 401, "INVALID_CREDENTIALS")))
          .logout(
              c ->
                  c.logoutUrl("/api/auth/logout")
                      .invalidateHttpSession(true)
                      .deleteCookies("JSESSIONID")
                      .logoutSuccessHandler((q, r, a) -> r.setStatus(204)));
    }
    return http.build();
  }
}
