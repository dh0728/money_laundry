"""HI-Large 실험 보드 생성기 — data_work/runs/run_1*.json -> outputs/run_1XX_board.html

사용법: python make_board_large.py <WS루트> [--name run_111_board]

- 이름 미지정 시 최신 run 번호로 run_<NNN>_board.html.
- 판정 라벨(JUDGE)은 실험 md 판정부와 동기 — 보드 재생성 시 여기만 갱신.
- HTML 은 자립형(라이트/다크 토큰), 히트맵 셀은 color-mix + CSS 변수라 테마 자동 적응.
"""
import json
import sys
from pathlib import Path

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
RUNS = WS / "data_work" / "runs"
OUT_DIR = Path(__file__).resolve().parents[1] / "outputs"

CLS9 = ["FAN-OUT", "FAN-IN", "G-SCATTER", "S-GATHER", "CYCLE",
        "RANDOM", "BIPARTITE", "STACK", "NONPAT"]
JUDGE = {  # run md 판정부와 동기
    "run_101": "keep · v1 기준선",
    "run_102": "keep · 노이즈 자(시드 43)",
    "run_103": "RUS와 알고리즘적 동치",
    "run_104": "discard · 모집단 왜곡",
    "run_105": "표본 103과 동일",
    "run_106": "discard · 균형화 악화",
    "run_107": "discard · 무이득, 비용 2배",
    "run_108": "discard · λ=100 유지",
    "run_111": "keep · 현 기준선 (v2)",
    "run_112": "discard · 패턴큐 +0.95pp < 배경큐 상실",
    "run_114": "keep · 현 기준선 (9클래스, 팀 확정)",
}
PROBE_JUDGE = {
    "run_109": "동률 — OvR 기각",
    "run_110": "동률 — OvR 기각",
    "run_113": "패배 — 캐스케이드 폐기 확정",
    "run_113b": "가중 변형 — 순위 붕괴",
}
PROBE_REF = {"FAN-IN": ("0.304", "run_101"), "BIPARTITE": ("0.143", "run_101"),
             "NONPAT": ("0.112", "run_111")}
BASELINE = "run_114"  # 현 기준선 — 스탯 타일·강조 행이 이 run 을 가리킨다

