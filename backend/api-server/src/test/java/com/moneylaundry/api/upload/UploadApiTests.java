package com.moneylaundry.api.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.moneylaundry.api.TestcontainersConfiguration;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
class UploadApiTests {

  static Path tempStorage;

  @DynamicPropertySource
  static void storageDir(DynamicPropertyRegistry registry) throws IOException {
    tempStorage = Files.createTempDirectory("upload-test");
    registry.add("app.storage-dir", () -> tempStorage.toString());
  }

  @Autowired MockMvc mockMvc;
  @MockitoBean ScoreWorker scoreWorker;

  @Test
  void 업로드하면_원본이_저장되고_워커_결과의_행수를_돌려준다() throws Exception {
    Mockito.doAnswer(
            invocation -> {
              Path output = invocation.getArgument(1);
              Files.writeString(output, "{\"row_count\":2,\"scores\":[]}");
              return null;
            })
        .when(scoreWorker)
        .score(Mockito.any(), Mockito.any());

    MockMultipartFile file =
        new MockMultipartFile("file", "tx.csv", "text/csv", "h1,h2\n1,2\n3,4\n".getBytes());

    mockMvc
        .perform(multipart("/api/uploads").file(file))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.uploadId").isNotEmpty())
        .andExpect(jsonPath("$.rowCount").value(2));

    try (var saved = Files.list(tempStorage.resolve("uploads"))) {
      assertThat(saved.toList()).hasSize(1);
    }
  }
}
