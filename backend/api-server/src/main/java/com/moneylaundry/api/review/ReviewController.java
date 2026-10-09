package com.moneylaundry.api.review;

import java.time.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

/** 조사 화면 API(/api/v1): 사건 목록·상세·자금 지표·명령, 원장 조회, 시연 업무 시계, 대시보드. */
@RestController
@RequestMapping("/api/v1")
public class ReviewController {
  private final ReviewService reviews;
  private final LedgerQueryService ledger;
  private final BusinessTime time;
  private final DashboardService dashboard;

  public ReviewController(
      ReviewService reviews,
      LedgerQueryService ledger,
      BusinessTime time,
      DashboardService dashboard) {
    this.reviews = reviews;
    this.ledger = ledger;
    this.time = time;
    this.dashboard = dashboard;
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

  @GetMapping("/ledger/{kind}")
  public Object ledger(
      @PathVariable String kind,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) UUID owner,
      @RequestParam(required = false) UUID account,
      @RequestParam(required = false) List<String> judgement,
      @RequestParam(required = false) List<String> payments,
      @RequestParam(required = false) String query,
      @RequestParam(required = false) List<String> directions,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    time.workbenchOnly();
    return ledger.query(
        kind,
        new LedgerQueryService.Filter(
            from, to, owner, account, judgement, payments, page, size, query, directions));
  }

  @GetMapping("/review/account-nodes")
  public Object nodes(@RequestParam List<String> ids) {
    time.workbenchOnly();
    if (ids.size() > 1000) throw com.moneylaundry.api.analysis.AnalysisService.invalid();
    return ledger.accounts(ids);
  }

  @GetMapping("/review/payment-formats")
  public Object payments() {
    time.workbenchOnly();
    return ledger.payments();
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
