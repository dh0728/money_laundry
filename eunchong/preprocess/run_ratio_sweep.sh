#!/bin/bash
# 언더샘플 비율 스윕 — LightGBM-OOC, 같은 시험지(val), 학습 행 수만 다름.
#
# 왜 이 실험인가(근거):
#   Hancock et al., J.Big Data 11:8 (2024) Table 7·12 — LightGBM 은 원본 전량이 아니라 1:27 부근에서
#   AUPRC 최고, 원본에서 급락(Part D 0.7183 vs 0.5132 / Part B 0.5967 vs 0.4146). 두 데이터셋에서 재현됨.
#   우리 불균형 1:1,833 은 논문의 1:1,429 와 1:2,500 사이다.
# 왜 full 팔이 없나:
#   2026-09-09 실측 — 90M 행에서 anon 19.04 GiB(가드 STOP 19.14)이고 전량 외삽 22.54 GiB 로 FATAL(21.9) 초과.
# 격자에 대하여:
#   r10/r30/r100/r300 은 **이미 만들어져 있던 인덱스**다. 새로 고른 값이 아니다.
#   논문 최적점 1:27 은 r30(1:30.8)이 가장 가깝다.
# 채점:
#   val 만 연다. test 는 설정 확정 후 1회 개봉(final_9class.py 프로토콜).
set -u
cd /workspace
for v in random_r10 random_r30 random_r100 random_r300; do
  echo "===== $v · $(date -u +%H:%M:%S) ====="
  timeout 21600 python3 ooc_full_train.py --variant "$v" --rounds 400 --jobs 4 --splits va
  echo "----- rc=$? · $(date -u +%H:%M:%S) -----"
done
echo "===== SWEEP_DONE $(date -u +%H:%M:%S) ====="
