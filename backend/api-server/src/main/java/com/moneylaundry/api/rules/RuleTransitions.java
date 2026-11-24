package com.moneylaundry.api.rules;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 버전의 상태를 바꾸는 명령 표. 명령을 받는 쪽(RuleService)과 화면에 "지금 누를 수 있는 명령"을 알려 주는 쪽(RuleQueryService)이 같은 표를
 * 본다.
 *
 * <pre>
 * DRAFT ─시험 운영 시작→ SHADOW ─승인 요청→ PENDING ─승인→ ACTIVE ─중지→ PAUSED
 *   └────────────── 승인 요청 ──────────────┘   └반려·되돌리기→ DRAFT   └──재개──┘
 * </pre>
 */
final class RuleTransitions {
  private RuleTransitions() {}

  /** 누가 할 수 있는가 */
  enum Who {
    AUTHOR,
    AUTHOR_OR_ADMIN,
    ADMIN
  }

  /**
   * @param from 이 상태일 때만 할 수 있다
   * @param to 바뀐 뒤의 상태
   * @param event 변경 기록(rules.events.action)에 남는 이름
   * @param backtest 지금 조건으로 끝낸 백테스트가 있어야 한다
   * @param comment 사유가 꼭 있어야 한다
   */
  record Transition(
      Set<String> from, String to, String event, Who who, boolean backtest, boolean comment) {}

  /** 화면에 보여 주는 순서대로. */
  static final List<String> ACTIONS =
      List.of("START_SHADOW", "SUBMIT", "WITHDRAW", "APPROVE", "REJECT", "PAUSE", "RESUME");

  private static final Map<String, Transition> TABLE =
      Map.of(
          "START_SHADOW",
          new Transition(
              Set.of("DRAFT"), "SHADOW", "SHADOW_STARTED", Who.AUTHOR_OR_ADMIN, true, false),
          "SUBMIT",
          new Transition(
              Set.of("DRAFT", "SHADOW"), "PENDING", "SUBMITTED", Who.AUTHOR, true, false),
          "WITHDRAW",
          new Transition(
              Set.of("SHADOW", "PENDING"), "DRAFT", "WITHDRAWN", Who.AUTHOR, false, false),
          "APPROVE",
          new Transition(Set.of("PENDING"), "ACTIVE", "APPROVED", Who.ADMIN, false, true),
          "REJECT",
          new Transition(Set.of("PENDING"), "DRAFT", "REJECTED", Who.ADMIN, false, true),
          "PAUSE",
          new Transition(Set.of("ACTIVE"), "PAUSED", "PAUSED", Who.ADMIN, false, true),
          "RESUME",
          new Transition(Set.of("PAUSED"), "ACTIVE", "RESUMED", Who.ADMIN, false, true));

  /** 없는 명령이면 null. */
  static Transition of(String action) {
    return action == null ? null : TABLE.get(action);
  }

  /** 이 사람이 할 수 없는 명령이면 그 이유, 할 수 있으면 null. */
  static String forbidden(
      String action, Transition t, boolean author, boolean admin, boolean selfApproval) {
    boolean allowed =
        switch (t.who()) {
          case AUTHOR -> author;
          case AUTHOR_OR_ADMIN -> author || admin;
          case ADMIN -> admin;
        };
    if (!allowed)
      return switch (t.who()) {
        case AUTHOR -> "작성자만 할 수 있습니다.";
        case AUTHOR_OR_ADMIN -> "작성자와 관리자만 할 수 있습니다.";
        case ADMIN -> "관리자만 할 수 있습니다.";
      };
    if ("APPROVE".equals(action) && author && !selfApproval) return "자기가 쓴 버전은 승인할 수 없습니다.";
    return null;
  }

  static final String NEEDS_BACKTEST = "지금 조건으로 끝낸 백테스트가 있어야 합니다.";
}
