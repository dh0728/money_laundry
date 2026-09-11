#!/usr/bin/env bash
# 후속 실험 A1~A4 — 2026-09-04 퇴근 후 무인 실행.
#
# 왜 필요한가 (오늘 실험이 남긴 빈 구멍)
#   F2 에서 hier_lgbm 을 라이브러리 기본값(400라운드)으로 돌리니 0.6353 으로 ET(0.5841)를 앞섰다.
#   그런데 **시드 1벌**이라 확정이 아니고, H1 하이브리드는 LGBM **200**라운드 확률로 만든 것이다.
#   즉 지금 팀에 낼 두 결론("LGBM 이 ET 를 이긴다", "하이브리드가 이득이다")이 모두 미완결이다.
#
# 단계
#   A1  LGBM 400 을 시드 42·1·7 로 재검증 (확률 저장 — A2 가 쓴다)
#       ※ F2 의 시드42 실행은 확률을 저장하지 않았으므로 여기서 다시 돌린다
#   A2  하이브리드 재블렌딩: ET(200) + LGBM(400).  w 는 시드42 에서 고르고 시드1·7 에 고정 적용
#       A2b 3종 전체 블렌딩도 다시 저장(스모크가 원본 CSV 를 덮어써서 상세 스윕이 유실됐다)
#   A3  test 1회 — 사전 등록한 최종 후보에만. ET(200) · LGBM(400) · 그 둘의 하이브리드
#   A4  HI-Large 재현 — ET(200) vs LGBM(400) (r100 표본, 기존 Large 결과와 같은 조건)
#
# 자원 원칙: 4코어(AML_THREADS=3) · 27.34 GiB · 전 단계 순차 · mem_guard 감시 중.
# 안전 원칙: 파일을 지우지 않는다. 모든 출력에 --tag 를 준다(안 주면 덮어쓴다 — 오늘 한 번 겪었다).
set -u
cd /workspace
export AML_THREADS=3 OMP_NUM_THREADS=3 OPENBLAS_NUM_THREADS=3 MKL_NUM_THREADS=3

LOG=/workspace/진행로그_후속_20260904.md
CHAIN=/workspace/logs_followup_chain.log
D=/workspace/model_feature_reduce
FAM=$D/family
FAILED=()

