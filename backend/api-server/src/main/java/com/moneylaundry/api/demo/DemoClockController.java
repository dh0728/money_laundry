package com.moneylaundry.api.demo;

import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewService;
import java.time.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/** 시연 업무 시계 조회·설정과 시연 직원 목록 API(/api/v1/demo). */
@RestController
@RequestMapping("/api/v1")
public class DemoClockController {
  private final ReviewService reviews;
  private final BusinessTime time;

  public DemoClockController(ReviewService reviews, BusinessTime time) {
    this.reviews = reviews;
    this.time = time;
  }

  public record ClockInput(Instant businessAt, long revision) {}

  @GetMapping("/demo/clock")
  public Map<String, Object> clock() {
    time.workbenchOnly();
    return time.view();
  }

  @PostMapping("/demo/clock")
  public Map<String, Object> clock(@RequestBody ClockInput input) {
    return time.set(input.businessAt(), input.revision());
  }

  @GetMapping("/demo/users")
  public Object users() {
    return reviews.users();
  }
}
