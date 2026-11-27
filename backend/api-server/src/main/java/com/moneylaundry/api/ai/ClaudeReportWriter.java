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

/** Claude 로 STR 작성을 위한 분석 보고서의 서술을 쓴다. 키가 없으면 부르지 않는다. 응답은 구조화 출력(JSON 스키마)이다. */
@Component
public class ClaudeReportWriter implements AiReportService.Writer {
  static final String PROMPT_VERSION = "str-report-v1";
  static final String SYSTEM =
      """
      너는 금융회사 AML 담당자가 법정 의심거래보고(STR)를 작성할 때 참고할 분석 보고서의 서술 부분을 정리한다.
      이 문서는 제출용이 아니라 담당자가 옮겨 쓸 재료다. 입력은 코드가 계산한 사실 목록이고 각 사실 앞에 F1, F2 같은 번호가 있다.

      규칙
      1. 사실 목록에 있는 내용만 쓴다. 새로운 사실, 추측, 외부 지식을 더하지 않는다.
      2. 숫자, 날짜, 계좌 번호는 사실 목록에 적힌 그대로 옮긴다. 더하거나 나누거나 반올림하지 않는다.
      3. 문장마다 근거 사실 번호를 sources 에 적는다. 근거가 없는 문장은 쓰지 않는다.
      4. 혐의 여부, 혐의도, 전제범죄를 단정하지 않는다. 모델 결과는 "모델 추정", 룰은 "룰 해당", 담당자 판정은 "담당자 판단"으로 구분한다.
      5. 입력에 없는 정보(거래자 신원, 계좌번호, 거래채널 등)는 문장을 지어내지 말고 그 항목을 비워 둔다.
      6. 문체는 공문서 보고서체 개조식이다. 문장은 "~함", "~임", "~됨", "~하였음"으로 끝낸다.
         "돈이 모였다", "빠져나갔다" 같은 구어 대신 "자금이 집중됨", "외부로 이전됨"처럼 쓴다.
      7. 항목: overview(분석 요지 3~4문장), subject(1 거래자), dates(2 거래발생일자), places(3 거래발생장소),
         instruments(4 수단), method(5 방법·특이거래), grounds(6 혐의거래로 판단한 사유), opinion(7 종합의견).
         각 항목은 1~3문장이고, 문장은 120자 이내다.
      """;

  private static final Logger log = LoggerFactory.getLogger(ClaudeReportWriter.class);

  record SentenceOut(
      @JsonPropertyDescription("보고서체 문장, 120자 이내") String text,
      @JsonPropertyDescription("근거 사실 번호 목록, 예: [\"F2\"]") List<String> sources) {}

  record NarrativeOut(
      @JsonPropertyDescription("분석 요지 3~4문장") List<SentenceOut> overview,
      @JsonPropertyDescription("1) 거래자") List<SentenceOut> subject,
      @JsonPropertyDescription("2) 거래발생일자") List<SentenceOut> dates,
      @JsonPropertyDescription("3) 거래발생장소") List<SentenceOut> places,
      @JsonPropertyDescription("4) 수단(상품)") List<SentenceOut> instruments,
      @JsonPropertyDescription("5) 방법(특이거래)") List<SentenceOut> method,
      @JsonPropertyDescription("6) 혐의거래로 판단한 사유") List<SentenceOut> grounds,
      @JsonPropertyDescription("7) 종합의견") List<SentenceOut> opinion) {}

  private final AnthropicClient client;
  private final String model;

  public ClaudeReportWriter(
      @Value("${app.ai.anthropic-api-key:}") String apiKey,
      @Value("${app.ai.report-model:claude-sonnet-5-5}") String model) {
    this.model = model;
    this.client =
        apiKey.isBlank()
            ? null
            : AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofSeconds(120))
                .build();
  }

  @Override
  public String model() {
    return model;
  }

  @Override
  public boolean available() {
    return client != null;
  }

  @Override
  public Optional<AiReportService.Narrative> write(CaseFacts.Facts facts) {
    if (client == null) return Optional.empty();
    var input = new StringBuilder();
    input
        .append("EPISODE".equals(facts.kind()) ? "Episode" : "Alert")
        .append(' ')
        .append(facts.caseId())
        .append(" 사실 목록\n");
    for (var fact : facts.facts())
      input.append(fact.id()).append(": ").append(fact.text()).append('\n');
    StructuredMessageCreateParams<NarrativeOut> params =
        MessageCreateParams.builder()
            .model(model)
            .maxTokens(8000L)
            .system(SYSTEM)
            .outputConfig(NarrativeOut.class)
            .addUserMessage(input.toString())
            .build();
    try {
      var response = client.messages().create(params);
      if (response.stopReason().map(r -> "refusal".equals(r.toString())).orElse(false)) {
        log.warn("AI report refused for case {}", facts.caseId());
        return Optional.empty();
      }
      return response.content().stream()
          .flatMap(block -> block.text().stream())
          .findFirst()
          .map(
              typed -> {
                NarrativeOut out = typed.text();
                return new AiReportService.Narrative(
                    convert(out.overview()),
                    convert(out.subject()),
                    convert(out.dates()),
                    convert(out.places()),
                    convert(out.instruments()),
                    convert(out.method()),
                    convert(out.grounds()),
                    convert(out.opinion()));
              });
    } catch (AnthropicException e) {
      log.warn(
          "AI report call failed for case {}: {}", facts.caseId(), e.getClass().getSimpleName());
      return Optional.empty();
    }
  }

  private static List<AiReportService.Sentence> convert(List<SentenceOut> sentences) {
    return sentences == null
        ? List.of()
        : sentences.stream().map(s -> new AiReportService.Sentence(s.text(), s.sources())).toList();
  }
}
