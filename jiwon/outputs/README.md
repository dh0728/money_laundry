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

웹 게시본(아티팩트): [지표 보드](https://claude.ai/code/artifact/6a6dcc64-3fdd-4693-8ce9-926da0b8c7ae) · [혼동 블록 뷰어](https://claude.ai/code/artifact/fbf621ac-9567-4852-b2ab-85c7942f867a)
