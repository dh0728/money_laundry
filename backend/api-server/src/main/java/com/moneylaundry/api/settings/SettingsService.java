package com.moneylaundry.api.settings;

import com.moneylaundry.api.analysis.AnalysisService;
import com.moneylaundry.api.common.ApiException;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** 설정 화면의 관리자 기능: 팀원 권한 변경, 모델 점수 위험 구간(화면 표시 기준) 조회·저장. */
@Service
public class SettingsService {
  public record Role(String role) {}

  public record Bands(Integer medium, Integer high) {}

  private final JdbcTemplate jdbc;

  public SettingsService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  private static void adminOnly(boolean admin) {
    if (!admin)
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN_ROLE", "관리자만 설정을 바꿀 수 있습니다.");
  }

  /** 다른 팀원의 권한을 바꾼다. 관리자가 한 명도 남지 않는 일을 막기 위해 본인 권한은 바꿀 수 없다. */
  public Map<String, Object> role(long target, long user, boolean admin, Role in) {
    adminOnly(admin);
    if (in == null || in.role() == null || !Set.of("STAFF", "ADMIN").contains(in.role()))
      throw AnalysisService.invalid();
    if (target == user)
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_TRANSITION", "본인의 권한은 바꿀 수 없습니다.");
    if (jdbc.update("update core.users set role=? where user_id=?", in.role(), target) == 0)
      throw ApiException.notFound("팀원이 없습니다.");
    return jdbc.queryForMap(
        "select user_id as id,name,role from core.users where user_id=?", target);
  }

  public Map<String, Object> bands() {
    return jdbc.queryForMap("select medium,high from ops.model_risk_bands where id");
  }

  /** 주의·위험 구간의 시작 점수(1~99, 주의 < 위험)를 저장한다. 모델의 판단 임계값과는 별개인 화면 표시 기준이다. */
  public Map<String, Object> bands(long user, boolean admin, Bands in) {
    adminOnly(admin);
    if (in == null
        || in.medium() == null
        || in.high() == null
        || in.medium() < 1
        || in.high() > 99
        || in.medium() >= in.high()) throw AnalysisService.invalid();
    jdbc.update(
        "update ops.model_risk_bands set medium=?,high=?,updated_by=?,updated_at=now() where id",
        in.medium(),
        in.high(),
        user);
    return bands();
  }
}
