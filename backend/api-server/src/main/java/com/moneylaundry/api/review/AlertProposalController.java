package com.moneylaundry.api.review;

import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/review/alert-proposals")
public class AlertProposalController {
  private final AlertProposalService proposals;
  private final ReviewService reviews;

  public AlertProposalController(AlertProposalService proposals, ReviewService reviews) {
    this.proposals = proposals;
    this.reviews = reviews;
  }

  @GetMapping("/{id}")
  public Object detail(@PathVariable long id, Principal principal) {
    return proposals.detail(id, reviews.userId(principal));
  }

  @PostMapping("/{id}/votes")
  public Object vote(
      @PathVariable long id, Principal principal, @RequestBody AlertProposalService.Vote vote) {
    return proposals.vote(id, reviews.userId(principal), vote);
  }
}
