package com.moneylaundry.api.review;

import java.util.Arrays;
import java.util.stream.Collectors;

/** Stable presentation only. Identity and authorization continue to use service IDs. */
public final class OwnerDisplay {
  private OwnerDisplay() {}

  private static final String[] FAMILY = {
    "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "전",
    "홍"
  };
  private static final String[] GIVEN = {
    "민준", "서연", "서준", "지우", "도윤", "하윤", "예준", "지민", "시우", "수빈", "주원", "지유", "지호", "서현", "준서", "민서",
    "건우", "수아", "현우", "윤서", "우진", "채원", "선우", "지원", "유준", "소윤", "정우", "예은", "승우", "다은", "현준", "소율",
    "유찬", "지아", "승현", "은우", "태윤", "나은", "준혁", "유진"
  };

  public static String name(long id) {
    if (id <= 0) throw new IllegalArgumentException("Invalid owner number");
    long index = id - 1;
    return FAMILY[(int) (index % FAMILY.length)]
        + GIVEN[(int) ((index / FAMILY.length) % GIVEN.length)]
        + "#"
        + String.format(java.util.Locale.ROOT, "%05d", id);
  }

  // Only trusted SQL identifiers supplied by this package; never request values.
  static String sql(String id) {
    String index = "(" + id + "-1)";
    return "("
        + array(FAMILY)
        + "[("
        + index
        + "%"
        + FAMILY.length
        + "+1)::int] || "
        + array(GIVEN)
        + "[(("
        + index
        + "/"
        + FAMILY.length
        + ")%"
        + GIVEN.length
        + "+1)::int]"
        + " || '#' || lpad("
        + id
        + "::text,greatest(5,length("
        + id
        + "::text)),'0'))";
  }

  private static String array(String[] names) {
    return "(ARRAY["
        + Arrays.stream(names).map(n -> "'" + n + "'").collect(Collectors.joining(","))
        + "])";
  }
}
