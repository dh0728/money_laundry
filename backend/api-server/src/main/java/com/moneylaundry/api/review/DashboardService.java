package com.moneylaundry.api.review;

import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;

/** Executes detached dashboard queries inside one bounded, read-only snapshot. */
@Service
public class DashboardService {
  private final DashboardReadDatabase database;

  public DashboardService(DashboardReadDatabase database) {
    this.database = database;
  }

  public DashboardSummary view(long user, LocalDate from, LocalDate to) {
    return database.read(c -> new DashboardQueries(c.jdbc(), c.time()).view(user, from, to));
  }

  public List<DashboardLists.Activity> activities(long user, LocalDate from, LocalDate to) {
    return database.read(c -> new DashboardQueries(c.jdbc(), c.time()).activities(user, from, to));
  }

  public DashboardLists.Queues queues(long user) {
    return database.read(c -> new DashboardQueries(c.jdbc(), c.time()).queues(user));
  }
}