# 실험별 배경·설계·판정 명세 (짧게 — 상세는 문서 링크가 담당). 새 run 추가 시 갱신.
# (왜, 설계 요점, 판정: 지표→결과, 증명된 것, 근거 문서)
META = {
    "run_101": ("Large 전환 기준선 확보 (전환 계획 Phase 4)",
                "HI-Small run_011b 설정 승계 + Large 적응 2건 사전 명세",
                "전 지표 신규 측정 — aggregate 가 HI-Small 궤도 재현(PR-AUC 0.680 vs 0.665)",
                "파이프라인 이식 정합 + Large 기준점 성립",
                ["runs/run_101_large_baseline.md", "outputs/hi_large_transition.md"]),
    "run_102": ("방법 비교의 유의성 자(우연의 크기) 측정",
                "동일 조건에서 시드만 42→43",
                "시드쌍 차이 실측 — P@R0.7 ±0.38pp · OVR ±0.006",
                "이후 모든 사다리의 판정 노이즈 자 확보",
                ["runs/run_102_sampling_ladder.md"]),
    "run_103": ("팀 서베이(클러스터 언더샘플링) 실측 검증",
                "표본 크기 100:1 고정, 방법만 변인 + KLD 검증 구현",
                "P@R0.7 33.67%(노이즈 안) + KLD 전 후보 동률 0.00024",
                "비례 클러스터 층화 = RUS 동치 — 대규모 표본에선 대표성 이득 소멸",
                ["runs/run_102_sampling_ladder.md", "팀 서베이: CSSMC·K-means*(Lin 2017) 계열 리뷰"]),
    "run_104": ("〃 — 표본 분포를 실제로 바꾸는 균등 할당 변형",
                "군집당 동수 추출(논문 '골고루' 해석)",
                "P@R0.7 −2.3pp (노이즈 6배) · 패턴큐 −3.1pp",
                "모집단 왜곡(희귀 과대표집)은 정밀도를 훼손",
                ["runs/run_102_sampling_ladder.md"]),
    "run_105": ("〃 — 범주형 포함 군집(K-prototypes 근사)",
                "one-hot 확장 군집 공간 (kmodes 미설치 명시)",
                "표본 파일 array_equal — run_103 과 바이트 동일",
                "비례 할당에선 군집 공간 자체가 추출에 무영향(동치의 직접 증명)",
                ["runs/run_102_sampling_ladder.md"]),
    "run_106": ("'균형화가 학습을 의미있게 만드나' 가설의 실측 결착",
                "방법(RUS) 고정, 비율만 10:1로",
                "P@R0.7 −1.25pp · 전 클래스 OVR 하락",
                "균형화 가설 기각 — 다수 클래스 다양성이 거짓양성 제어를 지탱",
                ["runs/run_106_ratio_ladder.md"]),
    "run_107": ("〃 — 자연 분포 방향의 상한 확인",
                "비율 200:1 (메모리 상한 근접)",
                "P@R0.7 +0.29pp(노이즈 안) · 학습 비용 2배",
                "무이득 — 비율 100:1 종결 (§7 개선폭 vs 비용 저울)",
                ["runs/run_106_ratio_ladder.md"]),
    "run_108": ("λ=100 은 HI-Small 국소 최적 — 34배 데이터에서 재확인 의무",
                "전환 계획 §4 미니 사다리(λ∈{10,100}) 이행",
                "λ=10: P@R0.7 −2.6pp · 전 지표 열세",
                "λ=100 유지 — HI-Small 정규화 결론의 Large 이식 성립",
                ["runs/run_108_lambda_mini.md", "outputs/hi_large_transition.md"]),
    "run_109": ("OvR 앙상블 구조 제안의 저비용 프로브 (전면 구축 전 판정)",
                "run_015 구도: 전용 이진 vs 파생 p_k, 대표 클래스",
                "클래스 이진 PR-AUC 0.310 vs 파생 0.304 (노이즈 ±0.006 내)",
                "softmax 억제 제거 이득 ≈ 경쟁 정보 손실 (상쇄)",
                ["runs/run_109_ovr_probe.md"]),
    "run_110": ("〃 — 최약+혼동 당사자 클래스에서 재확인",
                "BIPARTITE 전용 이진",
                "0.145 vs 파생 0.143 (동률)",
                "최약 신호에서도 이득 0 → OvR 전면 구축 기각",
                ["runs/run_109_ovr_probe.md"]),
    "run_111": ("최약 클래스 신호 보강 + 장주기 결함(윈도우 72h vs span 27일) 수정",
                "감쇠 카운터 등 23피처, O(1) 상태 유지, 판정 기준 사전 등록",
                "사전 등록 2조건: ① P@R0.7 비악화(+0.15pp) ② 타깃 OVR +.03~.14(노이즈 5~20배) + 미노출닻 +1.63pp 교차",
                "장주기 결함 수정이 실질 — 개선은 암기 아닌 일반화(미노출 닻 확인)",
                ["features_v2.md", "runs/run_111_features_v2.md", "outputs/bp_stack_case_analysis.md"]),
    "run_112": ("§6 데이터 개입 영향 검증 1호 (전환의 본래 목적)",
                "train 만 정제(NONPAT 제거), val/test 원본",
                "두 축 방향 조합 — 패턴축 +0.95pp vs 전체축 P@R0.7 −18.8pp",
                "개입은 공짜가 아님: 버린 라벨 = 그 라벨을 잡는 능력과 맞교환",
                ["runs/run_112_drop_nonpat.md"]),
    "run_113": ("HI-Small 이월 캐스케이드 질문 종결 (run_014 판정 규칙 이행)",
                "전용 이진 NONPAT vs 파생 p_NONPAT",
                "NONPAT 이진 PR-AUC 0.109 vs 파생 0.112 — 동률 이하",
                "신호 부재는 아키텍처로 해결 불가 → 캐스케이드 폐기, 평면+두 점수 확정",
                ["runs/run_113_cascade2.md", "runs/run_014_9class.md"]),
    "run_113b": ("〃 — 가중 변형 포함 의무 이행",
                 "scale_pos_weight=음성/양성 비",
                 "PR-AUC 0.007 — 순위 붕괴",
                 "극단 불균형에서 가중은 경계 이동일 뿐, 순위를 파괴 (run_005 재확인)",
                 ["runs/run_113_cascade2.md"]),
    "run_114": ("팀 확정 구조(9클래스 + 세탁유무 이진 분리) 반영",
                "라벨 병합만 변인, 정본 지표를 패턴 축으로 재정의(사전 등록)",
                "패턴 축 — P@패턴R0.9 +0.94pp · 미노출닻 +1.49pp · 8클래스 OVR 동률↑",
                "9클래스 전환 무비용(+소폭 이득) — run_014 방향의 Large 재현",
                ["runs/run_114_nine_class.md", "CLAUDE.md §6"]),
}
# 대주제 그룹 (표 정렬·그룹 헤더·주제별 카드): (제목, 결론 1줄, 배경 1~2줄, runs).
# 새 run 은 그룹에 넣거나 자동으로 '미분류'.
GROUPS = [
    ("Ⅰ. HI-Large 전환 · 기준선", "전환 목적(노출 편향 측정 가능화) 달성 + Large 기준점 성립",
     "<ul>"
     "<li><b>왜 전환했나</b>: 분할 경계에서 패턴 블록이 절단(노출)되며 앞부분이 train 에 "
     "들어가는 편향 — Small(유효 16일)은 미노출 블록이 클래스당 7~73건뿐이라 이 편향을 "
     "<b>측정할 통계 자체가 불가</b>. <code>outputs/hi_large_transition.md</code></li>"
     "<li><b>어떻게 처리했나</b>: 노출은 제거 불가(블록 span 중앙값 27일 &gt; 가능한 갭 폭 — "
     "\"갭≥최대블록\" 원안 실측 폐기) → <b>무갭 분할 + 노출/미노출 층화 + 일반화 주장은 미노출 "
     "닻으로만</b>. val/test 각 3주로 미노출 블록 클래스당 수십~수백 확보. "
     "<code>outputs/hi_large_phase0_eda.md</code></li>"
     "<li><b>평가 결과</b>: 층화 탐지@R0.7 <b>노출 99.2% vs 미노출 98.3%</b> — 노출 우위 "
     "사실상 소멸(편향이 지표를 왜곡하지 않음). 이후 개선(v2·9클래스)이 미노출 닻에서도 "
     "확인(+1.5~1.6pp) = 암기 아닌 일반화.</li>"
     "<li><b>남은 한계(관리 중)</b>: 미노출 닻은 단span 변형만 표집 — 장span 블록의 일반화 "
     "평가는 블록 판정 층(설계 진행 중) 몫. <code>outputs/block_reconstruction_design.md</code></li>"
     "</ul>",
     ["run_101"]),
    ("Ⅱ. 언더샘플링 설계", "노이즈 자 확보 후 방법(RUS)·비율(100:1) 확정 — 동치·악화 실측으로 종결",
     "train NORMAL 1억 행(~25GB)은 학습 불가 — 다운샘플은 균형화가 아니라 계산 필연이며, "
     "세탁 전량 유지·train 에만 적용(val/test 원본 분포). 팀 서베이(CSSMC·K-means* 계열)를 "
     "전량 실측 검증하고 '균형화가 학습을 의미있게 만든다' 가설을 데이터로 결착. "
     "비교 설계: 방법 비교는 크기(100:1) 고정, 비율 비교는 방법(RUS) 고정 — 항상 단일 변인.",
     ["run_102", "run_103", "run_104", "run_105", "run_106", "run_107"]),
    ("Ⅲ. 정규화 이식 재확인", "λ=100 유지 — HI-Small 결론의 Large 이식 성립",
     "λ=100 은 HI-Small 크기의 국소 최적 — 데이터 34배에서 최적점 이동 가능성을 미니 "
     "사다리 1회로 재확인하는 것이 전환 계획 §4 의 의무 사항.",
     ["run_108"]),
    ("Ⅳ. 모델 구조", "평면 다중클래스 확정 — OvR·캐스케이드 기각",
     "패턴별 이진 앙상블(OvR) 제안과 HI-Small 이월 캐스케이드 질문(run_014 판정 규칙)을 "
     "전면 구축 전에 저비용 프로브로 판정. 판정 지표 = 해당 클래스 이진 PR-AUC vs "
     "10클래스 파생 p_k(동일 정의 OVR) — 전용 모델이 파생 점수를 이기는가.",
     ["run_109", "run_110", "run_113", "run_113b"]),
    ("Ⅴ. 피처 (features_v2)", "장주기 결함 수정 — 패턴 전 클래스 개선, 새 기준선",
     "최약 클래스(BIPARTITE·RANDOM·CYCLE·FAN-IN) 신호 보강. 핵심 진단: v1 윈도우(≤72h)가 "
     "블록 span(중앙값 27일)을 보지 못함 → 감쇠 카운터(7d/30d)·중계/되돌림·일회성 간선 등 "
     "23피처. 채택 기준 사전 등록: ① P@R0.7 비악화 ② 타깃 클래스 OVR 개선 ③ 미노출 닻 교차 확인.",
     ["run_111"]),
    ("Ⅵ. 데이터 개입 검증", "무개입 확정 — 개입은 버린 라벨을 잡는 능력과 맞교환",
     "§6 개입 정의(train 만 정제, val/test 원본)의 첫 검증 — 전환의 본래 목적 중 하나. "
     "판정은 단일 지표가 아니라 패턴 축·전체 세탁 축 두 지표의 방향 조합으로 사전 등록.",
     ["run_112"]),
    ("Ⅶ. 라벨 구성 (팀 구조 정렬)", "9클래스 전환 — 팀 확정 구조, 현 기준선",
     "팀 확정(9클래스 패턴 분류 + 세탁유무는 이단모델 이진 트랙 분리) 반영. 정본 지표를 "
     "패턴 축(P@패턴R0.9·미노출 닻·8클래스 OVR)으로 재정의(사전 등록)하고 전환 비용을 측정.",
     ["run_114"]),
]
def grouped_runs():
    seen = set()
    for title, concl, bg, ks in GROUPS:
        ks2 = [k for k in ks if k in recs]
        seen.update(ks2)
        if ks2:
            yield title, concl, bg, ks2
    rest = [k for k in sorted(recs, key=runkey) if k not in seen]
    if rest:
        yield "미분류", "", "", rest

