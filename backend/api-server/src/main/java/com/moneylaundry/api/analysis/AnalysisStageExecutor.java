package com.moneylaundry.api.analysis;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 분석 단계 하나의 실행 경계. AnalysisRunner가 prepare를 트랜잭션 밖에서 실행하고, commit을 단계 완료 트랜잭션 안에서 호출한다. */
public interface AnalysisStageExecutor {
  record Context(
      long jobId,
      AnalysisStage stage,
      UUID executionId,
      List<Long> uploadIds,
      Map<String, String> artifacts,
      UUID runId) {
    public Context(
        long jobId,
        AnalysisStage stage,
        UUID executionId,
        List<Long> uploadIds,
        Map<String, String> artifacts) {
      this(jobId, stage, executionId, uploadIds, artifacts, null);
    }
  }

  record Result(String artifact) {}

  Result prepare(Context context);

  /** 단계 완료 직전 확인. Python 워커는 자체 연결로 저장하므로 이 트랜잭션에 참여하지 않고, 실행기는 저장된 체크포인트만 대조한다. */
  default void commit(Context context, Result result) {}
}
