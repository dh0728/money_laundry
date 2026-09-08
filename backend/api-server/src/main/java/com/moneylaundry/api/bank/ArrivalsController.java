package com.moneylaundry.api.bank;

import com.moneylaundry.api.batchjob.BatchJob;
import com.moneylaundry.api.batchjob.BatchJobRepository;
import com.moneylaundry.api.batchjob.JobType;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * GET /api/banks/arrivals?date= — 보고 은행별 도착 현황(API.md §1.2). 날짜 D의 창 = (D−1 컷오프, D 컷오프], 은행당 그 창의
 * 최신 INGEST 작업 1건. date 기본값은 "다음 컷오프의 날짜"(지금 도착하는 파일이 속하는 창). 컷오프 시각은 프로퍼티(kickoff §2.1 06:00),
 * 시간대는 app.zone(서울 표준시).
 */
@RestController
public class ArrivalsController {

  public record Row(
      int bankId,
      String name,
      String country,
      String status,
      Long uploadId,
      String fileName,
      Integer rowCount,
      Instant receivedAt,
      Instant finishedAt) {}

  public record Response(
      LocalDate date,
      Instant cutoffAt,
      long remainingSeconds,
      int arrivedCount,
      int totalBanks,
      List<Row> banks) {}

  private final BankRepository bankRepository;
  private final BatchJobRepository batchJobRepository;
  private final LocalTime cutoff;
  private final ZoneId zone;

  public ArrivalsController(
      BankRepository bankRepository,
      BatchJobRepository batchJobRepository,
      @Value("${app.ingest.cutoff}") String cutoff,
      @Value("${app.zone}") String zone) {
    this.bankRepository = bankRepository;
    this.batchJobRepository = batchJobRepository;
    this.cutoff = LocalTime.parse(cutoff);
    this.zone = ZoneId.of(zone);
  }

  @GetMapping("/api/banks/arrivals")
  public Response arrivals(
      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
          LocalDate date) {
    LocalDate day = date != null ? date : nextCutoffDate();
    Instant cutoffAt = day.atTime(cutoff).atZone(zone).toInstant();
    Instant windowStart = day.minusDays(1).atTime(cutoff).atZone(zone).toInstant();
    int arrived = 0;
    List<Row> rows = new ArrayList<>();
    for (Bank bank : bankRepository.findByReportingTrueOrderById()) {
      BatchJob job =
          batchJobRepository
              .findFirstByJobTypeAndBankIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtDesc(
                  JobType.INGEST, bank.getId(), windowStart, cutoffAt)
              .orElse(null);
      if (job != null && job.getReceivedAt() != null) {
        arrived++;
      }
      rows.add(
          new Row(
              bank.getId(),
              bank.getName(),
              bank.getCountry(),
              job == null ? "NOT_ARRIVED" : job.getStatus().name(),
              job == null ? null : job.getId(),
              job == null ? null : job.getFileName(),
              job == null ? null : job.getRowCount(),
              job == null ? null : job.getReceivedAt(),
              job == null ? null : job.getFinishedAt()));
    }
    long remaining = Math.max(0, cutoffAt.getEpochSecond() - Instant.now().getEpochSecond());
    return new Response(day, cutoffAt, remaining, arrived, rows.size(), rows);
  }

  private LocalDate nextCutoffDate() {
    LocalDate today = LocalDate.now(zone);
    boolean passed = !Instant.now().isBefore(today.atTime(cutoff).atZone(zone).toInstant());
    return passed ? today.plusDays(1) : today;
  }
}