PRINCIPLES = ("공통 설계 원칙(§7): 실험 1회 = 단일 변인 · 가설 사전 등록 · 판정은 시드쌍 "
              "노이즈 자(±0.38pp) 대비 · 동일 분할·동일 평가 계약(run_ladder 이식: 층화 "
              "노출/미노출 · 미노출 닻 · Σp_패턴 — 근거: outputs/split_boundary_note.md, "
              "runs/run_014_9class.md) · test 미개봉")

recs = {}
for p in sorted(RUNS.glob("run_1*.json")):
    if p.stem.endswith("_smoke"):
        continue
    recs[p.stem] = json.loads(p.read_text(encoding="utf-8"))
multi = {k: v for k, v in recs.items() if "ovr_pr_auc" in v["metrics"]}
probes = {k: v for k, v in recs.items() if "binary_pr_auc" in v["metrics"]}
latest = max(int("".join(filter(str.isdigit, k.split("_")[1]))) for k in recs)
NAME = sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else f"run_{latest}_board"

def pct(x, d=2):
    return f"{x * 100:.{d}f}"

# ---- 실험 표 (전 run — 이진 프로브 포함) ----
def runkey(k):
    tag = k.split("_")[1]
    return (int("".join(filter(str.isdigit, tag))), tag)

rows = []
for gtitle, gconcl, _bg, ks in grouped_runs():
    gc = f'<span class="gc"> — {gconcl}</span>' if gconcl else ""
    rows.append(f'<tr class="grp"><td colspan="13">{gtitle}{gc}</td></tr>')
    for k in ks:
        m = recs[k]["metrics"]
        var = recs[k].get("single_variable", "")
        base = ' class="hl"' if k == BASELINE else ""
        common = (f'<tr{base}><td class="rid">{k.replace("run_", "")}</td><td class="var">{var}</td>')
        tail = (f'<td>{m["best_iteration"]}</td>'
                f'<td>{recs[k].get("n_train", 0) / 1e6:.2f}M</td>')
        if k in probes:
            rows.append(
                common + f'<td>{m["binary_pr_auc"]:.4f}<span style="color:var(--muted)"> (이진 {m["class"]})</span></td>'
                + '<td>—</td>' * 7 + tail
                + f'<td class="jd">{PROBE_JUDGE.get(k, "")}</td></tr>')
            continue
        strad = f'{pct(m["det_R0.7_straddle_pattern"], 1)} / {pct(m["det_R0.7_contained_pattern"], 1)}' \
            if "det_R0.7_straddle_pattern" in m else "—"
        rows.append(
            common
            + f'<td>{m["val_pr_auc"]:.4f}</td><td>{pct(m["max_f1"])}</td>'
            f'<td>{pct(m["precision_at_recall_0.5"])}</td><td><b>{pct(m["precision_at_recall_0.7"])}</b></td>'
            f'<td>{pct(m["precision_at_recall_0.9"])}</td>'
            f'<td>{pct(m["precision_at_pattern_recall_0.9"])}</td>'
            f'<td>{pct(m.get("precision_at_contained_pattern_recall_0.9", 0))}</td>'
            f'<td>{strad}</td>' + tail
            + f'<td class="jd">{JUDGE.get(k, recs[k].get("status", ""))}</td></tr>')
