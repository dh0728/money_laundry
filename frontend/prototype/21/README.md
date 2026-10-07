# AML RADAR · v21 Prototype

`AML-RADAR-v21.html`은 React, CSS, 아이콘, 그래프 fixture를 한 파일에 넣은 오프라인 실행 Prototype입니다. 브라우저에서 직접 열거나 아래 개발 명령으로 실행할 수 있습니다.

## v21 범위

- 기본 navigation: Dashboard → Transactions → Alerts → Episodes
- Transactions: 소유주·계좌·거래 ID를 별도 열로 확인하고, 소유주와 계좌를 접고 펼치는 계층 탐색. 기간·방향·상태·결제 수단 필터와 가로 스크롤을 제공하며 연결 Alert와 Episode를 별도 열에 표시
- 상세 ↔ Transactions: 거래의 송금 소유주와 연결 Alert/Episode를 기준으로 양방향 이동
- 전역 검색: 소유주·계좌·거래·Alert·Episode의 정확한 대상으로 이동
- 기관 전체 Dashboard: 하나의 연결형 기간 선택으로 유입·처리 추이, 세탁 거래 구성, 패턴별 분포를 함께 갱신. 초기화하면 전체 기간을 표시하며 차트는 기본 흰색·회색, hover 시 타임라인의 단일 인디케이터 선만 빨강으로 강조
- 재탐지 제안: 과거 종결 이력을 보존하면서 새 거래와 현재 Alert의 연결을 시각화
- Alert/Episode 상세, 관계 그래프, 조사 도우미, 알림·설정 등 v20 핵심 흐름 유지

## Prototype 데이터 경계

모든 업무 레코드, 담당자, 거래, 차트 추이, 재탐지 이력은 화면 검토용 mock입니다. 인증, 서버 저장, 모델 추론, 재탐지 backend 정책/API는 구현 또는 확정된 것으로 간주하지 않습니다. `src/data/graph-blocks.json`은 repository에 포함된 그래프 fixture이며 v21이 참조하는 별도 Media 파일은 없습니다.

이 경계 설명은 개발·검토 문서에만 둡니다. 실제 서비스 화면을 재현하는 애플리케이션 UI에는 `Prototype mock`, `Backend 정책/API 미확정`, `예시값`, `고대비` 같은 내부 검토 문구를 표시하지 않습니다.

그래프 fixture를 다시 만들 때는 repository root에서 다음처럼 실행합니다.

```bash
python3 frontend/prototype/21/scripts/extract-graph-blocks.py docs/02_data/세탁거래_그래프_시각화.html frontend/prototype/21/src/data/graph-blocks.json
```

## 실행과 검증

Node 22.12 이상에서:

```bash
npm ci
npm test
npm run lint
npm run build
npm run dev -- --port 5181
```

`npm run build`는 TypeScript 검사를 수행하고 `dist/index.html`을 만든 뒤 repository에 보존할 standalone 산출물 `AML-RADAR-v21.html`로 복사합니다.
