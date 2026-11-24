package com.moneylaundry.api.rules;

import com.moneylaundry.api.review.ReviewService;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleCompiler;
import java.security.Principal;
import java.util.LinkedHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 룰 엔진 화면: 템플릿 카탈로그, 룰 목록·상세, 저장 전 검증, 룰 만들기, 초안 저장·삭제. */
@RestController
@RequestMapping("/api/v1")
public class RuleController {
  private final RuleService rules;
  private final RuleQueryService queries;
  private final RuleCatalog catalog;
  private final ReviewService reviews;

  public RuleController(
      RuleService rules, RuleQueryService queries, RuleCatalog catalog, ReviewService reviews) {
    this.rules = rules;
    this.queries = queries;
    this.catalog = catalog;
    this.reviews = reviews;
  }

  private boolean admin(long user) {
    return "ADMIN".equals(reviews.actor(user).get("role"));
  }

  @GetMapping("/rule-templates")
  public Object templates(Principal principal) {
    reviews.actor(reviews.userId(principal));
    var view = new LinkedHashMap<>(catalog.view());
    // 평가기가 있어 백테스트를 돌릴 수 있는 템플릿
    view.put("backtestTemplates", RuleCompiler.SUPPORTED.stream().sorted().toList());
    return view;
  }

  @GetMapping("/rules")
  public Object list(Principal principal) {
    reviews.actor(reviews.userId(principal));
    return queries.list();
  }

  @GetMapping("/rules/{ruleId}")
  public Object detail(@PathVariable long ruleId, Principal principal) {
    long user = reviews.userId(principal);
    return queries.detail(ruleId, user, admin(user));
  }

  @PostMapping("/rules/validate")
  public Object validate(Principal principal, @RequestBody RuleService.ValidateInput input) {
    reviews.actor(reviews.userId(principal));
    return rules.validate(input);
  }

  @PostMapping("/rules")
  public Object create(Principal principal, @RequestBody RuleService.CreateInput input) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.create(user, input);
  }

  @PutMapping("/rules/{ruleId}/versions/{versionId}")
  public Object save(
      @PathVariable long ruleId,
      @PathVariable long versionId,
      Principal principal,
      @RequestBody RuleService.SaveInput input) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.save(ruleId, versionId, user, input);
  }

  @DeleteMapping("/rules/{ruleId}/versions/{versionId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable long ruleId, @PathVariable long versionId, Principal principal) {
    long user = reviews.userId(principal);
    rules.delete(ruleId, versionId, user, admin(user));
  }
}
