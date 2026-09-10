package com.moneylaundry.api.analysis;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 실제 Python DB 쓰기는 자체 트랜잭션의 토큰 검사/단계 완료 원자화로 후속 연결해야 한다. */
public interface AnalysisStageExecutor {
  record Context(
      long jobId,
      AnalysisStage stage,
      UUID executionId,
      List<Long> uploadIds,
      Map<String, String> artifacts) {}

  record Result(String artifact) {}

  Result prepare(Context context);

  /** 현재는 테스트 실행기용 원자 저장 경계. 별도 Python DB 연결은 이 Java 트랜잭션에 참여하지 않는다. */
  default void commit(Context context, Result result) {}
}
