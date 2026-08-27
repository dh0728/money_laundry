# HI-Large Phase 2 — 파이프라인 청크화 기록 (2026-08-27)

명세: [hi_large_transition.md](hi_large_transition.md) §3. HI-Small 스크립트는
무수정 보존(과거 run 재현성), Large 는 신규 스크립트로 분리.

## 스크립트

| 파일 | 역할 |
|---|---|
| `scripts/prepare_hi_large.py` | 라벨 매칭(Pass A) + 파싱·vocab·USD 환산·일자 버킷(Pass B) + 일자 병합 시간 정렬(Pass C) → `data_work/HI-Large/trans_sorted.parquet` |
| `scripts/build_features_large.py` | features_v1 그래프 52개 — HI-Small 빌더의 청크 스트리밍 이식 |
| `scripts/verify_features_large.py` | 표본 행 브루트포스 재계산 대조 (인과성·이식 정확성) |

설계 결정:
- **정렬**: Phase 0 실측(역행 48%)에 따라 일자 버킷 → 일자 내 (tmin, orig_row)
  안정 정렬. 같은 분 내 순서 = 원본 파일 순서 (HI-Small stable sort 규약 동일).
- **라벨**: Patterns 라인 전수 고유(Phase 0)이므로 단순 dict 매칭. HI-Small 의
  occurrence 소비 로직 불필요.
- **스키마**: 정수 인코딩(u_id/v_id/cur/fmt) + USD 환산 + `amount_mismatch`·
  `same_bank` int8 (단건 피처 파생에 원시 비교가 필요 — USD 만으로 복원 불가).
- **빌더 메모리 재설계** (계좌별 파이썬 객체 → 계좌당 ~3KB × 213만 = ~6GB 불가):
  스칼라 상태 numpy 배열 / 24h·72h 윈도우 = 단일 이벤트 링 버퍼 + 이중 만료
  head + (계좌,상대,방향,윈도우) 단일 dict / recent_sent = NA×50 링 버퍼.
  피처 의미·순서는 HI-Small 빌더와 동일(검증으로 확인).

## 실측

### prepare (전체, 179,702,229행)
- 소요 20.3분 (Pass A 3.0 / B 15.5 / C 1.9), 산출 parquet **5.04GB**.
- 검증 전부 통과: 매칭 137,936 전수, flag1 225,546 = label>0, 클래스 분포가
  Patterns.txt 집계와 정확 일치, 전역 tmin 단조성 OK.
- accounts **2,116,168** (거래에 실제 등장 기준; accounts.csv 는 2,126,855).
- 고유 방향 엣지 **8,466,789** (별도 np.unique 실측 48초) → edge dict ~1GB.

### 빌더 드라이런 (앞 10M행 파이프라인)
- 210표본(무작위 150+세탁 40+자기거래 20) × 52피처 브루트포스 **전부 일치**
  (rtol/atol 1e-4).
- 링 리팩터 전 피크 RSS 5.4GB → 후 **4.1GB**, 속도 19→24~38k rows/s (7.0분).
- 타임스탬프 단위 버그 1건 검출·수정: pandas 3.0 `to_datetime` 이 datetime64[s]
  반환 → ns 가정 나눗셈이 전부 0. `datetime64[s]` 명시 캐스팅 + 범위 가드 추가.

### 빌더 전체 실행
- (진행 중 — 완료 후 덧붙임. 예상: 피크 ~5.0-5.5GB, 1.7~2.5h)
