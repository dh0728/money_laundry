package com.moneylaundry.api.analysis;

import com.moneylaundry.api.ApiException;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.Map;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Local rehearsal entry point; only the scheduled wait is skipped. */
@RestController
@RequestMapping("/api/v1/demo")
public class DemoAnalysisController {
  private final AnalysisService service;
  private final Environment environment;
  private final com.moneylaundry.api.review.BusinessTime businessTime;

  public DemoAnalysisController(AnalysisService service, Environment environment) {
    this(service, environment, null);
  }

  @org.springframework.beans.factory.annotation.Autowired
  public DemoAnalysisController(
      AnalysisService service,
      Environment environment,
      com.moneylaundry.api.review.BusinessTime businessTime) {
    this.service = service;
    this.environment = environment;
    this.businessTime = businessTime;
  }

  public record Trigger(LocalDate businessDate) {}

  @PostMapping("/analysis")
  public ResponseEntity<Map<String, Object>> trigger(@RequestBody Trigger input) {
    var profiles = Arrays.asList(environment.getActiveProfiles());
    if (!profiles.contains("local") || profiles.contains("prod") || profiles.contains("dev"))
      throw new ApiException(
          HttpStatus.FORBIDDEN, "DEMO_CONTROL_DISABLED", "로컬 시연 환경에서만 사용할 수 있습니다.");
    return ResponseEntity.accepted()
        .body(
            Map.of(
                "jobId",
                businessTime == null
                    ? service.registerDemo(input.businessDate())
                    : service.registerDemo(
                        input.businessDate(),
                        businessTime
                            .now()
                            .atZone(com.moneylaundry.api.review.BusinessTime.KST)
                            .toLocalDate()),
                "status",
                "QUEUED"));
  }
}
