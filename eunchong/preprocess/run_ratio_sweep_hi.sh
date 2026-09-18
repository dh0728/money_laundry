#!/bin/bash
# r350~r500 확장 — 사용자 지시(2026-09-10). 기존 r10~r300 과 같은 설정·같은 시험지(val).
# 인덱스는 make_ratio_indices.py 가 기존 난수 흐름을 이어서 생성했고 r10~r300 재현 검증을 통과했다.
set -u
cd /workspace
for v in random_r350 random_r400 random_r450 random_r500; do
  echo "===== $v · $(date -u +%H:%M:%S) ====="
  timeout 21600 python3 ooc_full_train.py --variant "$v" --rounds 400 --jobs 4 --splits va
  echo "----- rc=$? · $(date -u +%H:%M:%S) -----"
done
echo "===== SWEEP_HI_DONE $(date -u +%H:%M:%S) ====="
