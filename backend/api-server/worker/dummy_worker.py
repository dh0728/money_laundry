"""W1 더미 워커: CSV를 읽어 거래별 가짜 점수 JSON을 쓴다.

출력 모양만 실제 모델 출력(점수 2종+룰히트, 9클래스 유형)을 흉내 낸다.
W2 [모델 래핑]에서 이 스크립트는 파이프라인 진입 스크립트(피처 생성 → S3 요청 → 결과 폴링 → DB 적재)로
재목적된다. 추론은 워커 밖 추론 에이전트가 하고, 파생 점수는 백엔드가 계산한다(API.md §2.1).
"""

import argparse
import csv
import json
import os
import random


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="입력 거래 CSV (헤더 1행)")
    parser.add_argument("--output", required=True, help="출력 점수 JSON")
    args = parser.parse_args()

    rng = random.Random(0)  # 같은 입력이면 같은 출력(재현 가능)
    scores = []
    with open(args.input, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        next(reader, None)  # 헤더
        for i, _row in enumerate(reader):
            scores.append(
                {
                    "tx_row": i,
                    "anomaly_score": round(rng.random(), 6),
                    "type_score": round(rng.random(), 6),
                    "type_class": rng.randrange(9),
                    "rule_hits": [],
                }
            )

    # 임시 파일에 다 쓴 뒤 교체 — 쓰다 죽어도 반쪽짜리 파일이 남지 않게(원자적 쓰기)
    tmp = args.output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"row_count": len(scores), "scores": scores}, f)
    os.replace(tmp, args.output)
    print(len(scores))


if __name__ == "__main__":
    main()
