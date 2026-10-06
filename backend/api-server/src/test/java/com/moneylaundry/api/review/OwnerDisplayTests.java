package com.moneylaundry.api.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import org.junit.jupiter.api.Test;

class OwnerDisplayTests {
  @Test
  void stableUniqueDisplayNumbersDoNotTruncate() {
    var names = new HashSet<String>();
    for (long id = 1; id <= 2000; id++) {
      String name = OwnerDisplay.name(id);
      assertThat(name).matches("[가-힣]{3}#[0-9]{5,}");
      assertThat(OwnerDisplay.name(id)).isEqualTo(name);
      assertThat(names.add(name)).isTrue();
    }
    assertThat(OwnerDisplay.name(100000)).endsWith("#100000");
  }
}
