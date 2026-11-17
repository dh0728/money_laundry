#!/bin/bash
# 500에폭 학습이 complete.json을 쓰고 GPU가 비면 미세조정(02)과 평가(04)를 차례로 실행한다.
cd "$(dirname "$0")"; RUNS=/workspace/handoff/V10_FraudGT_조건수정_20261027/runs; PY=/workspace/kimi/venv/bin/python
rm -f chain_done.json; start=$(date +%s)
while true; do
  done_file=$(ls $RUNS/multi_resume500*/complete.json 2>/dev/null | head -1)
  gpu_procs=$(nvidia-smi --query-compute-apps=pid --format=csv,noheader | wc -l)
  echo "$(date -u +%FT%TZ) complete=${done_file:-none} gpu_procs=$gpu_procs" > waiter_status.txt
  if [ -n "$done_file" ] && [ "$gpu_procs" -eq 0 ]; then break; fi
  if [ $(( $(date +%s) - start )) -gt 172800 ]; then echo '{"state":"gave_up_after_48h"}' > chain_done.json; exit 1; fi
  sleep 60
done
echo "$(date -u +%FT%TZ) training complete: $done_file" >> waiter.log
rm -rf ../work/checkpoints/*.pt
$PY -B 02_finetune_gnn.py > 02_finetune_gnn.log 2>&1 || { echo '{"state":"finetune_failed"}' > chain_done.json; exit 1; }
OMP_NUM_THREADS=1 nice -n 10 $PY -B 04_fuse_and_report.py > 04_fuse_and_report.log 2>&1 || { echo '{"state":"report_failed"}' > chain_done.json; exit 1; }
echo "{\"state\":\"complete\",\"utc\":\"$(date -u +%FT%TZ)\"}" > chain_done.json
