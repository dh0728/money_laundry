package com.moneylaundry.api.rules;

import com.moneylaundry.api.review.ReviewService;
import com.moneylaundry.api.rules.catalog.RuleCatalog;
import com.moneylaundry.api.rules.engine.RuleCompiler;
import java.security.Principal;
import java.util.LinkedHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 룰 엔진 화면: 템플릿 카탈로그, 룰 목록·상세, 저장 전 검증, 룰 만들기, 초안 저장·삭제, 새 버전, 상태 명령, 사건의 룰 적중. */
@RestController
@RequestMapping("/api/v1")
public class RuleController {
  private final RuleService rules;
  private final RuleQueryService queries;
  private final RuleCatalog catalog;
  private final ReviewService reviews;
  private final RuleHitQuery hits;

  public RuleController(
      RuleService rules,
      RuleQueryService queries,
      RuleCatalog catalog,
      ReviewService reviews,
      RuleHitQuery hits) {
    this.rules = rules;
    this.queries = queries;
    this.catalog = catalog;
    this.reviews = reviews;
    this.hits = hits;
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

  /** 운영 버전을 복사해 새 초안을 만든다. */
  @PostMapping("/rules/{ruleId}/versions")
  public Object newVersion(@PathVariable long ruleId, Principal principal) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.newVersion(ruleId, user);
  }

  /** 복제. 이 룰의 조건을 가진 새 룰의 초안을 만든다. 본문은 없어도 된다. */
  @PostMapping("/rules/{ruleId}/clone")
  public Object clone(
      @PathVariable long ruleId,
      @RequestBody(required = false) RuleService.CloneInput input,
      Principal principal) {
    long user = reviews.userId(principal);
    reviews.actor(user);
    return rules.clone(ruleId, user, input);
  }

  /** 상태 명령. 바뀐 룰 상세를 돌려준다. */
  @PostMapping("/rules/{ruleId}/commands")
  public Object command(
      @PathVariable long ruleId, Principal principal, @RequestBody RuleService.CommandInput input) {
    long user = reviews.userId(principal);
    boolean admin = admin(user);
    rules.command(ruleId, user, admin, input);
    return queries.detail(ruleId, user, admin);
  }

  /** Alert · Episode 의 현재 거래에 걸린 운영 룰 적중. */
  @GetMapping("/review/cases/{caseId}/rule-hits")
  public Object caseHits(@PathVariable long caseId, Principal principal) {
    reviews.actor(reviews.userId(principal));
    return hits.forCase(caseId);
  }

  @DeleteMapping("/rules/{ruleId}/versions/{versionId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable long ruleId, @PathVariable long versionId, Principal principal) {
    long user = reviews.userId(principal);
    rules.delete(ruleId, versionId, user, admin(user));
  }
}
