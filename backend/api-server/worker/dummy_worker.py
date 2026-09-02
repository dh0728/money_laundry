"""W1 더미 워커: CSV를 읽어 거래별 가짜 점수 JSON을 쓴다.

출력 모양만 실제 모델 출력(점수 2종+룰히트, 9클래스 유형)을 흉내 낸다.
W2 [모델 래핑]에서 이 스크립트의 점수 생성부가 실제 추론(피처 빌더+run_114)으로 교체된다.
"""

import argparse
import csv
import json
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

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump({"row_count": len(scores), "scores": scores}, f)
    print(len(scores))


if __name__ == "__main__":
    main()
