package com.moneylaundry.api.upload;

import java.nio.file.Path;

/** 거래 CSV를 점수 JSON으로 바꾸는 워커. W1은 Python 더미 스크립트 직접 호출(10월 SQS 전환 예정). */
public interface ScoreWorker {

  void score(Path input, Path output);
}
