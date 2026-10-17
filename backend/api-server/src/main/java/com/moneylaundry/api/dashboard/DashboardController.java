package com.moneylaundry.api.dashboard;

import com.moneylaundry.api.review.ReviewService;
import java.time.*;
import org.springframework.web.bind.annotation.*;

/** 대시보드 API(/api/v1/dashboard): 요약·최근 활동·처리 대기열. 응답은 사용자별이라 캐시하지 않는다. */
@RestController
@RequestMapping("/api/v1")
public class DashboardController {
  private final ReviewService reviews;
  private final DashboardService dashboard;

  public DashboardController(ReviewService reviews, DashboardService dashboard) {
    this.reviews = reviews;
    this.dashboard = dashboard;
  }

  @GetMapping("/dashboard/summary")
  public org.springframework.http.ResponseEntity<DashboardSummary> dashboard(
      java.security.Principal principal, @RequestParam LocalDate from, @RequestParam LocalDate to) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return org.springframework.http.ResponseEntity.ok()
        .header("Cache-Control", "private, no-store")
        .body(dashboard.view(user, from, to));
  }

  @GetMapping("/dashboard/activities")
  public org.springframework.http.ResponseEntity<java.util.List<DashboardLists.Activity>>
      activities(
          java.security.Principal principal,
          @RequestParam LocalDate from,
          @RequestParam LocalDate to) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return org.springframework.http.ResponseEntity.ok()
        .header("Cache-Control", "private, no-store")
        .body(dashboard.activities(user, from, to));
  }

  @GetMapping("/dashboard/queues")
  public org.springframework.http.ResponseEntity<DashboardLists.Queues> queues(
      java.security.Principal principal) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return org.springframework.http.ResponseEntity.ok()
        .header("Cache-Control", "private, no-store")
        .body(dashboard.queues(user));
  }
}
