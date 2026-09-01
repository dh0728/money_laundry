# run_101 — HI-Large 무개입 기준선 (RUS 100:1)

- run id: run_101
- 상태: 완료(keep) — **Large 시리즈 새 기준선**
- 기준선: (Large 시리즈 시조 — HI-Small run_011b 설정 승계)
- 단일 변인: 데이터셋 HI-Small → HI-Large (다운샘플링은 Large 공통 전처리로 도입)
- 피처: features_v1 61개 (그래프 52 = Large 빌더 이식판, 검증 완료 — outputs/hi_large_phase2_pipeline.md)
- 데이터: HI-Large, 분할 train 08-01~09-23 / val 09-24~10-14 / test 10-15~11-05 (미개봉), 꼬리 11-06~ 제외
- 개입: 없음

## 전처리 (Large 공통 — 모든 run 동일 적용)

- train = 세탁 전량(97,159) + NORMAL 비례 베르누이 RUS **100:1**(≈9.72M행, 시드 42).
  일자별 기대 비례(층화 효과), 표본은 `data_work/HI-Large/samples/`에 orig_row로 보존.
- val/test 는 원본 분포 전량 유지 (§6).
- 다운샘플링 방법 비교(RUS vs CSSMC 등)는 run_102+ 사다리에서 단일 변인으로 실험.

## 모델·평가 (run_011b 승계 + Large 적응)

- LightGBM multiclass 10: λ=100, `min_sum_hessian` 1.0, 리프 31, lr 0.1,
  `min_data_in_leaf` 20, max_bin 255, seed 42, 스레드 12, 상한 1000 + 조기종료 30.
- **Large 적응 2건** (메모리 제약, 계약 명시):
  1. 조기종료용 val = val 창의 세탁 전량 + NORMAL RUS 100:1 (시드 43) 부표본.
     multi_logloss 기준 — HI-Small은 전량 val이었음. 최종 지표는 전량 val.
  2. 최종 평가는 val 전량(39.17M) **청크 predict** 로 계산.
- 지표: run_ladder.py evaluate() 계약 그대로 — PR-AUC, max-F1, P@R{0.5,0.7,0.9},
  P@패턴R0.9, 걸침/포함 층화 탐지@R0.7, P@포함패턴R0.9(Σp_패턴), OVR PR-AUC 9종,
  포화 진단. 층화 정의도 동일(attempt 시작 시각 < val 시작 = 걸침).

## 가설 (실행 전)

1. 절대 성능은 HI-Small run_011b(PR-AUC 0.665)와 다른 수준일 것 — 데이터 36배·
   기간 6배·기저율 상승(0.08→0.13%)으로 직접 비교 불가, Large 시리즈의 새 기준점.
2. 클래스별 OVR 은 HI-Small 대비 고르게 오를 것 — 포함 표본이 클래스당 수십 배.
3. λ=100 이 Large 에서 국소 최적이 아닐 수 있음 — 직후 미니 사다리(λ∈{10,100})로 확인 예정.

## 결과 (val 전량 39,174,322행)

- PR-AUC **0.6798** · max-F1 71.77% · P@R0.5 97.09% · **P@R0.7 33.88%** · P@R0.9 3.53%
- P@패턴R0.9(세탁점수) **95.17%** · P@포함패턴R0.9(Σp패턴) **93.58%**
- 층화 탐지@R0.7: 걸침 99.2% / 포함 98.3% (n=17,605/12,209) — 걸침 우위 사실상 소멸
- OVR PR-AUC: FO .326 FI .304 GS .505 SG .425 CY .208 RD .155 BP .143 ST .314 NP .111
- best_iter 489/1000 (ES 30) · 학습 48분 · val predict 59분 · 조립 피크 RSS 3.4GB
- 기계 기록: `data_work/runs/run_101.json` + 모델

## 가설 검증

1. ✓ 절대 성능은 새 기준점 — aggregate 는 HI-Small 011b 와 유사 수준(0.680 vs
   0.665)이나 분모가 다른 새 측정.
2. ✗ **정정**: OVR 이 고르게 오르지 않았다. HI-Small 011b 대비(직접 비교는 참고용):
   FAN-OUT +.10 RANDOM +.06 NONPAT +.08 상승 / FAN-IN −.10 CYCLE −.15 STACK −.10
   하락. 포함 표본 확대는 "측정 신뢰도"를 올린 것이지 성능 자체를 올리는 게 아님 —
   이제부터의 클래스별 수치가 진짜 기준선.
3. λ 미니 사다리는 다음 후보로 이월.

주목: P@패턴R0.9 가 세탁점수 기준으로도 95.2%(HI-Small 79.7%) — 패턴 큐 품질이
크게 좋아졌다. 반면 P@R0.9(전체 세탁 닻)는 3.5%로 낮다 — NONPAT 꼬리가 분모를
지배(OVR NP .111). NONPAT 는 여전히 최약 신호.

운영 노트: run 1회 ≈ 2시간(학습 48분 + predict 59분). 사다리 설계 시 참고.
