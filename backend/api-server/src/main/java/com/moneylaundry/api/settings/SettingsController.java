package com.moneylaundry.api.settings;

import com.moneylaundry.api.review.ReviewService;
import java.security.Principal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/settings")
public class SettingsController {
  private final SettingsService settings;
  private final ReviewService reviews;

  public SettingsController(SettingsService settings, ReviewService reviews) {
    this.settings = settings;
    this.reviews = reviews;
  }

  private boolean admin(long user) {
    return "ADMIN".equals(reviews.actor(user).get("role"));
  }

  @PostMapping("/team/{id}/role")
  public Object role(
      @PathVariable long id, Principal principal, @RequestBody SettingsService.Role input) {
    long user = reviews.userId(principal);
    return settings.role(id, user, admin(user), input);
  }

  @GetMapping("/model-risk-bands")
  public Object bands(Principal principal) {
    reviews.actor(reviews.userId(principal));
    return settings.bands();
  }

  @PostMapping("/model-risk-bands")
  public Object bands(Principal principal, @RequestBody SettingsService.Bands input) {
    long user = reviews.userId(principal);
    return settings.bands(user, admin(user), input);
  }
}
