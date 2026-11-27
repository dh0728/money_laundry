package com.moneylaundry.api.ai;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.common.BusinessTime;
import com.moneylaundry.api.review.ReviewJson;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 법정 STR 작성을 위한 분석 보고서. '의심' 판정 하나를 근거로 코드가 사실 목록을 만들고, Claude 가 STR 서식 VII 순서의 서술을 쓴다. 결과는
 * review.ai_reports 에 쌓고, 다시 만들라는 요청이 없으면 마지막 성공 보고서를 돌려준다. 만들기·보기는 대상 Alert·Episode 담당자와 관리자만 한다.
 */
@Service
public class AiReportService {
  /** 서술 한 문장과 근거 사실 번호. */
  public record Sentence(String text, List<String> sources) {}

  /** STR 서식 VII 의 1)~7) 과 분석 요지. */
  public record Narrative(
      List<Sentence> overview,
      List<Sentence> subject,
      List<Sentence> dates,
      List<Sentence> places,
      List<Sentence> instruments,
      List<Sentence> method,
      List<Sentence> grounds,
      List<Sentence> opinion) {}

  /** Claude 로 서술을 쓰는 쪽. 키가 없거나 거절·실패하면 빈 값이다. */
  public interface Writer {
    String model();

    /** Claude 키가 있어 부를 수 있는가. 없으면 판정 직후 뒤의 생성을 하지 않는다. */
    boolean available();

    Optional<Narrative> write(CaseFacts.Facts facts);
  }

  public record Report(
      long reportId,
      long judgmentId,
      long caseId,
      String kind,
      String status,
      List<CaseFacts.Fact> facts,
      Narrative narrative,
      List<String> needsBankCheck,
      String model,
      Instant createdAt) {}

  /** 우리 데이터에 없어 은행이 채워야 하는 STR 서식 항목. */
  static final List<String> NEEDS_BANK_CHECK =
      List.of(
          "거래자 성명, 실명번호, 직업 및 주소 (서식 II)",
          "계좌번호, 계좌 개설일 및 개설 목적 (서식 IV)",
          "송금인·수취인 신원 및 상대 국가 (서식 V)",
          "거래채널(창구, 인터넷뱅킹 등) 및 거래종류(입금, 이체 등 서식 코드) (서식 III)");

  private final JdbcTemplate jdbc;
  private final CaseFacts caseFacts;
  private final Writer writer;
  private final BusinessTime time;

  /** 다운로드가 뒤의 생성을 기다리는 최대 시간 */
  static final long WAIT_SECONDS = 150;

  private final java.util.concurrent.ConcurrentHashMap<
          Long, java.util.concurrent.CompletableFuture<Optional<Report>>>
      inFlight = new java.util.concurrent.ConcurrentHashMap<>();
  // 보고서는 한 번에 하나씩 만든다(Claude 호출 수와 DB 연결을 늘리지 않는다)
  private final java.util.concurrent.ExecutorService background =
      java.util.concurrent.Executors.newSingleThreadExecutor(
          r -> {
            var t = new Thread(r, "ai-report");
            t.setDaemon(true);
            return t;
          });

  public AiReportService(JdbcTemplate jdbc, CaseFacts caseFacts, Writer writer, BusinessTime time) {
    this.jdbc = jdbc;
    this.caseFacts = caseFacts;
    this.writer = writer;
    this.time = time;
  }

