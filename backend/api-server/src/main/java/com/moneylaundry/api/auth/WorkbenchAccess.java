package com.moneylaundry.api.auth;

import java.util.Arrays;
import org.springframework.core.env.Environment;

/** Explicitly enables the authenticated workbench for a production presentation. */
public final class WorkbenchAccess {
  private WorkbenchAccess() {}

  public static boolean enabled(Environment env) {
    var profiles = Arrays.asList(env.getActiveProfiles());
    if (profiles.contains("prod"))
      return env.getProperty("app.presentation.enabled", Boolean.class, false);
    return profiles.contains("dev") || profiles.contains("local");
  }
}
