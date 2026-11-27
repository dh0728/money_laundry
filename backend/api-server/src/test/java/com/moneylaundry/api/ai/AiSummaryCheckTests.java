package com.moneylaundry.api.ai;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Claude 가 쓴 요약을 사실 목록과 맞춰 보는 검사. */
class AiSummaryCheckTests {
  static final List<CaseFacts.Fact> FACTS =
      List.of(
          new CaseFacts.Fact("F1", "Alert 7, 상태 처리 중"),
          new CaseFacts.Fact("F2", "근거 거래 18건, 씨앗 거래 3건"),
          new CaseFacts.Fact("F3", "외부 유입 65,700 USD"));

  static AiSummaryService.Point point(String text, String... sources) {
    return new AiSummaryService.Point(text, List.of(sources));
  }

  @Test
  void keeps_points_whose_numbers_and_sources_are_in_the_facts() {
    var written =
        new AiSummaryService.Written(
            "근거 거래 18건 중 씨앗 거래 3건임",
            List.of(point("외부 유입 65,700 USD가 들어옴", "F3"), point("씨앗 거래 3건임", "F2")));
    var checked = AiSummaryService.checked(written, FACTS);
    assertThat(checked).isPresent();
    assertThat(checked.get().points()).hasSize(2);
  }

  @Test
  void drops_points_with_invented_numbers_or_unknown_sources() {
    var written =
        new AiSummaryService.Written(
            "근거 거래 18건임",
            List.of(
                point("유입의 83.0%가 유출됨", "F3"),
                point("씨앗 거래 3건임", "F9"),
                point("씨앗 거래 3건임"),
                point("외부 유입 65700 USD임", "F3")));
    var checked = AiSummaryService.checked(written, FACTS);
    assertThat(checked).isPresent();
    assertThat(checked.get().points())
        .extracting(AiSummaryService.Point::text)
        .containsExactly("외부 유입 65700 USD임");
  }

  @Test
  void rejects_the_whole_summary_when_the_headline_invents_a_number_or_nothing_survives() {
    assertThat(
            AiSummaryService.checked(
                new AiSummaryService.Written("거래 20건임", List.of(point("씨앗 거래 3건임", "F2"))), FACTS))
        .isEmpty();
    assertThat(
            AiSummaryService.checked(
                new AiSummaryService.Written("씨앗 거래 3건임", List.of(point("거래 99건", "F2"))), FACTS))
        .isEmpty();
    assertThat(AiSummaryService.checked(new AiSummaryService.Written(" ", List.of()), FACTS))
        .isEmpty();
  }
}
