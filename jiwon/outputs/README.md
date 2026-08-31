# 산출물 인덱스

실험 기록(run별 md·인덱스)은 [../runs/](../runs/README.md), 피처 명세는
[../features_v1.md](../features_v1.md). 이 폴더는 종합·분석 산출물만 모은다.

| 파일 | 내용 |
|---|---|
| [metrics_summary.md](metrics_summary.md) | 전 실험(run_001~013) 종합·클래스별 지표 정본 + 관찰 요약. 재생성: `scripts/summarize_runs.py` |
| [metrics_board.html](metrics_board.html) | 같은 지표의 히트맵 보드(브라우저로 열기) |
| [confusion_case_visualize.html](confusion_case_visualize.html) | run_011b 의 BIPARTITE·STACK·RANDOM 블록별 오분류 그래프 뷰어 |
| [bp_stack_case_analysis.md](bp_stack_case_analysis.md) | BP↔STACK 혼동의 피처 기여도(SHAP) 분석 — 공유 신호 + 수신계좌 활동 유무 스위치 |
| [split_boundary_note.md](split_boundary_note.md) | 분할 경계 걸침 편향 — 측정·purge 실험·문헌·채택 정책 종합 |
| [hi_large_transition.md](hi_large_transition.md) | **HI-Large 전환 계획 — 새 세션 핸드오프** (Phase 0~4, 이월 발견·미결 목록) |
| [hi_large_phase0_eda.md](hi_large_phase0_eda.md) | HI-Large Phase 0 전환 EDA 실측 — 꼬리 컷 11-05, 블록 span 15배, 매칭 전수 성립, **정렬 안 됨**, 후보 창 포함 블록 수 |
| [hi_large_phase2_pipeline.md](hi_large_phase2_pipeline.md) | HI-Large Phase 2 파이프라인 — prepare/빌더/검증 스크립트 설계·실측 (정렬 parquet 5GB, 브루트포스 검증 통과) |
| [block_reconstruction_design.md](block_reconstruction_design.md) | 블록 재구성 층 설계·실측 — 시간창 CC 기각, 허브 계좌 발견(비허브 체인 간선 순도 100%), 2단계 재구성 v2 설계 |
| [run_114_board.html](run_114_board.html) | **HI-Large 실험 보드 시리즈 최신** (run_101~114: 9클래스 전환 기준선·사다리 표·OVR 히트맵·혼동행렬·프로브 판정). 재생성: `scripts/make_board_large.py` — 마일스톤마다 `run_1XX_board.html`. 이전판: [113](run_113_board.html) · [111](run_111_board.html) |

웹 게시본(아티팩트): [HI-Small 지표 보드](https://claude.ai/code/artifact/6a6dcc64-3fdd-4693-8ce9-926da0b8c7ae) · [혼동 블록 뷰어](https://claude.ai/code/artifact/fbf621ac-9567-4852-b2ab-85c7942f867a) · [HI-Large run_111 보드](https://claude.ai/code/artifact/b3a83485-7d97-47f4-93db-8e7071cf55ff) · [HI-Large run_113 보드](https://claude.ai/code/artifact/ffd26ed0-b59c-4536-8fb0-2786a2178a52) · [**HI-Large run_114 보드(최신)**](https://claude.ai/code/artifact/311d210f-3530-40f8-a54f-f02980a2f3a3) · [진행 보고(2026-08-30)](https://claude.ai/code/artifact/4a7501d8-888a-4bc5-b3c0-5fd1e09db53a)
