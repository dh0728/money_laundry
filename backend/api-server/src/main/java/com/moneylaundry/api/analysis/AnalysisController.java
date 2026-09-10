package com.moneylaundry.api.analysis;

import com.moneylaundry.api.ApiException;
import java.time.Instant;
import java.util.*;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/batch-jobs")
public class AnalysisController {
  private final AnalysisService service;
  private final Environment environment;

  public AnalysisController(AnalysisService service, Environment environment) {
    this.service = service;
    this.environment = environment;
  }

  @GetMapping
  public Map<String, Object> list(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) String type,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Instant from,
      @RequestParam(required = false) Instant to) {
    return service.list(page, size, type, status, from, to);
  }

  @GetMapping("/{jobId}")
  public Map<String, Object> detail(@PathVariable long jobId) {
    return service.detail(jobId);
  }

  @PostMapping("/analysis")
  public ResponseEntity<Map<String, Object>> trigger() {
    guard();
    return ResponseEntity.accepted()
        .body(Map.of("jobId", service.registerNow(), "status", "QUEUED"));
  }

  @PostMapping("/{jobId}/resume")
  public ResponseEntity<Map<String, Object>> resume(@PathVariable long jobId) {
    guard();
    service.resume(jobId);
    return ResponseEntity.accepted().body(Map.of("jobId", jobId, "status", "QUEUED"));
  }

  private void guard() {
    var profiles = Arrays.asList(environment.getActiveProfiles());
    if (profiles.contains("prod") || (!profiles.contains("dev") && !profiles.contains("local")))
      throw new ApiException(
          HttpStatus.FORBIDDEN, "ANALYSIS_CONTROL_DISABLED", "분석 테스트 제어는 dev/local 환경에서만 허용됩니다.");
  }
}