table = "\n".join(rows)

# ---- 실험별 배경·설계 근거 표 ----
cards = []
for gtitle, gconcl, bg, ks in grouped_runs():
    lines = []
    refs_all = []
    for k in ks:
        why, design, verdict, proven, refs = META.get(k, ("", "", "", "", []))
        lines.append(f'<li><b>{k.replace("run_", "")}</b> · {why} — {verdict} '
                     f'→ <b>{proven}</b></li>')
        for r in refs:
            if r not in refs_all:
                refs_all.append(r)
    ref_html = " · ".join(f"<code>{r}</code>" for r in refs_all)
    cards.append(
        f'<div class="card gcard"><h3>{gtitle} <span class="gc">— {gconcl}</span></h3>'
        f'<div class="bg">{bg}</div><ul>{"".join(lines)}</ul>'
        f'<p class="note">근거: {ref_html}</p></div>')
why_cards = "\n".join(cards)

# ---- OVR 히트맵 (셀 = color-mix 비율, 값 0~0.65 스케일) ----
heat_rows = []
for k in sorted(multi):
    ovr = multi[k]["metrics"]["ovr_pr_auc"]
    cells = []
    for c in CLS9:
        v = ovr.get(c)  # 9클래스 run 은 NONPAT 없음
        if v is None:
            cells.append('<td style="color:var(--muted)">—</td>')
            continue
        p = min(v / 0.65, 1.0) * 82
        ink = "var(--ink-on-heat)" if p > 55 else "var(--ink)"
        cells.append(f'<td style="background:color-mix(in oklab, var(--heat) {p:.0f}%, '
                     f'var(--surface));color:{ink}">{v:.3f}</td>')
    heat_rows.append(f'<tr><td class="rid">{k.replace("run_", "")}</td>' + "".join(cells) + "</tr>")
