package com.moneylaundry.api.rules;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.ReviewService;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/rules")
public class RuleController {
  private final RuleService rules;
  private final ReviewService reviews;

  public RuleController(RuleService rules, ReviewService reviews) {
    this.rules = rules;
    this.reviews = reviews;
  }

  private static long id(String code) {
    if (code == null || !code.matches("RULE-\\d{3,}")) throw ApiException.notFound("룰이 없습니다.");
    return Long.parseLong(code.substring(5));
  }

  @GetMapping
  public Object list(Principal principal) {
    reviews.actor(reviews.userId(principal));
    return rules.list();
  }

  @PostMapping
  public Object create(Principal principal, @RequestBody RuleService.Input input) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.save(null, user, input);
  }

  @PostMapping("/{code}")
  public Object update(
      @PathVariable String code, Principal principal, @RequestBody RuleService.Input input) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.save(id(code), user, input);
  }

  @PostMapping("/{code}/review")
  public Object review(
      @PathVariable String code, Principal principal, @RequestBody RuleService.Review input) {
    long user = reviews.userId(principal);
    return rules.review(id(code), user, "ADMIN".equals(reviews.actor(user).get("role")), input);
  }

  @PostMapping("/backtest")
  public Object backtest(Principal principal, @RequestBody RuleService.Backtest input) {
    reviews.actor(reviews.userId(principal));
    return rules.backtest(input);
  }
}
