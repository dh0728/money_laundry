package com.moneylaundry.api;

import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.moneylaundry.api.bank.BankIdentityInterceptor;
import com.moneylaundry.api.upload.UploadController;
import com.moneylaundry.api.upload.UploadService;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ApiExceptionHandlerTests {
  private final MockMvc mvc =
      MockMvcBuilders.standaloneSetup(new UploadController(mock(UploadService.class)))
          .setControllerAdvice(new ApiExceptionHandler())
          .build();

  @Test
  void 잘못된_JSON은_400이다() throws Exception {
    mvc.perform(
            post("/api/v1/bank/uploads")
                .requestAttr(BankIdentityInterceptor.BANK_ID, 70)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
  }

  @Test
  void 숫자가_아닌_업로드_ID는_400이다() throws Exception {
    mvc.perform(get("/api/uploads/not-a-number"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
  }
}
