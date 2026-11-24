package com.moneylaundry.api.rules;

import com.moneylaundry.api.review.ReviewService;
import com.moneylaundry.api.rules.backtest.BacktestService;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 룰 백테스트: 접수, 상태와 결과, 취소, 룰별 기록. */
@RestController
@RequestMapping("/api/v1/rule-backtests")
public class RuleBacktestController {
  private final BacktestService backtests;
  private final ReviewService reviews;

  public RuleBacktestController(BacktestService backtests, ReviewService reviews) {
    this.backtests = backtests;
    this.reviews = reviews;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object request(Principal principal, @RequestBody BacktestService.Request input) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return backtests.request(user, input);
  }

  @GetMapping
  public Object list(Principal principal, @RequestParam long ruleId) {
    reviews.actor(reviews.userId(principal));
    return backtests.list(ruleId);
  }

  @GetMapping("/{backtestId}")
  public Object view(Principal principal, @PathVariable long backtestId) {
    reviews.actor(reviews.userId(principal));
    return backtests.view(backtestId);
  }

  @PostMapping("/{backtestId}/cancel")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object cancel(Principal principal, @PathVariable long backtestId) {
    reviews.actor(reviews.userId(principal));
    return backtests.cancel(backtestId);
  }
}