  static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE, "AI_REPORT_UNAVAILABLE", "AI 보고서를 만들지 못했습니다.");
  }

  public Report forJudgment(long judgmentId, long user, boolean regenerate) {
    var rows = judgmentRow(judgmentId, user);
    if (rows.isEmpty()) throw ApiException.notFound("판정이 없습니다.");
    var j = rows.getFirst();
    if (!"ADMIN".equals(j.get("role")) && ReviewJson.number(j.get("assignee_id")) != user)
      throw new ApiException(
          HttpStatus.FORBIDDEN, "AI_REPORT_FORBIDDEN", "담당자와 관리자만 AI 보고서를 볼 수 있습니다.");
    if (!"SUSPICIOUS".equals(j.get("verdict")))
      throw new ApiException(
          HttpStatus.CONFLICT, "AI_REPORT_NOT_SUSPICIOUS", "'이상'으로 판정한 건만 AI 보고서를 만듭니다.");
    if (!regenerate) {
      var saved = latest(judgmentId);
      if (saved.isPresent()) return saved.get();
      // 판정 직후 뒤에서 만드는 중이면 그 결과를 기다린다. 두 번 만들지 않는다.
      var running = inFlight.get(judgmentId);
      if (running != null) {
        try {
          var done = running.get(WAIT_SECONDS, java.util.concurrent.TimeUnit.SECONDS);
          if (done.isPresent()) return done.get();
        } catch (java.util.concurrent.TimeoutException e) {
          throw unavailable();
        } catch (InterruptedException e) {
          Thread.currentThread().interrupt();
          throw unavailable();
        } catch (java.util.concurrent.ExecutionException e) {
          // 뒤의 생성이 실패했으면 아래에서 다시 만든다
        }
        var made = latest(judgmentId);
        if (made.isPresent()) return made.get();
      }
    }
    return generate(j, user).orElseThrow(AiReportService::unavailable);
  }

  /** '의심' 판정이 커밋되면 뒤에서 보고서를 만들어 둔다. 판정 저장은 Claude 를 기다리지 않는다. 실패하면 FAILED 줄만 남고, 다운로드할 때 다시 만든다. */
  @org.springframework.transaction.event.TransactionalEventListener(
      phase = org.springframework.transaction.event.TransactionPhase.AFTER_COMMIT)
  public void onJudgment(com.moneylaundry.api.review.ReviewService.JudgmentRecorded event) {
    // 키가 없으면 만들 수 없으니 FAILED 줄도 남기지 않는다
    if (!"SUSPICIOUS".equals(event.verdict()) || !writer.available()) return;
    var future = new java.util.concurrent.CompletableFuture<Optional<Report>>();
    if (inFlight.putIfAbsent(event.judgmentId(), future) != null) return;
    background.submit(
        () -> {
          try {
            var rows = judgmentRow(event.judgmentId(), event.reviewerId());
            future.complete(
                rows.isEmpty() ? Optional.empty() : generate(rows.getFirst(), event.reviewerId()));
          } catch (RuntimeException e) {
            future.completeExceptionally(e);
          } finally {
            inFlight.remove(event.judgmentId(), future);
          }
        });
  }

  @jakarta.annotation.PreDestroy
  void stop() {
    background.shutdownNow();
  }

  private List<Map<String, Object>> judgmentRow(long judgmentId, long user) {
    return jdbc.queryForList(
        """
        select j.judgment_id, j.verdict, j.reason_category, j.evidence, j.observations, j.rationale,
               j.superseded_at, coalesce(j.alert_id, j.episode_id) as case_id,
               c.kind, c.assignee_id, u.role
        from review.judgments j join review.cases c on c.case_id = coalesce(j.alert_id, j.episode_id)
        join core.users u on u.user_id = ?
        where j.judgment_id = ?
        """,
        user,
        judgmentId);
  }

  /** 사실 목록을 만들고 Claude 로 서술을 받아 저장한다. 실패하면 FAILED 줄을 남기고 빈 값이다. */
  private Optional<Report> generate(Map<String, Object> j, long user) {
    long judgmentId = ReviewJson.number(j.get("judgment_id"));
    long caseId = ReviewJson.number(j.get("case_id"));
    var built = caseFacts.build(caseId);
    var facts = new ArrayList<>(built.facts());
    int n = facts.size();
    facts.add(
        new CaseFacts.Fact(
            "F" + (++n), "담당자 판정: 의심, 사유 분류 '" + reason(j.get("reason_category")) + "'"));
    facts.add(new CaseFacts.Fact("F" + (++n), "담당자 판단 근거: " + j.get("rationale")));
    if (j.get("evidence") instanceof String evidence && !evidence.isBlank())
      facts.add(new CaseFacts.Fact("F" + (++n), "담당자 검토 근거: " + evidence));
    if (j.get("observations") instanceof String observations && !observations.isBlank())
      facts.add(new CaseFacts.Fact("F" + (++n), "담당자 관찰 내용: " + observations));
    var input = new CaseFacts.Facts(caseId, built.kind(), List.copyOf(facts));
    var narrative = writer.write(input).flatMap(w -> checked(w, input.facts()));
    var factsJson = ReviewJson.encode(input.facts());
    long id =
        jdbc.queryForObject(
            """
            insert into review.ai_reports(judgment_id,status,facts,ai_output,input_digest,model,prompt_version,error_code,created_by,created_at)
            values(?,?,?::jsonb,?::jsonb,?,?,?,?,?,?) returning report_id
            """,
            Long.class,
            judgmentId,
            narrative.isPresent() ? "GENERATED" : "FAILED",
            factsJson,
            narrative.map(ReviewJson::encode).orElse(null),
            digest(factsJson),
            writer.model(),
            ClaudeReportWriter.PROMPT_VERSION,
            narrative.isPresent() ? null : "AI_REPORT_UNAVAILABLE",
            user,
            Timestamp.from(time.now()));
    if (narrative.isEmpty()) return Optional.empty();
    return latest(judgmentId).filter(r -> r.reportId() == id);
  }

  private Optional<Report> latest(long judgmentId) {
    var rows =
        jdbc.queryForList(
            """
            select r.report_id, r.facts::text as facts, coalesce(r.edited_output, r.ai_output)::text as output,
                   r.model, r.created_at, coalesce(j.alert_id, j.episode_id) as case_id,
                   case when j.alert_id is null then 'EPISODE' else 'ALERT' end as kind
            from review.ai_reports r join review.judgments j using(judgment_id)
            where r.judgment_id = ? and r.status = 'GENERATED' order by r.report_id desc limit 1
            """,
            judgmentId);
    if (rows.isEmpty()) return Optional.empty();
    var r = rows.getFirst();
    var facts =
        ReviewJson.rows(r.get("facts")).stream()
            .map(f -> new CaseFacts.Fact(f.get("id").toString(), f.get("text").toString()))
            .toList();
    return Optional.of(
        new Report(
            ReviewJson.number(r.get("report_id")),
            judgmentId,
            ReviewJson.number(r.get("case_id")),
            r.get("kind").toString(),
            "GENERATED",
            facts,
            ReviewJson.JSON.readValue(r.get("output").toString(), Narrative.class),
            NEEDS_BANK_CHECK,
            r.get("model").toString(),
            ((Timestamp) r.get("created_at")).toInstant()));
  }

  /** 요약과 같은 검사. 근거 없는 문장과 사실 목록에 없는 숫자를 쓴 문장을 버린다. 분석 요지와 판단 사유가 비면 쓰지 않는다. */
  static Optional<Narrative> checked(Narrative n, List<CaseFacts.Fact> facts) {
    Set<String> ids = facts.stream().map(CaseFacts.Fact::id).collect(Collectors.toSet());
    Set<String> numbers =
        facts.stream()
            .flatMap(f -> AiSummaryService.numbers(f.id() + " " + f.text()).stream())
            .collect(Collectors.toSet());
    var out =
        new Narrative(
            keep(n.overview(), ids, numbers),
            keep(n.subject(), ids, numbers),
            keep(n.dates(), ids, numbers),
            keep(n.places(), ids, numbers),
            keep(n.instruments(), ids, numbers),
            keep(n.method(), ids, numbers),
            keep(n.grounds(), ids, numbers),
            keep(n.opinion(), ids, numbers));
    return out.overview().isEmpty() || out.grounds().isEmpty()
        ? Optional.empty()
        : Optional.of(out);
  }

  private static List<Sentence> keep(
      List<Sentence> sentences, Set<String> ids, Set<String> numbers) {
    var out = new ArrayList<Sentence>();
    for (var s : sentences == null ? List.<Sentence>of() : sentences)
      if (s != null
          && s.text() != null
          && !s.text().isBlank()
          && s.sources() != null
          && !s.sources().isEmpty()
          && ids.containsAll(s.sources())
          && numbers.containsAll(AiSummaryService.numbers(s.text())))
        out.add(new Sentence(s.text().trim(), List.copyOf(s.sources())));
    return List.copyOf(out);
  }

  private static String reason(Object category) {
    var labels =
        new LinkedHashMap<String, String>(
            Map.of("pattern", "패턴 일치", "rule", "룰 적중", "normal-business", "정상 영업 거래", "etc", "기타"));
    return labels.getOrDefault(String.valueOf(category), String.valueOf(category));
  }

  private static String digest(String text) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
