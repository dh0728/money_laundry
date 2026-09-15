#!/usr/bin/env python3
"""모델 패밀리 비교 집계 — 2026-09-04.

08-27 비교는 거친 K 격자 · 시드 1개 · random_r300 표본이었다. 여기서는 정수 격자 · 시드 3벌 · full 표본으로
다시 재고, **시드 편차보다 큰 차이만 결론으로 인정한다.**
"""
from __future__ import annotations

import glob
from pathlib import Path

import pandas as pd

FAM = Path('/workspace/model_feature_reduce/family')
OLD = {'hier_et': 0.1278, 'hier_xgb': 0.0934, 'hier_lgbm': None}   # 08-27 macro PR-AUC(거친 격자)


KEY = ['패밀리', '라운드', '시드', '구성', '피처수', '표본']


def main() -> None:
    # 09-08 수정: 이전 글롭 `_s*_fam_*.csv` 는 A1 재검증이 남긴 `_s*_a1_*.csv` 를 통째로 놓쳐
    # LGBM400 이 시드 3벌 중 1벌(s42)만 집계됐다. 글롭을 넓히되, 넓힌 만큼 **다른 실험이
    # 섞여 들어오므로**(HI-Large `_large_*`, test `_te_te_*`) 파일명이 아니라 CSV 가 스스로
    # 적어 둔 `데이터`·`split` 열로 거른다. s42 는 `_fam_` 과 `_a1_` 양쪽에 있어 중복 제거도 필요하다.
    fs = sorted(f for f in glob.glob(str(FAM / 'feature_reduce_combo_et_s*_*.csv')))
    if not fs:
        print('집계할 결과가 없다.')
        return
    df = pd.concat([pd.read_csv(f) for f in fs], ignore_index=True)
    df = df[~df['구성'].isna()].copy()
    if '패밀리' not in df.columns:
        print('패밀리 열이 없다 — 구버전 CSV 가 섞였다.')
        return

    n0 = len(df)
    df = df[(df['데이터'] == 'HI-Small') & (df['split'] == 'va')].copy()
    n1 = len(df)
    df = df.drop_duplicates(subset=KEY, keep='first').copy()
    print(f'· 파일 {len(fs)}개 / 행 {n0} → 범위(HI-Small·va) {n1} → 중복 제거 {len(df)}')
    print('  제외: HI-Large 행, test(te) 행, 같은 설정의 재실행 중복. 이 표는 HI-Small val 전용이다.\n')

    r200 = df[df['라운드'] == 200]
    print('■ 머리 맞대기 — 라운드 200 고정, HI-Small val, A 76피처, full 표본, 정수 격자\n')
    g = (r200.groupby('패밀리')
              .agg(시드수=('시드', 'nunique'),
                   P_평균=('val_P_R70', 'mean'), P_편차=('val_P_R70', 'std'),
                   P_최소=('val_P_R70', 'min'), P_최대=('val_P_R70', 'max'),
                   K_평균=('val_K_R70', 'mean'),
                   macroPR_평균=('val_macro_prauc8', 'mean'),
                   학습초_평균=('학습초', 'mean'))
              .reset_index().sort_values('P_평균', ascending=False))
    print('| 패밀리 | 시드 | val P@R70 평균 | 편차 | 최소~최대 | K 평균 | macro PR-AUC | 학습(초) |')
    print('|---|---|---|---|---|---|---|---|')
    for _, r in g.iterrows():
        sd = 0.0 if pd.isna(r['P_편차']) else r['P_편차']
        print(f"| {r['패밀리']} | {int(r['시드수'])} | **{r['P_평균']:.4f}** | {sd:.4f} | "
              f"{r['P_최소']:.4f}~{r['P_최대']:.4f} | {r['K_평균']:.0f} | "
              f"{r['macroPR_평균']:.4f} | {r['학습초_평균']:.0f} |")

    # 판정 — 1위와 2위 격차가 편차보다 큰가
    if len(g) >= 2:
        a, b = g.iloc[0], g.iloc[1]
        gap = a['P_평균'] - b['P_평균']
        pooled = max(float(a['P_편차'] or 0), float(b['P_편차'] or 0))
        verdict = ('**격차가 시드 편차보다 크다 → 실제 차이로 볼 수 있다**' if gap > pooled
                   else '격차가 시드 편차 안에 있다 → **동급으로 봐야 한다**')
        print(f"\n1위 {a['패밀리']} - 2위 {b['패밀리']} = {gap:+.4f} · 시드 편차 최대 {pooled:.4f}\n→ {verdict}")

    # 시드별 원자료 — 순위가 시드마다 뒤집히는지
    piv = r200.pivot_table(index='시드', columns='패밀리', values='val_P_R70')
    print('\n■ 시드별 원자료 (순위가 뒤집히면 결론을 못 낸다)')
    print(piv.round(4).to_string())
    if len(piv) > 1:
        wins = piv.idxmax(axis=1).value_counts()
        print('시드별 1위:', dict(wins))

    # 라운드 민감도
    other = df[df['라운드'] != 200]
    if len(other):
        # 09-08: 글롭 수정으로 r400 이 시드 3벌 다 들어왔다. 원래 이 표는 시드 42 전용이라
        # 시드 열이 없었는데, 이제 같은 라운드가 여러 줄이 되므로 시드를 반드시 병기한다.
        print('\n■ 라운드 민감도 — "200 이 ET 에만 유리한 값인가?" 확인 (r200 은 시드 42 기준)')
        print('| 패밀리 | 라운드 | 시드 | val P@R70 | K | macro PR-AUC | 학습(초) |')
        print('|---|---|---|---|---|---|---|')
        for _, r in (pd.concat([r200[r200['시드'] == 42], other])
                     .sort_values(['패밀리', '라운드', '시드']).iterrows()):
            print(f"| {r['패밀리']} | {int(r['라운드'])} | {int(r['시드'])} | {r['val_P_R70']:.4f} | "
                  f"{int(r['val_K_R70'])} | {r['val_macro_prauc8']:.4f} | {r['학습초']:.0f} |")

        # 라운드별 시드 3벌이 모인 설정은 평균·편차로도 요약한다(단일 시드 인용 방지).
        multi = (other.groupby(['패밀리', '라운드'])['val_P_R70']
                      .agg(시드수='count', 평균='mean', 편차='std').reset_index())
        multi = multi[multi['시드수'] >= 2]
        if len(multi):
            print('\n  └ 시드 2벌 이상 모인 설정:')
            for _, r in multi.iterrows():
                print(f"     {r['패밀리']} r{int(r['라운드'])}: 시드 {int(r['시드수'])}벌 "
                      f"평균 {r['평균']:.4f} · 편차 {r['편차']:.4f}")

    print('\n■ 08-27 비교와의 차이')
    print('08-27 은 거친 K 격자 · 시드 1개 · random_r300 표본이었다(hier_et 0.1278 vs hier_xgb 0.0934, macro PR-AUC).')
    print('여기는 정수 격자 · 시드 3벌 · full 표본이다. **두 표를 직접 비교하지 말 것.**')
    df.to_csv(FAM / 'family_summary.csv', index=False)
    print(f'\n저장 → {FAM / "family_summary.csv"}')


if __name__ == '__main__':
    main()
