package com.moneylaundry.api.review;

import java.time.Instant;
import java.util.List;

/** 대시보드 작업 목록 응답 레코드(최근 활동·우선 처리·오래된 미처리). */
public final class DashboardLists {
  private DashboardLists() {}

  public record Activity(
      String eventId, String caseId, String action, String comment, Instant businessAt) {}

  public record Priority(
      String caseId, String kind, String alertId, Instant createdAt, double risk) {}

  public record Oldest(String caseId, String assignee, double ageSeconds, boolean awaitingReview) {}

  public record Queues(String businessAt, List<Priority> priority, List<Oldest> oldestOpen) {}
}
