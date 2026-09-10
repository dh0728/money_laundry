#!/bin/bash
# k-means 층화(cluster) · CSSMC 팔 학습 — 인계 0910 §8-4, 사용자 지시 2026-09-10.
# 순서: 가중치 실험(run_weight_exp_hi.sh) 종료 + 인덱스 생성(make_cluster_indices.py) 완료 대기 → 학습·채점 → 표.
# 설정은 random 팔과 완전히 동일(LightGBM-OOC, 트리 400, class_weight balanced, seed 42, val 채점) — 바뀐 변수는 표본 선택 방식 하나.
# 대조군 = 같은 크기의 random_r{r}(이미 있음). 실행 순서는 결정력 순: r10·r300 두 끝 먼저, r30·r100 나중.
# ⚠️ 가중치 on 이라 0910 §1 의 상쇄가 여기에도 걸릴 수 있다. 8-2 결과(off 가 다르면)에 따라 off 팔 추가 여부는 사용자 결정.
set -u
cd /workspace
echo "===== CLUSTER_ARMS_START $(date -u +%H:%M:%S) ====="
while ! grep -q WEIGHT_EXP_DONE _weight_exp_hi.log || pgrep -f run_weight_exp_hi.sh >/dev/null \
      || ! grep -q CLUSTER_INDICES_DONE _cluster_indices_hi.log; do sleep 60; done
echo "===== PREREQ_SEEN_DONE $(date -u +%H:%M:%S) ====="
run() {  # variant
  echo "===== $1 · $(date -u +%H:%M:%S) ====="
  if [ -f "model_ooc_full/run_$1.json" ]; then echo "----- skip: run_$1.json 이미 있음 -----"; return; fi
  timeout 21600 python3 ooc_full_train.py --variant "$1" --rounds 400 --jobs 4 --splits va
  echo "----- rc=$? · $(date -u +%H:%M:%S) -----"
}
for v in cluster_r10 cssmc_r10 cluster_r300 cssmc_r300 cluster_r30 cssmc_r30 cluster_r100 cssmc_r100; do run $v; done
ARMS="random_r10 cluster_r10 cssmc_r10 random_r30 cluster_r30 cssmc_r30 random_r100 cluster_r100 cssmc_r100 random_r300 cluster_r300 cssmc_r300"
CALIB_OUT=cluster python3 calib_check_ratio_sweep.py $ARMS; echo "----- calib_check(cluster) rc=$? -----"
CALIB_OUT=cluster python3 calib_check_log_bins.py $ARMS;    echo "----- calib_logbins(cluster) rc=$? -----"
CMP_OUT=cluster   python3 compare_ratio_sweep.py $ARMS;     echo "----- compare(cluster) rc=$? -----"
echo "===== CLUSTER_ARMS_DONE $(date -u +%H:%M:%S) ====="
