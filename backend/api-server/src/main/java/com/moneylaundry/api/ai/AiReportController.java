package com.moneylaundry.api.ai;

import com.moneylaundry.api.review.ReviewService;
import java.security.Principal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 법정 STR 작성을 위한 분석 보고서. 저장된 보고서가 있으면 그것을, 없거나 regenerate=true 면 새로 만든다. */
@RestController
@RequestMapping("/api/v1/ai-reports")
public class AiReportController {
  private final AiReportService reports;
  private final ReviewService reviews;

  public AiReportController(AiReportService reports, ReviewService reviews) {
    this.reports = reports;
    this.reviews = reviews;
  }

  @PostMapping("/judgments/{judgmentId}")
  public AiReportService.Report forJudgment(
      @PathVariable long judgmentId,
      @RequestParam(defaultValue = "false") boolean regenerate,
      Principal principal) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return reports.forJudgment(judgmentId, user, regenerate);
  }
}
