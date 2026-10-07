package com.moneylaundry.api.review;

import com.moneylaundry.api.auth.StaffAccounts;
import java.security.Principal;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/demo/reset")
public class DemoResetController {
  private final DemoResetService service;
  private final StaffAccounts accounts;

  public DemoResetController(DemoResetService service, StaffAccounts accounts) {
    this.service = service;
    this.accounts = accounts;
  }

  private long actor(Principal principal) {
    return ((Number) accounts.account(principal.getName()).get("id")).longValue();
  }

  @GetMapping("/preview")
  public Object preview(Principal principal) {
    return service.preview(actor(principal));
  }

  @GetMapping("/latest")
  public Object latest(Principal principal) {
    return service.latest(actor(principal));
  }

  @GetMapping("/{id}")
  public Object status(Principal principal, @PathVariable UUID id) {
    return service.status(actor(principal), id);
  }

  @PostMapping
  public Object reset(Principal principal, @RequestBody DemoResetService.ResetInput input) {
    return service.reset(actor(principal), input);
  }

  @PostMapping("/{id}/cleanup")
  public Object cleanup(Principal principal, @PathVariable UUID id) {
    return service.cleanup(actor(principal), id);
  }
}
