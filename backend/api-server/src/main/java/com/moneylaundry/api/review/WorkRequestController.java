package com.moneylaundry.api.review;

import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/review/work-requests")
public class WorkRequestController {
  private final WorkRequestService requests;
  private final ReviewService reviews;

  public WorkRequestController(WorkRequestService requests, ReviewService reviews) {
    this.requests = requests;
    this.reviews = reviews;
  }

  @GetMapping
  public Object list(Principal principal) {
    return requests.list(reviews.userId(principal));
  }

  @PostMapping
  public Object send(Principal principal, @RequestBody WorkRequestService.Send input) {
    return requests.send(reviews.userId(principal), input);
  }

  @PostMapping("/{id}/resolve")
  public Object resolve(
      @PathVariable long id, Principal principal, @RequestBody WorkRequestService.Resolve input) {
    return requests.resolve(reviews.userId(principal), id, input);
  }

  @PostMapping("/read")
  public Object read(Principal principal, @RequestBody WorkRequestService.Read input) {
    return requests.read(reviews.userId(principal), input);
  }
}
