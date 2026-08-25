"""HI-Small 10클래스 라벨 구축.

사용법: python3 build_labels.py <WS루트>

Patterns.txt의 각 세탁 시도 블록을 파싱해 Trans.csv 행과 전체 라인 일치로
매칭하고, 거래 단위 라벨(csv 행 순서 그대로)을 data_work/에 저장한다.

라벨: 0=NORMAL, 1=FAN-OUT, 2=FAN-IN, 3=GATHER-SCATTER, 4=SCATTER-GATHER,
      5=CYCLE, 6=RANDOM, 7=BIPARTITE, 8=STACK, 9=NONPATTERN-LAUNDERING
"""
import sys
from collections import defaultdict, Counter
from pathlib import Path

WS = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
TRANS = WS / "data" / "HI-Small_Trans.csv"
PATTERNS = WS / "data" / "HI-Small_Patterns.txt"
OUT = WS / "data_work" / "HI-Small_labels_10class.csv"

LABELS = {"FAN-OUT": 1, "FAN-IN": 2, "GATHER-SCATTER": 3, "SCATTER-GATHER": 4,
          "CYCLE": 5, "RANDOM": 6, "BIPARTITE": 7, "STACK": 8}

# ---- 1. Patterns.txt 파싱 ----
# line -> [(label, attempt_id), ...]  (같은 라인이 여러 번 나오면 그 수만큼)
pattern_occ = defaultdict(list)
attempt_id = -1
cur_label = None
n_pattern_lines = 0
attempt_type = {}  # attempt_id -> label

with open(PATTERNS) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        if line.startswith("BEGIN LAUNDERING ATTEMPT"):
            attempt_id += 1
            typ = line.split(" - ", 1)[1].split(":")[0].strip()
            assert typ in LABELS, f"unknown pattern type: {typ!r}"
            cur_label = LABELS[typ]
            attempt_type[attempt_id] = typ
        elif line.startswith("END LAUNDERING ATTEMPT"):
            cur_label = None
        else:
            assert cur_label is not None, f"transaction line outside block: {line[:80]}"
            pattern_occ[line].append((cur_label, attempt_id))
            n_pattern_lines += 1

n_attempts = attempt_id + 1
dup_within_patterns = sum(len(v) - 1 for v in pattern_occ.values() if len(v) > 1)

# ---- 2. Trans.csv 스트리밍 매칭 ----
# 같은 라인이 trans에 여러 번 있으면 앞에서부터 pattern occurrence를 하나씩 소비
remaining = {k: list(v) for k, v in pattern_occ.items()}
labels = []          # 행 순서대로 (label, attempt_id)
n_rows = 0
matched = 0
matched_but_flag0 = 0          # 패턴에 매칭됐는데 Is Laundering=0
extra_identical = Counter()    # 패턴 occurrence 소진 후 또 나타난 동일 라인
flag1_total = 0

with open(TRANS) as f:
    header = f.readline().rstrip("\n")
    for raw in f:
        line = raw.rstrip("\n")
        n_rows += 1
        flag = line.rsplit(",", 1)[1]
        if flag == "1":
            flag1_total += 1
        occ = remaining.get(line)
        if occ:
            lab, aid = occ.pop(0)
            if not occ:
                del remaining[line]
            matched += 1
            if flag != "1":
                matched_but_flag0 += 1
            labels.append((lab, aid))
        else:
            if line in pattern_occ:
                extra_identical[line] += 1
            if flag == "1":
                labels.append((9, -1))
            else:
                labels.append((0, -1))

unmatched_pattern_occ = sum(len(v) for v in remaining.values())

# ---- 3. 저장 ----
with open(OUT, "w") as f:
    f.write("label,attempt_id\n")
    for lab, aid in labels:
        f.write(f"{lab},{aid}\n")

# ---- 4. 검증 리포트 ----
dist = Counter(lab for lab, _ in labels)
name = {0: "NORMAL", 9: "NONPATTERN-LAUNDERING", **{v: k for k, v in LABELS.items()}}
attempt_dist = Counter(attempt_type.values())

print(f"trans rows            : {n_rows}")
print(f"attempts parsed       : {n_attempts} (types: {dict(attempt_dist)})")
print(f"pattern lines         : {n_pattern_lines} (identical-line dups within patterns: {dup_within_patterns})")
print(f"matched to trans      : {matched}")
print(f"unmatched pattern occ : {unmatched_pattern_occ}")
print(f"matched but flag=0    : {matched_but_flag0}")
print(f"extra identical lines in trans (beyond pattern occ count): {sum(extra_identical.values())} ({len(extra_identical)} distinct)")
print(f"Is Laundering=1 total : {flag1_total}")
print()
print("class distribution:")
for lab in sorted(dist):
    print(f"  {lab:2d} {name[lab]:<22} {dist[lab]:>9,}")
