# 그래프 신경망 기반 자금세탁 의심거래 탐지

인공지능사관학교 기업연계 프로젝트 — GNN(Graph Neural Network)을 활용해 금융 거래 그래프에서 자금세탁 의심거래를 탐지하는 팀 프로젝트입니다.

## 팀 구성

| 이름 | 역할 |
|------|------|
| (작성 예정) | |
| (작성 예정) | |
| (작성 예정) | |
| (작성 예정) | |

## 폴더 구조

```
AML/
├── data/               # IBM AML 원천 데이터 (Git에 올리지 않음 — 아래 '데이터' 참고)
├── docs/
│   ├── 01_research/    # 자료조사 (AML 도메인, GNN 논문/사례)
│   ├── 02_data/        # 데이터 명세, EDA 결과
│   ├── 03_planning/    # 기획 (요구사항 정의서, 유즈케이스)
│   ├── 04_design/      # 설계 (아키텍처, 모델, 화면)
│   └── meetings/       # 회의록
└── README.md
```

구현 단계에 들어가면 `src/`, `notebooks/` 등을 그때 추가합니다.

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

### 작업 흐름

1. dev에서 새 브랜치 생성
2. 작업 후 커밋 & 푸시
3. dev로 Pull Request 생성
4. 팀원 리뷰 후 병합