mkdir -p "$FAM"
cp -n "$D/importance.csv" "$FAM/" 2>/dev/null || true
ts() { date -u +'%Y-%m-%d %H:%M:%SZ'; }
say() { echo "[$(ts)] [fu] $*" | tee -a "$CHAIN"; }
mem() { python3 -c "
s={k:int(v) for k,v in (l.split(maxsplit=1) for l in open('/sys/fs/cgroup/memory.stat'))}
mx=int(open('/sys/fs/cgroup/memory.max').read())
print(f\"anon {(s['anon']+s['slab'])/2**30:.2f} GiB ({(s['anon']+s['slab'])/mx*100:.1f}%)\")"; }
save() { local title=$1; shift
  { echo; echo "## $title  ($(ts))"; echo; echo "메모리: $(mem)"; echo;
    for f in "$@"; do [ -f "$f" ] && { echo '```'; echo "# $f"; tail -40 "$f"; echo '```'; }; done; } >> "$LOG"
  python3 /workspace/make_docx_report.py "$LOG" >/dev/null 2>&1; say "저장 → $LOG (+.docx)"; }
run() { local name=$1 log=$2; shift 2
  say "===== $name 시작 ====="
  "$@" > "$log" 2>&1; local rc=$?
  say "===== $name 종료 rc=$rc · $(mem) ====="
  if [ $rc -ne 0 ]; then FAILED+=("$name(rc=$rc)"); tail -8 "$log" | tee -a "$CHAIN"; fi
  return $rc; }

: > "$CHAIN"
cat > "$LOG" <<'EOF'
# 후속 실험 진행 로그 (A1~A4) — 2026-09-04

**왜 하나**: F2 에서 `hier_lgbm` 을 라이브러리 기본값(400라운드)으로 돌리니 **0.6353** 으로
ET(0.5841)를 앞섰다. 그런데 시드 1벌이라 확정이 아니고, H1 하이브리드는 LGBM **200**라운드
확률로 만든 것이다. 지금 팀에 낼 두 결론이 모두 미완결 상태다.

| 단계 | 내용 |
|---|---|
| A1 | LGBM 400 을 시드 42·1·7 로 재검증(확률 저장) |
| A2 | 하이브리드 재블렌딩 — ET(200) + LGBM(400) |
| A3 | **test 1회** — 사전 등록 후보에만 (ET200 · LGBM400 · 하이브리드) |
| A4 | HI-Large 재현 — ET(200) vs LGBM(400), r100 |

**사전 등록(숫자 보기 전에 정함)**: A3 의 test 대상은 위 3개로 고정한다. 결과를 본 뒤 후보를
추가하지 않는다. w 는 A2 에서 **val 로만** 고르고 test 에는 그 값을 그대로 쓴다.
EOF

# ── A1. LGBM 400 시드 3벌 (확률 저장) ────────────────────────────────────────
for sd in 42 1 7; do
  run "A1 hier_lgbm r=400 seed=$sd" "logs_fu_lgbm400_s$sd.log" \
    python3 /workspace/feature_reduce_combo.py --dataset HI-Small --basis 10day --variant full \
      --model et --family hier_lgbm --rounds 400 --jobs 3 --seed "$sd" --only A \
      --out "$FAM" --tag "a1_lgbm_r400" \
      --save-proba "$FAM/proba_va_s${sd}_hier_lgbm_r400.npy"
done
# 이어받기로 조용히 건너뛴 시드가 없는지 확인하고, 빠진 확률은 여기서 채운다.
# (2026-09-04 실제로 시드42 가 F2 의 CSV 때문에 2초 만에 skip 돼 확률이 안 만들어졌다)
for sd in 42 1 7; do
  if [ ! -f "$FAM/proba_va_s${sd}_hier_lgbm_r400.npy" ]; then
    say "!! 시드 $sd 확률 누락 — 고유 태그로 재실행"
    run "A1-fix hier_lgbm r=400 seed=$sd" "logs_fu_lgbm400_fix_s$sd.log" \
      python3 /workspace/feature_reduce_combo.py --dataset HI-Small --basis 10day --variant full \
        --model et --family hier_lgbm --rounds 400 --jobs 3 --seed "$sd" --only A \
        --out "$FAM" --tag "a1fix_lgbm_r400_s$sd" \
        --save-proba "$FAM/proba_va_s${sd}_hier_lgbm_r400.npy"
  fi
done
MISSING=0
for sd in 42 1 7; do [ -f "$FAM/proba_va_s${sd}_hier_lgbm_r400.npy" ] || MISSING=1; done
if [ $MISSING -eq 1 ]; then
  say "!! 확률 파일이 여전히 없다 — A2/A3/A4b 를 건너뛴다"; FAILED+=("A1 확률 생성 실패")
fi

run "A1 집계" logs_fu_family.log python3 /workspace/aggregate_family.py
python3 - > logs_fu_a1_summary.log 2>&1 <<'PYEOF'
# ET(200) 3벌 vs LGBM(400) 3벌 — A1 의 핵심 질문에 직접 답하는 표
import glob, pandas as pd
fs = sorted(glob.glob('/workspace/model_feature_reduce/family/feature_reduce_combo_et_s*_*.csv'))
df = pd.concat([pd.read_csv(f) for f in fs], ignore_index=True)
# 09-08: 글롭을 `_fam_` 에서 넓혀 `_a1_` 을 포함시켰다(시드 2벌이 누락돼 있었음).
# 넓힌 만큼 HI-Large·test 행이 섞이므로 CSV 자신의 열로 거르고, s42 중복(_fam_/_a1_)을 제거한다.
df = df[(df['데이터'] == 'HI-Small') & (df['split'] == 'va') & df['구성'].notna()]
df = df.drop_duplicates(subset=['패밀리', '라운드', '시드', '구성', '피처수', '표본'], keep='first')
sel = df[((df['패밀리'] == 'hier_et') & (df['라운드'] == 200)) |
         ((df['패밀리'] == 'hier_lgbm') & (df['라운드'] == 400))]
g = (sel.groupby(['패밀리', '라운드'])['val_P_R70']
        .agg(['count', 'mean', 'std', 'min', 'max']).reset_index())
print('■ A1 핵심 비교 — 각 패밀리의 최선 설정, 시드 3벌')
print('| 패밀리 | 라운드 | 시드수 | 평균 | 편차 | 최소~최대 |')
print('|---|---|---|---|---|---|')
for _, r in g.iterrows():
    print(f"| {r['패밀리']} | {int(r['라운드'])} | {int(r['count'])} | **{r['mean']:.4f}** | "
          f"{0 if pd.isna(r['std']) else r['std']:.4f} | {r['min']:.4f}~{r['max']:.4f} |")
piv = sel.pivot_table(index='시드', columns='패밀리', values='val_P_R70')
print('\n■ 시드별 원자료 (순위가 뒤집히면 결론 못 냄)')
print(piv.round(4).to_string())
if piv.shape[1] == 2:
    a, b = piv.columns
    wins = (piv[b] > piv[a]).sum()
    d = piv[b].mean() - piv[a].mean()
    sd = max(piv[a].std(), piv[b].std())
    print(f"\n{b} - {a} = {d:+.4f} · 시드 편차 최대 {sd:.4f} · {b} 승 {wins}/{len(piv)}")
    print('→ ' + ('**격차가 편차보다 크고 전 시드 승 — 실제 차이**' if d > sd and wins == len(piv)
                  else '**동급 또는 결론 유보** (격차가 편차 안이거나 시드마다 뒤집힘)'))
PYEOF
save "A1 LGBM 400 시드 3벌 재검증" logs_fu_a1_summary.log logs_fu_family.log

# ── A2. 하이브리드 재블렌딩 (ET 200 + LGBM 400) ───────────────────────────────
if [ $MISSING -eq 0 ]; then
run "A2 하이브리드 ET200+LGBM400" logs_fu_hybrid_lgbm400.log \
  python3 /workspace/blend_hybrid.py --dir "$FAM" --fams hier_et,hier_lgbm_r400 \
    --fit-seed 42 --apply-seeds 1,7 --tag et200_lgbm400
# A2b: 3종 전체 스윕 CSV 재생성(스모크가 원본을 덮어써 상세 스윕이 유실됐다)
run "A2b 3종 전체 스윕 재생성" logs_fu_hybrid_3fam.log \
  python3 /workspace/blend_hybrid.py --dir "$FAM" --fit-seed 42 --apply-seeds 1,7 --tag 3fam_r200
save "A2 하이브리드 재블렌딩 (ET200 + LGBM400)" logs_fu_hybrid_lgbm400.log logs_fu_hybrid_3fam.log
fi

# ── A3. test 1회 — 사전 등록 후보에만 ────────────────────────────────────────
run "A3 test ET r=200" logs_fu_te_et200.log \
  python3 /workspace/feature_reduce_combo.py --dataset HI-Small --basis 10day --variant full \
    --model et --family hier_et --rounds 200 --jobs 3 --seed 42 --only A --eval te \
    --out "$FAM" --tag "te_hier_et_r200" --save-proba "$FAM/proba_te_s42_hier_et.npy"
run "A3 test LGBM r=400" logs_fu_te_lgbm400.log \
  python3 /workspace/feature_reduce_combo.py --dataset HI-Small --basis 10day --variant full \
    --model et --family hier_lgbm --rounds 400 --jobs 3 --seed 42 --only A --eval te \
    --out "$FAM" --tag "te_hier_lgbm_r400" --save-proba "$FAM/proba_te_s42_hier_lgbm_r400.npy"
# test 에서는 w 를 **새로 고르지 않는다** — A2 가 val 에서 고른 w 를 --w-from 으로 그대로 가져온다.
# 여기서 w 를 다시 고르면 "test 는 최종 후보에만 한 번" 원칙이 깨진다.
run "A3 test 하이브리드(w 고정)" logs_fu_te_hybrid.log \
  python3 /workspace/blend_hybrid.py --dir "$FAM" --fams hier_et,hier_lgbm_r400 \
    --split te --fit-seed 42 --w-from "$FAM/hybrid_sweep_et200_lgbm400.csv" \
    --tag te_et200_lgbm400
save "A3 test 1회 (사전 등록 후보 3종)" logs_fu_te_et200.log logs_fu_te_lgbm400.log logs_fu_te_hybrid.log

# ── A4. HI-Large 재현 (r100, 기존 Large 결과와 같은 조건) ────────────────────
LG=$D/large_hybrid; mkdir -p "$LG"
run "A4 Large hier_et r=200" logs_fu_large_et200.log \
  python3 /workspace/feature_reduce_combo.py --dataset HI-Large --basis main --variant random_r100 \
    --model et --family hier_et --rounds 200 --jobs 3 --seed 42 --only A \
    --out "$FAM" --tag "large_hier_et_r200" --save-proba "$LG/proba_va_s42_hier_et.npy"
run "A4 Large hier_lgbm r=400" logs_fu_large_lgbm400.log \
  python3 /workspace/feature_reduce_combo.py --dataset HI-Large --basis main --variant random_r100 \
    --model et --family hier_lgbm --rounds 400 --jobs 3 --seed 42 --only A \
    --out "$FAM" --tag "large_hier_lgbm_r400" --save-proba "$LG/proba_va_s42_hier_lgbm_r400.npy"
# A4b: Small 에서 고른 w 를 Large 에 그대로 적용 — 하이브리드 이득이 규모에서도 재현되는가
run "A4b Large 하이브리드(w 고정)" logs_fu_large_hybrid.log \
  python3 /workspace/blend_hybrid.py --dir "$LG" --dataset HI-Large --basis main \
    --fams hier_et,hier_lgbm_r400 --fit-seed 42 \
    --w-from "$FAM/hybrid_sweep_et200_lgbm400.csv" --tag large_et200_lgbm400
save "A4 HI-Large 재현 (ET200 vs LGBM400 + 하이브리드, r100)" \
  logs_fu_large_et200.log logs_fu_large_lgbm400.log logs_fu_large_hybrid.log

# ── 마무리 ───────────────────────────────────────────────────────────────────
{ echo; echo "## 후속 체인 종료 ($(ts))"; echo; echo "메모리: $(mem) · 가드 스냅샷 $(ls /workspace/state_snapshots 2>/dev/null | wc -l)건";
  if [ ${#FAILED[@]} -gt 0 ]; then echo; echo "### ⚠ 실패한 단계"; for f in "${FAILED[@]}"; do echo "- $f"; done;
  else echo; echo "전 단계 rc=0."; fi; } >> "$LOG"
python3 /workspace/make_docx_report.py "$LOG" >/dev/null 2>&1
say "===== 후속 체인 종료 (실패 ${#FAILED[@]}건) ====="
