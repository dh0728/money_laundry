package com.moneylaundry.api.review;

import java.time.Instant;
import java.util.List;

public final class DashboardLists {
  private DashboardLists() {}

  public record Activity(
      String eventId, String caseId, String action, String comment, Instant businessAt) {}

  public record Priority(
      String caseId, String kind, String alertId, Instant createdAt, double risk) {}

  public record Oldest(String caseId, String assignee, double ageSeconds, boolean awaitingReview) {}

  public record Queues(String businessAt, List<Priority> priority, List<Oldest> oldestOpen) {}
}
