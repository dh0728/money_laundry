package com.moneylaundry.api.review;

import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class ReviewController {
  private final ReviewService reviews;

  public ReviewController(ReviewService reviews) {
    this.reviews = reviews;
  }

  @GetMapping("/review/board")
  public Object board() {
    return reviews.board();
  }

  @PostMapping("/review/cases/{id}/read")
  public Object read(@PathVariable long id, Principal principal) {
    return reviews.read(id, reviews.userId(principal));
  }

  @PostMapping("/review/cases/{id}/start")
  public Object start(@PathVariable long id, Principal principal) {
    return reviews.start(id, reviews.userId(principal));
  }

  @PostMapping("/review/cases/{id}/judgment")
  public Object judge(
      @PathVariable long id, Principal principal, @RequestBody ReviewService.Judgment input) {
    return reviews.judge(id, reviews.userId(principal), input);
  }

  @PostMapping("/review/cases/{id}/transaction-edits")
  public Object editTransactions(
      @PathVariable long id,
      Principal principal,
      @RequestBody ReviewService.TransactionEdit input) {
    return reviews.editTransactions(id, reviews.userId(principal), input);
  }

  @PostMapping("/review/episodes")
  public Object createEpisode(Principal principal, @RequestBody ReviewService.EpisodeChange input) {
    return reviews.linkAlerts(null, reviews.userId(principal), input);
  }

  @PostMapping("/review/episodes/{id}/alerts")
  public Object addToEpisode(
      @PathVariable long id, Principal principal, @RequestBody ReviewService.EpisodeChange input) {
    return reviews.linkAlerts(id, reviews.userId(principal), input);
  }

  @PostMapping("/review/episodes/{id}/unlink")
  public Object unlink(
      @PathVariable long id, Principal principal, @RequestBody ReviewService.EpisodeChange input) {
    return reviews.unlinkAlerts(id, reviews.userId(principal), input);
  }
}
