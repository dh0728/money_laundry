# 그래프 신경망 기반 자금세탁 의심거래 탐지

인공지능사관학교 기업연계 프로젝트 — GNN(Graph Neural Network)을 활용해 금융 거래 그래프에서 자금세탁 의심거래를 탐지하는 팀 프로젝트입니다.

## 어디서 시작하나요

| 필요한 것 | 열 파일이나 화면 |
| --- | --- |
| 팀 검수 화면 | 저장소를 받은 뒤 Mac은 [현재 화면.command](AML%20RADAR%20현재%20화면.command), Windows는 [현재 화면.bat](AML%20RADAR%20현재%20화면.bat)을 실행합니다. Git, Node.js 22.12 이상, pnpm 11.24.0이 필요합니다. |
| 팀원이 프리뷰를 여는 방법 | [프리뷰 실행 안내](frontend/implementation/1.14.0/web-app/live-layout/README.md)에 터미널 명령과 화면별 주소가 있습니다. |
| 프리뷰 소스 | [현재 프리뷰 폴더](frontend/implementation/1.14.0/web-app/live-layout/)에서 화면과 컴포넌트 코드를 찾습니다. |
| 예전 화면 | [버전별 보존표](frontend/PRESERVATION.md)를 확인합니다. |
| 백엔드 연결에 필요한 정보 | [프론트엔드 인계](docs/frontend/implementation/frontend-handoff.md)와 [API 연결 요구사항](docs/frontend/implementation/api.md)을 엽니다. |
| 개발·운영 서버 설정 | [deploy](deploy/)에 환경별 설정과 배포 스크립트가 있습니다. |

## 팀 구성

| 이름 | 역할 |
|------|------|
| 송동현 | |
| 박지원 | |
| 김명기 | |
| 김태훈 | |
| 손은총 | |

## 폴더 구조

```
money_laundry/
├── frontend/                   # 프론트엔드와 보존 이력. README.md에서 버전별 위치 안내
│   ├── implementation/        # 구현 이력. 현재 코드는 1.14.0/web-app/
│   ├── prototype/             # 중간발표 전 프로토타입
│   ├── design/2.0.0/          # 10월 26일 새 디자인 시작 기록
│   └── recovery/              # 회수한 과거 산출물
├── backend/                    # 백엔드 API 서버
├── docs/                       # API 명세, 인계, 검증과 연구 문서
├── deploy/                     # 서버 환경과 배포 스크립트
└── AML RADAR 현재 화면.command / .bat   # Mac·Windows 5215 실행
```

## 데이터

- 출처: [IBM Transactions for Anti Money Laundering (Kaggle)](https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml)
- 용량이 커서 저장소에 포함하지 않습니다. 위 링크에서 받아 `data/` 폴더에 넣어주세요.
- **원천 데이터는 절대 수정하지 않습니다.** 전처리 결과는 별도 폴더에 저장합니다(구현 단계에서 규칙 확정).

## 브랜치 전략

```
master ← dev ← 작업별 브랜치
```

- **master**: 검수 통과된 배포용 코드만. 직접 커밋 금지.
- **dev**: 통합 개발 브랜치. 작업 브랜치를 PR로 병합.
- **작업별 브랜치**: 기능/작업 단위로 dev에서 분기해서 사용 (예: `docs`, `feature/eda`, `feature/gnn-model`)

### 브랜치 보호 규칙 (master·dev 공통)

> GitHub branch protection 설정 적용 예정. 설정 전에도 아래 규칙을 반드시 지킵니다.

- **직접 push 금지** — master·dev에는 커밋을 직접 올리지 않고, 반드시 PR로만 병합합니다.
- **PR 승인 1명 필수** — 본인 외 팀원 1명 이상의 리뷰 승인 후 병합합니다.
- **force push 금지** — `git push --force`는 모든 공유 브랜치에서 금지합니다.
- **브랜치 삭제 금지** — master·dev 브랜치는 삭제하지 않습니다.

### 작업 흐름

1. dev에서 새 브랜치 생성
2. 작업 후 커밋 & 푸시
3. dev로 Pull Request 생성
4. 팀원 리뷰 후 병합

## 커밋 메시지 규칙

커밋 메시지는 아래 형식으로 작성합니다.

```
Jira 이슈 키 [타입] 설명
```

예시:

```
MONEY17-77 [feat] 의심 거래 탐지 시 Alert 자동 생성 기능 추가
```

### 타입 목록

| 타입 | 설명 |
|------|------|
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서 수정 (코드 변경 없음) |
| `style` | 코드 포맷팅, 세미콜론 등 스타일 변경 (논리 변경 없음) |
| `refactor` | 리팩토링 (기능 변화 없음) |
| `test` | 테스트 관련 코드 추가/수정 |
| `chore` | 빌드, 패키지 매니저 설정 등 기타 작업 |
| `design` | CSS 등 사용자 UI 디자인 변경 |
| `comment` | 필요한 주석 추가 및 변경 |
| `rename` | 파일 혹은 폴더명을 수정하거나 옮기는 작업만 수행한 경우 |
| `remove` | 파일을 삭제하는 작업만 수행한 경우 |
| `!HOTFIX` | 긴급하게 치명적인 버그를 고쳐야 하는 경우 |