heat = "\n".join(heat_rows)

# ---- v1 -> v2 OVR 델타 바 ----
delta_rows = []
if "run_101" in multi and "run_111" in multi:
    o1 = multi["run_101"]["metrics"]["ovr_pr_auc"]
    o2 = multi["run_111"]["metrics"]["ovr_pr_auc"]
    dmax = max(o2[c] - o1[c] for c in CLS9)
    for c in sorted(CLS9, key=lambda c: o1[c] - o2[c]):
        d = o2[c] - o1[c]
        w = max(abs(d) / dmax * 100, 1.5)
        delta_rows.append(
            f'<div class="drow"><span class="dlab">{c}</span>'
            f'<span class="dtrack"><span class="dbar" style="width:{w:.0f}%"></span></span>'
            f'<span class="dval">{"+" if d >= 0 else ""}{d:.3f}</span></div>')
delta = "\n".join(delta_rows)

# ---- 이진 프로브 ----
probe_rows = []
for k in sorted(probes):
    m = probes[k]["metrics"]
    ref, src = PROBE_REF.get(m["class"], ("—", ""))
    probe_rows.append(
        f'<tr><td class="rid">{k.replace("run_", "")}</td><td>{m["class"]}</td>'
        f'<td>{m["binary_pr_auc"]:.4f}</td><td>{ref} <span style="color:var(--muted)">({src})</span></td>'
        f'<td class="jd">{PROBE_JUDGE.get(k, "")}</td></tr>')
probe = "\n".join(probe_rows)

# ---- 혼동행렬 (행 정규화 %, 기록 있는 run 만) ----
CLS10 = ["NORMAL"] + CLS9
def conf_table(k, caption):
    cm = multi.get(k, {}).get("metrics", {}).get("confusion_matrix")
    if not cm:
        return ""
    body = []
    for i in range(10):
        tot = sum(cm[i]) or 1
        cells = []
        for j in range(10):
            v = cm[i][j] / tot * 100
            p = min(v, 100) * 0.8
            ink = "var(--ink-on-heat)" if p > 55 else "var(--ink)"
            dg = ' class="dg"' if i == j else ""
            cells.append(f'<td{dg} title="{cm[i][j]:,}건" style="background:color-mix(in oklab, '
                         f'var(--heat) {p:.0f}%, var(--surface));color:{ink}">{v:.1f}</td>')
        body.append(f'<tr><td class="rid">{CLS10[i]}</td>' + "".join(cells) + "</tr>")
    return (f'<div><h3>{caption}</h3><div class="scroll"><table class="heat">'
            f'<thead><tr><th>정답＼예측</th>{"".join(f"<th>{c}</th>" for c in CLS10)}</tr></thead>'
            f'<tbody>{"".join(body)}</tbody></table></div></div>')
