package com.moneylaundry.api.review;

import java.time.*;
import java.util.*;
import org.springframework.web.bind.annotation.*;

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
    time.localOnly();
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
      @RequestParam(defaultValue = "20") int size) {
    return reviews.list(kind, status, assigneeId, from, to, page, size);
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
      @RequestHeader("X-Demo-User-Id") long user,
      @RequestBody ReviewService.MoneyScope input) {
    return reviews.setMoneyScope(id, user, input);
  }

  @PostMapping("/review/commands")
  public Object command(
      @RequestHeader("X-Demo-User-Id") long user, @RequestBody ReviewService.Command cmd) {
    return reviews.command(user, cmd);
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
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    time.localOnly();
    return ledger.query(
        kind,
        new LedgerQueryService.Filter(from, to, owner, account, judgement, payments, page, size));
  }

  @GetMapping("/review/account-nodes")
  public Object nodes(@RequestParam List<String> ids) {
    time.localOnly();
    if (ids.size() > 1000) throw com.moneylaundry.api.analysis.AnalysisService.invalid();
    return ledger.accounts(ids);
  }

  @GetMapping("/review/payment-formats")
  public Object payments() {
    time.localOnly();
    return ledger.payments();
  }

  @GetMapping("/dashboard")
  public Object dashboard(
      @RequestHeader("X-Demo-User-Id") long user,
      @RequestParam LocalDate from,
      @RequestParam LocalDate to) {
    reviews.actor(user);
    return dashboard.view(user, from, to);
  }
}
