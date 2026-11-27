package com.moneylaundry.api.ai;

import com.moneylaundry.api.common.ApiException;
import com.moneylaundry.api.review.ReviewJson;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Alert · Episode AI 요약. 코드가 만든 사실 목록을 Claude 에 넘겨 한 줄 결론과 근거 문장을 받는다. 결과는 DB 에 두지 않고, 사실 목록이 같으면
 * 메모리에 둔 결과를 다시 쓴다.
 */
@Service
public class AiSummaryService {
  static final int CACHE_SIZE = 500;
  private static final Pattern NUMBER = Pattern.compile("\\d[\\d,]*(?:\\.\\d+)?");

  /** Claude 가 쓴 요약. points 의 sources 는 사실 번호(F1…)다. */
  public record Point(String text, List<String> sources) {}

  public record Written(String headline, List<Point> points) {}

  /** 요약을 쓰는 쪽. 키가 없거나 거절·실패하면 빈 값을 돌려준다. */
  public interface Writer {
    String model();

    Optional<Written> write(CaseFacts.Facts facts);
  }

  public record Summary(
      long caseId,
      String kind,
      String headline,
      List<Point> points,
      List<CaseFacts.Fact> facts,
      String model,
      Instant generatedAt) {}

  /** 대시보드 요약. 위험지수는 코드가 늘 계산하고, Claude 문장은 실패하면 headline 이 null 이고 points 가 비어 있다. */
  public record Dashboard(
      DashboardRisk.Index index,
      String headline,
      List<Point> points,
      List<CaseFacts.Fact> facts,
      String model,
      Instant generatedAt) {}

  private final CaseFacts facts;
  private final DashboardRisk risk;
  private final Writer writer;
  private final Map<String, Dashboard> dashboards =
      new LinkedHashMap<>(16, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Dashboard> eldest) {
          return size() > 50;
        }
      };
  private final Map<String, Summary> cache =
      new LinkedHashMap<>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Summary> eldest) {
          return size() > CACHE_SIZE;
        }
      };

  public AiSummaryService(CaseFacts facts, DashboardRisk risk, Writer writer) {
    this.facts = facts;
    this.risk = risk;
    this.writer = writer;
  }

  /** 전체 대시보드의 종합 위험지수와 그 설명. 같은 사실 목록이면 앞서 만든 문장을 다시 쓴다. Claude 가 실패해도 지수는 돌려준다. */
  public Dashboard forDashboard() {
    var index = risk.compute();
    var lines = new ArrayList<String>();
    lines.add(
        index.score() == null
            ? "종합 위험지수 산출 불가(지표 기준선 없음)"
            : "종합 위험지수 " + index.score() + "점, 단계 " + index.level());
    for (var c : index.indicators())
      lines.add(
          c.label()
              + ": 현재 "
              + c.current()
              + (c.baseline() == null ? "" : ", 평소 " + c.baseline())
              + (c.ratio() == null ? "" : ", 평소의 " + c.ratio().toPlainString() + "배")
              + (c.score() == null ? ", 기준선 없음(지수에서 제외)" : ", 지표 점수 " + c.score() + "점")
              + " (가중치 "
              + c.weight()
              + ")");
    if (index.latestTxDate() != null) {
      var types = risk.typeCounts(index.latestTxDate());
      if (!types.isEmpty())
        lines.add("최근 거래일 " + index.latestTxDate() + " 의심 거래 유형별 건수: " + String.join(", ", types));
    }
    var list = new ArrayList<CaseFacts.Fact>();
    for (int i = 0; i < lines.size(); i++)
      list.add(new CaseFacts.Fact("F" + (i + 1), lines.get(i)));
    String key = digest(writer.model() + "\n" + ReviewJson.encode(list));
    synchronized (dashboards) {
      var hit = dashboards.get(key);
      if (hit != null) return hit;
    }
    var written =
        index.score() == null
            ? Optional.<Written>empty()
            : writer
                .write(new CaseFacts.Facts(0, "DASHBOARD", list))
                .flatMap(w -> checked(w, list));
    var summary =
        new Dashboard(
            index,
            written.map(Written::headline).orElse(null),
            written.map(Written::points).orElse(List.of()),
            list,
            writer.model(),
            Instant.now());
    // 실패한 결과는 두지 않는다. 다음 요청에서 다시 시도한다.
    if (written.isPresent())
      synchronized (dashboards) {
        dashboards.put(key, summary);
      }
    return summary;
  }

  /** 테스트끼리 메모리 결과를 나눠 쓰지 않게 비운다. */
  void clearCache() {
    synchronized (cache) {
      cache.clear();
    }
    synchronized (dashboards) {
      dashboards.clear();
    }
  }

  public static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE, "AI_SUMMARY_UNAVAILABLE", "AI 요약을 만들지 못했습니다.");
  }

  public Summary forCase(long caseId) {
    var built = facts.build(caseId);
    String key = digest(writer.model() + "\n" + ReviewJson.encode(built.facts()));
    synchronized (cache) {
      var hit = cache.get(key);
      if (hit != null) return hit;
    }
    var written = writer.write(built).flatMap(w -> checked(w, built.facts()));
    if (written.isEmpty()) throw unavailable();
    var summary =
        new Summary(
            caseId,
            built.kind(),
            written.get().headline(),
            written.get().points(),
            built.facts(),
            writer.model(),
            Instant.now());
    synchronized (cache) {
      cache.put(key, summary);
    }
    return summary;
  }

  /** 근거 번호가 없는 사실을 가리키거나, 사실 목록에 없는 숫자를 쓴 문장은 버린다. 결론 줄이 걸리거나 남는 문장이 없으면 요약 전체를 쓰지 않는다. */
  static Optional<Written> checked(Written written, List<CaseFacts.Fact> facts) {
    Set<String> ids = facts.stream().map(CaseFacts.Fact::id).collect(Collectors.toSet());
    Set<String> numbers =
        facts.stream()
            .flatMap(f -> numbers(f.id() + " " + f.text()).stream())
            .collect(Collectors.toSet());
    if (written.headline() == null
        || written.headline().isBlank()
        || !numbers.containsAll(numbers(written.headline()))) return Optional.empty();
    var points = new ArrayList<Point>();
    for (var point : written.points() == null ? List.<Point>of() : written.points())
      if (point.text() != null
          && !point.text().isBlank()
          && point.sources() != null
          && !point.sources().isEmpty()
          && ids.containsAll(point.sources())
          && numbers.containsAll(numbers(point.text()))) points.add(point);
    if (points.isEmpty()) return Optional.empty();
    return Optional.of(new Written(written.headline().trim(), List.copyOf(points)));
  }

  static List<String> numbers(String text) {
    var out = new ArrayList<String>();
    var m = NUMBER.matcher(text);
    while (m.find()) out.add(m.group().replace(",", ""));
    return out;
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
