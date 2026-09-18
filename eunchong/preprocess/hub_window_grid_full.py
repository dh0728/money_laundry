#!/usr/bin/env python3
"""블록 묶기 W × 허브 2차원 격자 — **꼬리를 자르지 않은(full) 모집단**에서 다시 잰다. 2026-09-08.

왜 다시 재는가:
  `hub_window_grid.py` 를 `HI-Large_main`(꼬리 자름)에서 돌려 117칸 격자를 얻었지만,
  그 격자의 채점 자격(eligible) 모집단 자체가 절단에 오염돼 있다:
      시험 구간 사건 3,205개 중 2,411개(75.2%)가 절단 때문에 거래가 잘려 '미완결'로 탈락했다.
  즉 main 격자의 진짜온전율_자격은 "짧고 온전히 남은 쉬운 사건"만 채점한 수치다.
  꼬리를 안 자르면 채점 대상이 시험 구간에서 360 → 2,901건(8.1배)으로 늘고 완결률이 100%가 된다
  (`trim_effect_lightweight.py` 실측, 같은 방식이 main 산출물을 오차 0으로 재현함).

왜 전체 전처리를 안 돌리는가:
  `preprocess_9class.py --basis full` 전량 실행은 55 GB 피처 행렬을 쓰느라 anon 19 GiB 를 먹고
  mem_guard 의 절대 중지 임계(70% = 19.1 GiB)에 걸려 죽는다(2026-09-08 01:34:46 실측:
  anon 19.28 GiB 에서 SIGTERM). 그런데 묶기 격자에 필요한 것은 피처가 아니라
  **양성 거래의 (계좌, 시각)과 정답 사건 id** 뿐이다. 그건 interim parquet 에서 양성 행만
  걸러 오면 되고, 그러면 피크가 3 GiB 미만이다.

정직한 한계:
  - `clean_rows` 의 완전중복 제거 10,829행(전체의 0.006%)을 재현하지 않는다. 분할 경계가
    최대 약 6,500행 밀릴 수 있으나 밀집 구간에서 1분 미만이고, ±1분 흔들어도 채점 자격 수가
    바뀌지 않음을 확인했다. 양성 행에는 완전중복이 0건이므로(main features_meta 의
    exact_duplicates_positive=0) 묶기 대상 자체는 영향이 없다.
  - 계좌 id 는 재색인(old2new) 전의 원본 KeyDict id 를 그대로 쓴다. link_components 는
    계좌 동일성만 보므로 결과가 같다.
  - 이 표는 **묶기 품질만** 잰다. 최종 macro-F1 은 후보를 골라 별도로 확인해야 한다.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

_THREADS = os.environ.get('AML_THREADS', '3')
for _v in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
           'NUMEXPR_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ.setdefault(_v, _THREADS)

import numpy as np                                      # noqa: E402
import pandas as pd                                     # noqa: E402

sys.path.insert(0, '/workspace')
from prep9 import postprocess_blocks as pb              # noqa: E402
from hub_window_grid import quality, WINDOWS_DEFAULT, DEGREES_DEFAULT, anon_gib   # noqa: E402

CLASS_MAP = {'FAN-OUT': 0, 'FAN-IN': 1, 'CYCLE': 2, 'SCATTER-GATHER': 3,
             'GATHER-SCATTER': 4, 'BIPARTITE': 5, 'STACK': 6, 'RANDOM': 7}
JOIN_KEYS = ['ts_min', 'src_id', 'dst_id', 'cents', 'fmt_code']
TRAIN_FRAC, VAL_FRAC = 0.60, 0.20
SPLIT_NAME = {0: '연습(train)', 1: '중간(val)', 2: '시험(test)'}


def load_positives(part_dir: Path) -> tuple[pd.DataFrame, np.ndarray, int, np.ndarray]:
    """parquet 파트에서 (양성 행 표, 계좌 차수, 전체 행수, 전체 ts) 를 얻는다.

    양성은 20만 행 남짓이라 통째로 들고 있어도 가볍다. 차수와 ts 는 파트마다 누적한다.
    """
    parts = sorted(part_dir.glob('part-*.parquet'))
    if not parts:
        sys.exit(f'[에러] parquet 파트가 없다: {part_dir}')
    cols = ['ts_epoch_min', 'src_id', 'dst_id', 'cents', 'fmt_code', 'is_pos']
    pos_chunks, ts_chunks = [], []
    deg = None
    n_total = 0
    for i, f in enumerate(parts):
        d = pd.read_parquet(f, columns=cols)
        n_total += len(d)
        s = d['src_id'].to_numpy()
        t = d['dst_id'].to_numpy()
        for arr in (s, t):
            c = np.bincount(arr)
            deg = c if deg is None else (
                np.pad(deg, (0, max(0, len(c) - len(deg)))) +
                np.pad(c, (0, max(0, len(deg) - len(c)))))
        ts_chunks.append(d['ts_epoch_min'].to_numpy())
        m = d['is_pos'].to_numpy() == 1
        if m.any():
            pos_chunks.append(d.loc[m, cols[:-1]].copy())
        del d, s, t
        if (i + 1) % 30 == 0:
            print(f'   파트 {i+1}/{len(parts)} · 누적 {n_total:,}행 · anon {anon_gib():.2f} GiB',
                  flush=True)
    pos = pd.concat(pos_chunks, ignore_index=True)
    ts_all = np.concatenate(ts_chunks)
    del pos_chunks, ts_chunks
    return pos, deg, n_total, ts_all


def parse_patterns(path: Path, node_index: pd.Index, fmt_index: pd.Index) -> pd.DataFrame:
    """load_patterns 와 같은 파싱 + 원본 KeyDict id 로 인코딩."""
    lines = pd.Series(Path(path).read_text(encoding='utf-8').splitlines())
    begin = lines.str.startswith('BEGIN LAUNDERING ATTEMPT')
    end_ = lines.str.startswith('END LAUNDERING ATTEMPT')
    hdr = lines.str.extract(r'^BEGIN LAUNDERING ATTEMPT - (.+)$', expand=False).ffill()
    ptype = hdr.str.extract(r'^([A-Z\-]+)', expand=False)
    data = (begin.cumsum() > end_.cumsum()) & ~begin & (lines.str.count(',') == 10)
    parts = lines.loc[data].str.split(',', expand=True)
    parts.columns = ['timestamp', 'from_bank', 'from_account', 'to_bank', 'to_account',
                     'amount_received', 'receiving_currency', 'amount_paid',
                     'payment_currency', 'payment_format', 'is_laundering']
    ts = pd.to_datetime(parts['timestamp'], format='%Y/%m/%d %H:%M')
    sk = parts['from_bank'].str.strip() + '_' + parts['from_account'].str.strip()
    dk = parts['to_bank'].str.strip() + '_' + parts['to_account'].str.strip()
    return pd.DataFrame({
        'ts_min': ts.to_numpy(dtype='datetime64[m]').astype(np.int64),
        'src_id': node_index.get_indexer(pd.Index(sk.to_numpy(dtype=object))).astype(np.int64),
        'dst_id': node_index.get_indexer(pd.Index(dk.to_numpy(dtype=object))).astype(np.int64),
        'cents': np.rint(parts['amount_paid'].astype('float64').to_numpy() * 100).astype(np.int64),
        'fmt_code': fmt_index.get_indexer(
            pd.Index(parts['payment_format'].str.strip().to_numpy(dtype=object))).astype(np.int64),
        'pattern': ptype.loc[data].str.strip().to_numpy(),
        'attempt_id': (begin.cumsum().loc[data] - 1).to_numpy().astype(np.int32),
    })


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--part-dir', default='/workspace/processed_9class/_nb_scratch/interim/HI-Large')
    ap.add_argument('--patterns', default='/workspace/IBM_AML_dataset/HI-Large_Patterns.txt')
    ap.add_argument('--windows', default=WINDOWS_DEFAULT)
    ap.add_argument('--degrees', default=DEGREES_DEFAULT)
    ap.add_argument('--out', default='/workspace/model_blocks_large/hub_window_grid')
    ap.add_argument('--tag', default='full')
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    pre = f'{a.tag}_'
    pd_dir = Path(a.part_dir)

    print(f'[시작] anon {anon_gib():.2f} GiB')
    print('[1/5] parquet 에서 양성 행·계좌 차수·전체 ts 적재')
    pos, deg, n_total, ts_all = load_positives(pd_dir)
    print(f'   전체 {n_total:,}행 · 양성 {len(pos):,}행 · 계좌 {len(deg):,} · '
          f'최대 차수 {deg.max():,} · anon {anon_gib():.2f} GiB')

    print('[2/5] 시간순 60/20/20 경계 (꼬리 절단 없음)')
    ts_s = np.sort(ts_all, kind='stable')
    t_val = int(ts_s[int(n_total * TRAIN_FRAC)])
    t_te = int(ts_s[int(n_total * (TRAIN_FRAC + VAL_FRAC))])
    del ts_s, ts_all
    print(f'   val 시작 {np.datetime64(0,"m") + np.timedelta64(t_val,"m")} · '
          f'test 시작 {np.datetime64(0,"m") + np.timedelta64(t_te,"m")} · '
          f'anon {anon_gib():.2f} GiB')

    print('[3/5] 패턴 정답지 매칭 (JOIN_KEYS)')
    node_index = pd.Index(pd.read_parquet(pd_dir / 'nodes.parquet')['key'].to_numpy(dtype=object))
    fmt_index = pd.Index(pd.read_parquet(pd_dir / 'fmt.parquet').iloc[:, 0].to_numpy(dtype=object))
    pat = parse_patterns(Path(a.patterns), node_index, fmt_index)
    n_bad = int(((pat['src_id'] < 0) | (pat['dst_id'] < 0) | (pat['fmt_code'] < 0)).sum())
    print(f'   패턴 거래 {len(pat):,} · 사건 {pat["attempt_id"].nunique():,} · 미등재 키 {n_bad}')

    left = pos.rename(columns={'ts_epoch_min': 'ts_min'})
    for c in JOIN_KEYS:
        left[c] = left[c].astype(np.int64)
    right = pat.drop_duplicates(JOIN_KEYS, keep='first')[JOIN_KEYS + ['pattern', 'attempt_id']]
    merged = left.merge(right, on=JOIN_KEYS, how='left', validate='m:1')
    has = merged['pattern'].notna().to_numpy()
    print(f'   양성 {len(merged):,} 중 패턴 매칭 {int(has.sum()):,} / '
          f'패턴외 {int((~has).sum()):,}  (main 실측: 매칭 113,663 / 패턴외 87,610)')

    att = merged['attempt_id'].fillna(-1).astype(np.int32).to_numpy()
    y9 = merged['pattern'].map(CLASS_MAP).fillna(8).astype(np.int8).to_numpy()
    src = merged['src_id'].to_numpy()
    dst = merged['dst_id'].to_numpy()
    ts = merged['ts_min'].to_numpy()

    print('[4/5] 채점 자격 산정 (완결 + 2건 이상 + 한 split 안에 포함)')
    sp = np.full(len(pat), 2, dtype=np.int8)
    sp[pat['ts_min'].to_numpy() < t_te] = 1
    sp[pat['ts_min'].to_numpy() < t_val] = 0
    g = pat.assign(split=sp).groupby('attempt_id').agg(
        n=('split', 'size'), s_min=('split', 'min'), s_max=('split', 'max'))
    # 절단이 없으므로 데이터에 남은 거래 수 = 정답지 선언 거래 수 → 정의상 전부 완결.
    g['contained'] = g['s_min'] == g['s_max']
    g['eligible'] = g['contained'] & (g['n'] >= 2)
    eligible = set(g.index[g['eligible']].astype(int).tolist())
    t = g.assign(split=g['s_min'].map(SPLIT_NAME)).groupby('split').agg(
        사건수=('n', 'size'), 채점자격=('eligible', 'sum'))
    print(t.reindex([SPLIT_NAME[i] for i in (0, 1, 2)]).to_string())
    print(f'   채점 자격 {len(eligible):,} / 사건 {len(g):,} '
          f'(main 실측 대비: 5,276 / 16,263)')

    print(f'\n[5/5] 격자 실행 · anon {anon_gib():.2f} GiB')
    Ws = [int(x) for x in a.windows.split(',')]
    Ds = [int(x) for x in a.degrees.split(',')]
    print(f'   창 {len(Ws)}개 × 차수 {len(Ds)}개 = {len(Ws)*len(Ds)}칸\n')

    rows = []
    for dth in Ds:
        excl = None if dth <= 0 else (deg >= dth)
        n_ex = 0 if excl is None else int(excl.sum())
        for w in Ws:
            t0 = time.time()
            comp = pb.link_components(src, dst, ts, w, exclude=excl)
            q = quality(comp, att, y9, eligible)
            per_type = q.pop('_per_type', {})
            per_type_el = q.pop('_per_type_elig', {})
            per_type_n = q.pop('_per_type_n', {})
            rec = dict(창분=w, 창일=round(w / 1440, 2), 임계차수=dth, 제외계좌수=n_ex,
                       제외계좌비율=round(n_ex / len(deg), 8),
                       하루내마감=bool(w <= 1440), 초=round(time.time() - t0, 1), **q)
            # 09-08: 이전 열 이름 `온전_` 은 자격 필터를 안 탄 값인데 출력에서는
            # "자격 온전율"이라고 표기하고 있었다. 분모를 열 이름에 박는다.
            rec.update({f'온전전체_{k}': v for k, v in per_type.items()})
            rec.update({f'온전자격_{k}': v for k, v in per_type_el.items()})
            rec.update({f'자격n_{k}': int(v) for k, v in per_type_n.items()})
            rows.append(rec)
            print(f"  W={w:>6}({w/1440:5.1f}일) 차수>={dth:>9,} | "
                  f"온전(자격) {q['진짜온전율_자격']*100:5.1f}% · 순도 {q['순도']*100:5.1f}% · "
                  f"1간선 {q['일간선블록비율']*100:5.1f}% · "
                  f"최대블록 {q['최대블록_사건수']:>5,}사건 · 블록 {q['블록수']:>7,}"
                  f"  ({rec['초']}s)", flush=True)
            del comp
        print()

    df = pd.DataFrame(rows)
    df.to_csv(out / f'{pre}grid.csv', index=False)

    base = df[df['임계차수'] == 0].sort_values('창분')
    print('■ 허브 제외 없이 창만 키울 때 (꼬리 안 자른 모집단)')
    print(f"{'창(일)':>8} {'하루내':>6} {'온전(자격)':>10} {'순도':>8} {'1간선':>8} "
          f"{'최대블록(사건)':>14} {'블록수':>9}")
    for _, rr in base.iterrows():
        print(f"{rr['창일']:>8.2f} {'O' if rr['하루내마감'] else 'X':>6} "
              f"{rr['진짜온전율_자격']*100:>9.1f}% {rr['순도']*100:>7.1f}% "
              f"{rr['일간선블록비율']*100:>7.1f}% {rr['최대블록_사건수']:>14,} {rr['블록수']:>9,}")
    peak = base.loc[base['진짜온전율_자격'].idxmax()]
    print(f"\n  자격 온전율 최대: W={peak['창분']}분({peak['창일']}일) — "
          f"{'격자 상한(후보 부족)' if peak['창분'] == max(Ws) else '격자 안에서 꺾임'}")

    day = df[df['하루내마감']]
    if len(day):
        bd = day.loc[day['진짜온전율_자격'].idxmax()]
        allb = df.loc[df['진짜온전율_자격'].idxmax()]
        print('\n■ 하루치 배치 전제 — 창 ≤ 1일 조합 중 최적')
        print(f"   W={bd['창분']}분({bd['창일']}일)·차수>={bd['임계차수']:,} → "
              f"온전(자격) {bd['진짜온전율_자격']*100:.1f}% · 순도 {bd['순도']*100:.1f}% · "
              f"최대블록 {bd['최대블록_사건수']:,}사건")
        print(f"   제약 없을 때 최적: W={allb['창분']}분({allb['창일']}일)·차수>={allb['임계차수']:,} → "
              f"온전(자격) {allb['진짜온전율_자격']*100:.1f}%")
        print(f"   → 하루 제약 대가 {(bd['진짜온전율_자격']-allb['진짜온전율_자격'])*100:+.1f}%p")

    print('\n■ "최대 블록 사건 수 ≤ N" 제약 하에서 자격 온전율 최대 조합')
    print(f"{'N':>8} {'창(일)':>8} {'차수임계':>11} {'제외계좌':>9} {'온전(자격)':>10} "
          f"{'순도':>8} {'1간선':>8} {'최대블록':>9}")
    best = []
    for N in (5, 10, 25, 50, 100, 250, 500, 1000, 10 ** 9):
        c = df[df['최대블록_사건수'] <= N]
        lbl = '제약없음' if N >= 10 ** 9 else str(N)
        if not len(c):
            print(f"{lbl:>8}   — 만족하는 조합 없음")
            continue
        r_ = c.loc[c['진짜온전율_자격'].idxmax()]
        best.append(dict(제약N=N, **{k: r_[k] for k in
                                   ('창분', '창일', '하루내마감', '임계차수', '제외계좌수',
                                    '진짜온전율_자격', '순도', '일간선블록비율',
                                    '최대블록_사건수', '블록수')}))
        print(f"{lbl:>8} {r_['창일']:>8.2f} {r_['임계차수']:>11,} {r_['제외계좌수']:>9,} "
              f"{r_['진짜온전율_자격']*100:>9.1f}% {r_['순도']*100:>7.1f}% "
              f"{r_['일간선블록비율']*100:>7.1f}% {r_['최대블록_사건수']:>9,}")
    pd.DataFrame(best).to_csv(out / f'{pre}best_under_constraint.csv', index=False)

    # BIPARTITE 는 main 격자에서 전 창 0.0 이었다. full 에서도 그런지 확인한다 —
    # 그렇다면 macro 기준식이 사실상 몇 개 클래스로만 굴러간다는 뜻이라 기준식 자체를 손대야 한다.
    tcols = [c for c in df.columns if c.startswith('온전자격_')]
    if tcols:
        b0 = df[df['임계차수'] == 0].sort_values('창분')
        print('\n■ 유형별 온전율 — **채점 자격 분모**(허브 제외 없음, 창별)')
        print('  ' + f"{'창(일)':>7} " + ' '.join(f"{c.replace('온전자격_',''):>10}" for c in tcols))
        for _, rr in b0.iterrows():
            print('  ' + f"{rr['창일']:>7.2f} " +
                  ' '.join(f"{rr[c]*100:>9.1f}%" if pd.notna(rr[c]) else f"{'—':>10}"
                           for c in tcols))
        dead = [c.replace('온전자격_', '') for c in tcols
                if (b0[c].fillna(0) == 0).all()]
        print(f"  → 전 창에서 0 인 유형: {dead if dead else '없음'}")

        # 대조군: 자격 필터를 안 탄 분모. 1건짜리 사건이 자동 성공으로 들어가므로
        # 유형 비교에 쓰면 안 된다. 두 표가 얼마나 다른지 눈으로 보라고 함께 낸다.
        ucols = [c.replace('온전자격_', '온전전체_') for c in tcols]
        if all(c in df.columns for c in ucols):
            print('\n■ (대조) 같은 값을 자격 필터 **없이** 잰 것 — 유형 비교에 쓰면 안 되는 표')
            print('  ' + f"{'창(일)':>7} " + ' '.join(f"{c.replace('온전전체_',''):>10}" for c in ucols))
            for _, rr in b0.iterrows():
                print('  ' + f"{rr['창일']:>7.2f} " +
                      ' '.join(f"{rr[c]*100:>9.1f}%" if pd.notna(rr[c]) else f"{'—':>10}"
                               for c in ucols))

    print(f'\n저장 → {out}/{pre}grid.csv · {pre}best_under_constraint.csv')
    print(f'[메모리] 종료 anon {anon_gib():.2f} GiB')


if __name__ == '__main__':
    main()
