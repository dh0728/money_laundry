package com.moneylaundry.api.auth;

import static org.mockito.Mockito.*;

import jakarta.servlet.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class SessionCookieTests {
  @Test
  void local_profile_cannot_weaken_dev_or_prod_cookie() throws Exception {
    for (String profiles : new String[] {"local", "dev", "dev,local", "local,prod", ""}) {
      var env = new MockEnvironment();
      if (!profiles.isEmpty()) env.setActiveProfiles(profiles.split(","));
      var context = mock(ServletContext.class);
      var cookie = mock(SessionCookieConfig.class);
      when(context.getSessionCookieConfig()).thenReturn(cookie);
      new StaffSecurity().sessionCookies(env).onStartup(context);
      verify(cookie).setSecure(!profiles.equals("local"));
      verify(cookie).setHttpOnly(true);
      verify(context).setSessionTrackingModes(java.util.Set.of(SessionTrackingMode.COOKIE));
    }
  }
}
