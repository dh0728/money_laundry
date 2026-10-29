package com.moneylaundry.api.review;

import java.time.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/** 조사 화면 API(/api/v1/review): 사건 목록·상세·자금 지표·명령. */
@RestController
@RequestMapping("/api/v1")
public class ReviewController {
  private final ReviewService reviews;

  public ReviewController(ReviewService reviews) {
    this.reviews = reviews;
  }

  @GetMapping("/review/cases")
  public Object cases(
      @RequestParam String kind,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Long assigneeId,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) String query,
      @RequestParam(required = false) List<String> types,
      @RequestParam(required = false) Integer minAgeDays,
      @RequestParam(required = false) String risk,
      @RequestParam(required = false) List<String> statuses,
      @RequestParam(required = false) List<Long> assignees) {
    return reviews.list(
        kind,
        status,
        assigneeId,
        from,
        to,
        page,
        size,
        new ReviewCaseFilter(query, types, minAgeDays, risk, statuses, assignees));
  }

  @GetMapping("/review/cases/{id}")
  public Object detail(@PathVariable long id) {
    return reviews.detail(id);
  }

  @GetMapping("/review/cases/{id}/money")
  public Object money(@PathVariable long id, @RequestParam(defaultValue = "180") int minutes) {
    return reviews.money(id, minutes);
  }

  @PostMapping("/review/cases/{id}/money-scope")
  public Object moneyScope(
      @PathVariable long id,
      java.security.Principal principal,
      @RequestBody ReviewService.MoneyScope input) {
    return reviews.setMoneyScope(id, reviews.userId(principal), input);
  }

  @PostMapping("/review/commands")
  public Object command(java.security.Principal principal, @RequestBody ReviewService.Command cmd) {
    return reviews.command(reviews.userId(principal), cmd);
  }
}