confusion = conf_table("run_111", "run_111 — 무개입 기준선") + \
            conf_table("run_112", "run_112 — 개입(NONPAT 제거) 대비")

b111 = multi[BASELINE]["metrics"]

html = f"""<title>HI-Large 실험 보드 · run_{latest}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
:root {{
  --bg:#F6F7F9; --surface:#FFFFFF; --ink:#1B2434; --muted:#5C6678; --line:#E3E7EE;
  --accent:#2D62B0; --heat:#2D62B0; --ink-on-heat:#F5F8FE; --hl:#EEF3FB;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    --bg:#0E131B; --surface:#161D28; --ink:#E4E9F2; --muted:#8C96A8; --line:#27303E;
    --accent:#7AA7E8; --heat:#4E7FCB; --ink-on-heat:#0E131B; --hl:#1B2634;
  }}
}}
:root[data-theme="dark"] {{
  --bg:#0E131B; --surface:#161D28; --ink:#E4E9F2; --muted:#8C96A8; --line:#27303E;
  --accent:#7AA7E8; --heat:#4E7FCB; --ink-on-heat:#0E131B; --hl:#1B2634;
}}
* {{ box-sizing:border-box; }}
body {{ background:var(--bg); color:var(--ink); margin:0;
  font-family:"IBM Plex Sans KR", "Malgun Gothic", sans-serif; line-height:1.55; }}
main {{ max-width:1080px; margin:0 auto; padding:40px 24px 72px; display:flex;
  flex-direction:column; gap:36px; }}
header p {{ color:var(--muted); margin:6px 0 0; font-size:14px; }}
h1 {{ font-size:26px; margin:0; letter-spacing:-0.01em; text-wrap:balance; }}
h1 .run {{ color:var(--accent); }}
h2 {{ font-size:16px; margin:0 0 4px; }}
h2 + p {{ margin:0 0 12px; color:var(--muted); font-size:13px; }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; }}
.tile {{ background:var(--surface); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; }}
.tile .l {{ font-size:11px; letter-spacing:0.06em; text-transform:uppercase;
  color:var(--muted); }}
.tile .v {{ font-family:"IBM Plex Mono",monospace; font-size:24px; font-weight:600;
  margin-top:2px; }}
.tile .d {{ font-size:12px; color:var(--accent); font-family:"IBM Plex Mono",monospace; }}
.scroll {{ overflow-x:auto; background:var(--surface); border:1px solid var(--line);
  border-radius:8px; }}
table {{ border-collapse:collapse; width:100%; font-size:13px;
  font-variant-numeric:tabular-nums; }}
th, td {{ padding:7px 10px; text-align:right; white-space:nowrap; }}
th {{ color:var(--muted); font-weight:500; font-size:11.5px; border-bottom:1px solid var(--line);
  position:sticky; top:0; background:var(--surface); }}
td {{ border-bottom:1px solid var(--line); font-family:"IBM Plex Mono",monospace; font-size:12.5px; }}
tr:last-child td {{ border-bottom:none; }}
td.rid {{ font-weight:600; color:var(--accent); }}
td.var, td.jd {{ text-align:left; font-family:"IBM Plex Sans KR",sans-serif; font-size:12.5px;
  white-space:normal; min-width:150px; max-width:340px; }}
td.jd {{ color:var(--muted); }}
tr.hl td {{ background:var(--hl); }}
.heat td {{ text-align:center; }}
.drow {{ display:flex; align-items:center; gap:12px; padding:3px 0; }}
.dlab {{ width:110px; font-size:12.5px; text-align:right; color:var(--muted); }}
.dtrack {{ flex:1; height:14px; }}
.dbar {{ display:block; height:100%; background:var(--accent); border-radius:0 3px 3px 0; }}
.dval {{ width:64px; font-family:"IBM Plex Mono",monospace; font-size:12.5px; }}
.card {{ background:var(--surface); border:1px solid var(--line); border-radius:8px;
  padding:16px 20px; }}
.note {{ font-size:12px; color:var(--muted); }}
td.dg {{ outline:2px solid var(--accent); outline-offset:-2px; }}
code {{ font-family:"IBM Plex Mono",monospace; font-size:11.5px; background:var(--hl);
  padding:1px 5px; border-radius:4px; white-space:nowrap; }}
tr.grp td {{ background:var(--hl); font-family:"IBM Plex Sans KR",sans-serif;
  font-weight:700; font-size:12.5px; text-align:left; white-space:normal; }}
.gc {{ color:var(--muted); font-weight:400; }}
.gcard {{ margin:12px 0; }}
.gcard h3 {{ margin:0 0 6px; font-size:14px; }}
.gcard .bg {{ font-size:12.5px; color:var(--muted); margin:4px 0 8px; max-width:78ch; }}
.gcard .bg ul {{ margin:4px 0; padding-left:18px; }}
.gcard .bg li {{ margin:3px 0; }}
.gcard ul {{ margin:6px 0; padding-left:18px; font-size:13px; }}
.gcard li {{ margin:4px 0; max-width:82ch; }}
h3 {{ font-size:13.5px; margin:14px 0 6px; color:var(--muted); font-weight:500; }}
</style>
<main>
<header>
  <h1>HI-Large 단일 모델 트랙 · 실험 보드 <span class="run">run_{latest}</span></h1>
  <p>분할 train 08-01~09-23 · val 09-24~10-14 · test 미개봉 │ 전처리 RUS 100:1(시드 42)
  │ LightGBM 9클래스 패턴 분류(run_114~, 101~113은 10클래스) │ 세탁 유무 = 이단모델
  트랙 담당 │ 지표는 val 전량 39.17M행 기준</p>
</header>

<section class="tiles">
  <div class="tile"><div class="l">P@패턴R0.9 (정본) · {BASELINE}</div><div class="v">{pct(b111["precision_at_pattern_recall_0.9"])}%</div><div class="d">run_111(10클래스) 대비 {(b111["precision_at_pattern_recall_0.9"] - multi["run_111"]["metrics"]["precision_at_pattern_recall_0.9"]) * 100:+.2f}pp</div></div>
  <div class="tile"><div class="l">P@미노출패턴R0.9 (일반화 닻)</div><div class="v">{pct(b111["precision_at_contained_pattern_recall_0.9"])}%</div><div class="d">{(b111["precision_at_contained_pattern_recall_0.9"] - multi["run_111"]["metrics"]["precision_at_contained_pattern_recall_0.9"]) * 100:+.2f}pp</div></div>
  <div class="tile"><div class="l">OVR 최약 클래스</div><div class="v">{min(b111["ovr_pr_auc"].values()):.3f}</div><div class="d">{min(b111["ovr_pr_auc"], key=b111["ovr_pr_auc"].get)}</div></div>
  <div class="tile"><div class="l">PR-AUC (참고 · 세탁 축)</div><div class="v">{b111["val_pr_auc"]:.4f}</div><div class="d">세탁 유무는 이단모델 트랙 담당</div></div>
</section>

<section>
  <h2>실험 요약 (run_101~{latest})</h2>
  <p>단일 변인 사다리 — 강조 행이 현 기준선. 노출/미노출 = 패턴 탐지율@R0.7 층화.
  <b>용어</b>: 노출 = train 경계에 걸쳐 앞부분이 학습에 노출된 블록 · <b>미노출</b> =
  평가 창에서 새로 시작해 학습에 걸치지 않은 블록 — 일반화 판정은 미노출 닻으로만
  (구 기록 문서의 용어 '포함'과 동일 개념).</p>
  <div class="scroll"><table>
  <thead><tr><th>run</th><th style="text-align:left">단일 변인</th><th>PR-AUC</th><th>max-F1%</th>
  <th>P@R0.5%</th><th>P@R0.7%</th><th>P@R0.9%</th><th>P@패턴R0.9%</th><th>P@미노출R0.9%</th>
  <th>노출/미노출%</th><th>iter</th><th>train</th><th style="text-align:left">판정</th></tr></thead>
  <tbody>{table}</tbody></table></div>
</section>

<section>
  <h2>주제별 정리 — 배경 · 판정 · 증명</h2>
  <p>실험마다 목적이 달라 판정 지표도 다르다 — 주제별 배경과 run 별 "무슨 지표로 →
  무엇을 증명"을 한 절씩. 가설 전문·세부 분석은 근거 문서
  (경로는 저장소 <code>money_laundry/jiwon/</code> 기준).</p>
  {why_cards}
  <div class="card gcard"><h3>Ⅷ. 블록 재구성 · 판정 층 <span class="gc">— 진행 중 (다음 실험 run_115)</span></h3>
  <div class="bg">
  <b>왜</b>: run_114 혼동 분석 — 분류 실패의 55%는 패턴 간 혼동이고 탐지 유출은 2.7%뿐.
  결정 증거(BP↔STACK: "수신자가 이후 또 보내는가", RANDOM: 블록 중계율 ~90%)가 거래
  하나에는 없고 블록 층위에만 존재 — 거래 단위 argmax 의 원리적 한계. 블록 판정은
  사후(조사 시점)라 인과 제약도 없다. 서빙 위치: 추론 서버 배치 잡 → DB block 테이블.
  <ul>
  <li><b>실측 반복 1</b> — 통념적 "계좌 공유 + 시간창" 연결요소: <b>기각.</b> attempt 간
  계좌 재사용 접점 6만 개(gap 중앙값 1.2일)가 블록 내부 gap 분포(p99 28.8일)와 완전히
  겹침 — 최선 pairF1 0.046.</li>
  <li><b>실측 반복 2</b> — 자금 흐름(체인)·금액 매칭·팬 형제 규칙: <b>부족.</b> 체인
  간선조차 attempt 내부 비율 17.7~30%.</li>
  <li><b>실측 반복 3</b> — <b>돌파구: 허브 계좌.</b> 패턴 계좌의 86%는 단일 attempt 소속,
  <b>비허브 간 체인 간선 순도 100%</b>(6만 개 전수) — 오염원은 재사용 허브 14%뿐.
  단, 허브를 관측 가능 프록시(활동기간 AUC 0.951)로 하드 컷하면 CC 가 전이적으로
  취약(F1 0.398 vs 오라클 상한 0.664).</li>
  <li><b>확정 설계</b>: <b>동일블록 간선 분류기</b>(정답 attempt 16,467개로 지도학습,
  후보 간선 ~120만) → 확률 가중 뼈대 CC → 허브 거래 사후 부착. 간선 단위 결정이라
  하드 컷의 전이 취약성이 없음. 이후 블록 분류기 사다리(집계 피처 GBT vs 블록 GNN —
  GNN 첫 투입 지점).</li>
  </ul></div>
  <p class="note">근거: <code>outputs/block_reconstruction_design.md</code> ·
  <code>runs/run_114_nine_class.md</code>(혼동 분석) ·
  <code>outputs/bp_stack_case_analysis.md</code>(관측 단위 앨리어싱 원인 규명)</p></div>
  <p class="note">{PRINCIPLES}</p>
</section>

<section>
  <h2>클래스별 OVR PR-AUC</h2>
  <p>p_k 로 해당 클래스만 골라내는 순위 능력 — 진한 셀일수록 강한 신호. 시드 노이즈 ±0.006.</p>
  <div class="scroll"><table class="heat">
  <thead><tr><th>run</th>{"".join(f"<th>{c}</th>" for c in CLS9)}</tr></thead>
  <tbody>{heat}</tbody></table></div>
</section>

<section>
  <h2>혼동행렬 (argmax, 행 정규화 %)</h2>
  <p>행 = 정답, 열 = 예측. 셀 hover 로 건수. 강조 테두리 = 대각(정답 예측).</p>
  {confusion}
</section>

<section class="card">
  <h2>features v1 → v2 클래스 개선 (run_101 → run_111)</h2>
  <p>OVR PR-AUC 변화 — 장주기(감쇠)·중계 축이 설계 의도대로 장span 클래스를 끌어올림.</p>
  {delta}
</section>

<section>
  <h2>전용 이진 프로브 (OvR · 캐스케이드 2단)</h2>
  <div class="scroll"><table>
  <thead><tr><th>run</th><th>클래스</th><th>이진 PR-AUC</th><th>파생 p_k 기준</th>
  <th style="text-align:left">판정</th></tr></thead>
  <tbody>{probe}</tbody></table></div>
  <p class="note">전용 이진은 어느 클래스에서도 파생 점수를 이기지 못함 — 구조 확정:
  평면 10클래스 + 두 점수 서빙(Σp_패턴 / p_NONPAT). (run_109·110·113·113b)</p>
</section>

<p class="note">생성: scripts/make_board_large.py · 원자료 data_work/runs/run_1*.json ·
판정 근거는 각 run md (jiwon/runs/) 참조</p>
</main>
"""
out = OUT_DIR / f"{NAME}.html"
out.write_text(html, encoding="utf-8")
print(f"saved: {out}")
