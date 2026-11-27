package com.moneylaundry.api.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicException;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Claude 로 Alert · Episode 요약을 쓴다. API 키가 없으면 부르지 않고 빈 값을 돌려준다. 응답은 구조화 출력(JSON 스키마)으로 받는다. */
@Component
public class ClaudeSummaryWriter implements AiSummaryService.Writer {
  static final String PROMPT_VERSION = "summary-v4";
  static final String SYSTEM =
      """
      너는 자금세탁 의심 거래를 조사하는 담당자에게 Alert, Episode, 또는 기관 전체 대시보드의 현재 상황을 요약해 준다.
      입력은 코드가 계산한 사실 목록이다. 각 사실 앞에 F1, F2 같은 번호가 붙어 있다.

      규칙
      1. 사실 목록에 있는 내용만 쓴다. 새 사실, 추측, 외부 지식을 더하지 않는다.
      2. 숫자, 날짜, 계좌 번호는 사실 목록에 적힌 그대로 옮긴다. 새로 더하거나 나누거나 반올림하지 않는다.
      3. headline 은 이 건에서 가장 먼저 봐야 할 점을 한 문장(60자 이내)으로 쓴다.
      4. points 는 근거 문장 3개를 쓴다. 각 문장은 80자 이내이고, sources 에 근거 사실 번호를 적는다.
      5. 세탁 여부를 단정하지 않는다. 모델 점수와 유형은 "모델 추정", 룰은 "룰 해당"이라고 구분한다.
      6. Episode 면 소속 Alert 들이 어떤 계좌로 이어지는지를 먼저 쓴다.
      7. 대시보드면 headline 에 종합 위험지수 점수와 단계를 쓰고, points 에는 지표 점수가 높은 지표부터 평소 대비 배수와 함께 원인을 쓴다.
         의심 거래 유형별 건수가 있으면 가장 많은 유형을 한 문장에 넣는다.
      8. 자금 경로나 같은 계좌가 나오는 다른 Alert 사실이 있으면 근거 문장에 활용한다.
      9. 화면에 바로 보이는 안내문이다. 모든 문장은 "~입니다", "~합니다", "~했습니다"처럼 친절한 존댓말로 끝낸다.
         "~함", "~임", "~됨" 같은 개조식 끝맺음은 쓰지 않는다.
      """;

  private static final Logger log = LoggerFactory.getLogger(ClaudeSummaryWriter.class);

  record PointOut(
      @JsonPropertyDescription("근거 문장, 80자 이내") String text,
      @JsonPropertyDescription("근거 사실 번호 목록, 예: [\"F2\", \"F5\"]") List<String> sources) {}

  record SummaryOut(
      @JsonPropertyDescription("가장 먼저 봐야 할 점 한 문장, 60자 이내") String headline,
      @JsonPropertyDescription("근거 문장 3개") List<PointOut> points) {}

  private final AnthropicClient client;
  private final String model;

  public ClaudeSummaryWriter(
      @Value("${app.ai.anthropic-api-key:}") String apiKey,
      @Value("${app.ai.model:claude-haiku-5-5}") String model) {
    this.model = model;
    this.client =
        apiKey.isBlank()
            ? null
            : AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofSeconds(60))
                .build();
  }

  @Override
  public String model() {
    return model + "/" + PROMPT_VERSION;
  }

  @Override
  public Optional<AiSummaryService.Written> write(CaseFacts.Facts facts) {
    if (client == null) return Optional.empty();
    var input = new StringBuilder();
    input
        .append(
            switch (facts.kind()) {
              case "EPISODE" -> "Episode";
              case "DASHBOARD" -> "기관 전체 대시보드";
              default -> "Alert";
            })
        .append(" 사실 목록\n");
    for (var fact : facts.facts())
      input.append(fact.id()).append(": ").append(fact.text()).append('\n');
    StructuredMessageCreateParams<SummaryOut> params =
        MessageCreateParams.builder()
            .model(model)
            .maxTokens(4000L)
            .system(SYSTEM)
            .outputConfig(SummaryOut.class)
            .addUserMessage(input.toString())
            .build();
    try {
      var response = client.messages().create(params);
      if (response.stopReason().map(r -> "refusal".equals(r.toString())).orElse(false)) {
        log.warn("AI summary refused for case {}", facts.caseId());
        return Optional.empty();
      }
      return response.content().stream()
          .flatMap(block -> block.text().stream())
          .findFirst()
          .map(
              typed -> {
                SummaryOut out = typed.text();
                var points =
                    out.points() == null
                        ? List.<AiSummaryService.Point>of()
                        : out.points().stream()
                            .map(p -> new AiSummaryService.Point(p.text(), p.sources()))
                            .toList();
                return new AiSummaryService.Written(out.headline(), points);
              });
    } catch (AnthropicException e) {
      log.warn(
          "AI summary call failed for case {}: {}", facts.caseId(), e.getClass().getSimpleName());
      return Optional.empty();
    }
  }
}
