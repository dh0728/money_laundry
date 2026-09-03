package com.moneylaundry.api.upload;

import java.nio.file.Path;

/**
 * W1 관통용 워커 경계: 거래 CSV를 점수 JSON으로 바꾼다. W2에서 Python 파이프라인 실행기로 재목적된다 — 추론은 추론 에이전트, 파생 점수는 BE(API.md
 * §2.1).
 */
public interface ScoreWorker {

  void score(Path input, Path output);
}
