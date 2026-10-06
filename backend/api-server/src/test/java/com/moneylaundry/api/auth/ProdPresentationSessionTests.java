package com.moneylaundry.api.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {"spring.profiles.active=prod", "app.presentation.enabled=true"})
class ProdPresentationSessionTests extends StaffSessionTests {
  @Override
  @Test
  void demo_reset_requires_admin_and_csrf() throws Exception {
    mvc.perform(get("/api/v1/demo/reset/preview")).andExpect(status().isUnauthorized());
    for (String user : new String[] {"l1a", "admin"}) {
      login(user);
      mvc.perform(get("/api/v1/demo/reset/preview").session(session))
          .andExpect(status().isForbidden());
      mvc.perform(
              post("/api/v1/demo/reset")
                  .session(session)
                  .header("X-CSRF-TOKEN", token)
                  .contentType("application/json")
                  .content("{}"))
          .andExpect(status().isForbidden());
    }
  }

  @Override
  @Test
  void admin_clock_requires_csrf_and_uses_business_time() throws Exception {
    jdbc.update("update demo_business_clock set business_at='2023-09-02 09:00+09',revision=1");
    login("admin");
    mvc.perform(get("/api/v1/demo/clock").session(session))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.configured").value(true))
        .andExpect(jsonPath("$.businessAt").value("2023-09-02T09:00+09:00"));
    mvc.perform(
            post("/api/v1/demo/clock")
                .session(session)
                .header("X-CSRF-TOKEN", token)
                .contentType("application/json")
                .content("{\"businessAt\":\"2023-09-03T00:00:00Z\",\"revision\":1}"))
        .andExpect(status().isForbidden());
  }
}
