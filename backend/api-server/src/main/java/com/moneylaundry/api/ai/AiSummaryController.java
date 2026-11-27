package com.moneylaundry.api.ai;

import com.moneylaundry.api.review.ReviewService;
import java.security.Principal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Alert · Episode 개요의 AI 요약. 로그인한 직원이면 읽을 수 있다(룰 적중 조회와 같은 권한). */
@RestController
@RequestMapping("/api/v1/ai-summary")
public class AiSummaryController {
  private final AiSummaryService summaries;
  private final ReviewService reviews;

  public AiSummaryController(AiSummaryService summaries, ReviewService reviews) {
    this.summaries = summaries;
    this.reviews = reviews;
  }

  @GetMapping("/dashboard")
  public AiSummaryService.Dashboard dashboard(Principal principal) {
    reviews.actor(reviews.userId(principal));
    return summaries.forDashboard();
  }

  @GetMapping("/cases/{caseId}")
  public AiSummaryService.Summary forCase(@PathVariable long caseId, Principal principal) {
    reviews.actor(reviews.userId(principal));
    return summaries.forCase(caseId);
  }
}
