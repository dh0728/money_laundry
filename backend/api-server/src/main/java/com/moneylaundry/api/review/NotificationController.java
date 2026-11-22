package com.moneylaundry.api.review;

import java.security.Principal;
import java.time.LocalDate;
import org.springframework.web.bind.annotation.*;

/** 업무 알림 목록·관련 사건·읽음 처리 API(/api/v1/notifications). */
@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
  private final NotificationService notifications;
  private final ReviewService reviews;

  public NotificationController(NotificationService notifications, ReviewService reviews) {
    this.notifications = notifications;
    this.reviews = reviews;
  }

  private long actor(Principal principal) {
    long id = reviews.userId(principal);
    reviews.actor(id);
    return id;
  }

  @GetMapping
  public Object list(
      Principal principal,
      @RequestParam(required = false) LocalDate from,
      @RequestParam(required = false) LocalDate to,
      @RequestParam(required = false) String query,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return notifications.list(actor(principal), from, to, query, page, size);
  }

  @GetMapping("/{id}/cases")
  public Object cases(
      Principal principal,
      @PathVariable String id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return notifications.cases(actor(principal), id, page, size);
  }

  @PostMapping("/read")
  public Object read(Principal principal, @RequestBody NotificationService.ReadInput input) {
    return notifications.read(actor(principal), input);
  }
}
