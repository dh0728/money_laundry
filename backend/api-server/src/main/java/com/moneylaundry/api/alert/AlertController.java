package com.moneylaundry.api.alert;

import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/alerts")
public class AlertController {
  private final AlertQueryService service;

  public AlertController(AlertQueryService service) {
    this.service = service;
  }

  @GetMapping
  public Map<String, Object> list(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long assigneeId,
      @RequestParam(required = false) Long jobId) {
    return service.list(page, size, status, assigneeId, jobId);
  }

  @GetMapping("/{alertId}")
  public Map<String, Object> detail(
      @PathVariable long alertId, @RequestParam(required = false) Integer version) {
    return service.detail(alertId, version);
  }

  @GetMapping("/{alertId}/versions")
  public List<Map<String, Object>> versions(@PathVariable long alertId) {
    return service.versions(alertId);
  }

  @GetMapping("/{alertId}/graph")
  public Object graph(@PathVariable long alertId, @RequestParam(required = false) Integer version) {
    return service.detail(alertId, version).get("graph");
  }
}
