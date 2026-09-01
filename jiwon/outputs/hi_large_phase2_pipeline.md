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

### 빌더 전체 실행 (완료)
- 소요 **236.5분**(12~13k rows/s — 실데이터 밀도로 드라이런 대비 저하),
  산출 `features_v1.parquet` **19.2GB** (orig_row·tmin·label·attempt_id + 52 float32).
- 피크 RSS **7.8GB** — 드라이런 외삽(5.0~5.5GB)을 상회(dict 리사이즈·writer 버퍼·
  단편화 추정). 시스템 여유 부족으로 후반 가벼운 스왑(0.85GB) 발생, 속도 저하만
  있었고 완주. **교훈: 다음 대형 실행은 예측치 +40% 여유를 확보할 것.**
- 검증 전부 통과:
  - prefix 브루트포스(정렬 앞 10M행 내 표본 210 × 52피처) 전부 일치
  - 전 행 구조 검사: features/trans 행 수 일치(179,702,229), orig_row 전 행
    정합, 52피처 전부 유한(NaN/Inf 0)

## 확정 분할 기준 클래스 분포 (행 단위 실측)

경계: train < 09-24 ≤ val < 10-15 ≤ test < 11-06 ≤ 꼬리(원장).

| class | train | val | test | tail |
|---|---|---|---|---|
| NORMAL | 100,745,494 | 39,124,372 | 39,590,371 | 16,446 |
| FAN-OUT | 5,213 | 2,814 | 3,356 | 2,171 |
| FAN-IN | 5,340 | 2,978 | 3,006 | 1,963 |
| GATHER-SCATTER | 7,033 | 5,539 | 6,063 | 7,726 |
| SCATTER-GATHER | 10,456 | 5,711 | 6,157 | 4,654 |
| CYCLE | 5,138 | 2,622 | 2,792 | 1,788 |
| RANDOM | 4,205 | 2,115 | 2,136 | 1,162 |
| BIPARTITE | 5,574 | 2,522 | 2,878 | 1,200 |
| STACK | 9,139 | 5,513 | 5,363 | 3,609 |
| NONPAT | 45,061 | 20,136 | 22,413 | **0** |
| 합계 | 100,842,653 | 39,174,322 | 39,644,535 | 40,719 |
| 세탁(1~9) | 97,159 | 49,950 | 54,164 | 24,273 |
| 세탁 비율 | 0.0963% | 0.1275% | 0.1366% | 59.61% |

- 꼬리 NONPAT=0 — 꼬리 세탁은 전부 패턴 거래(Phase 0 관찰과 일치, 걸침 블록 완결부).
- 세탁 비율이 train→test 로 완만히 상승(0.096→0.137%) — 머리 warm-up 램프의 잔재.
- val/test 패턴 클래스 행 수 2.1k~6.2k — HI-Small val(클래스당 수십~수백 행)의
  수십 배. 클래스별 일반화 평가 성립(전환의 결정 목적 달성).
- train NORMAL 100.7M — 다운샘플링 없이는 학습 불가(61피처 float32 기준 전량
  ~25GB). 다운샘플 비율·기법은 후속 논의(보류 중).

## 상태

Phase 2 완료. 후속(보류): NORMAL 다운샘플링 기법 논의 → 학습·평가 스크립트
청크화(run_101 기준선) → 평가 계약 이식(Phase 3).
