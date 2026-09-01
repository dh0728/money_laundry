# AML 논문 자료 목차

## 1. 문서 목적

이 문서는 `docs/01_research/donghyeon`에 정리된 논문을 프로젝트 관점에서 빠르게 찾아보기 위한 목차다.

논문은 다음 기획 방향과의 관련성을 기준으로 정리했다.

- IBM 합성 데이터의 패턴 및 라벨 품질 재검토
- 패턴 내·외 자금세탁과 단건 자금세탁 거래의 구분
- 1단계 정상/자금세탁 탐지와 2단계 자금세탁 패턴 분류 구조
- 계좌·거래·서브그래프 단위 피처 설계
- 시간 순서가 보존된 학습 및 평가
- 불균형 데이터에서 Recall, Precision, PR-AUC와 Alert 수 평가
- 여러 금융기관의 거래 관계를 분석하는 AML 분석 플랫폼
- 담당자에게 개별 Alert의 판정 근거를 제공하는 설명 가능한 모델

각 폴더 안의 논문은 **현재 프로젝트와 직접 관련성이 높은 순서**로 배치했다. 번역본은 빠른 이해에 사용하고, 라벨 정의·수식·실험 조건·표의 수치는 원본 PDF로 다시 확인하는 것을 권장한다.

---

## 2. 전체 추천 읽기 순서

모든 논문을 처음부터 정독하기보다는 다음 순서로 핵심 논문부터 확인한다.

| 순서 | 논문 | 먼저 확인할 이유 |
|---:|---|---|
| 1 | Network Analytics for Anti-Money Laundering | AML 네트워크 분석 연구 전체의 분류와 흐름 파악 |
| 2 | Realistic Synthetic Financial Transactions for AML Models | 현재 사용하는 IBM 데이터의 생성 과정과 라벨 의미 확인 |
| 3 | TransXion | 템플릿 기반 합성 데이터와 생성기 흔적의 문제 검토 |
| 4 | Anomaly Detection: A Survey | 단건·맥락·집단 이상치의 차이 정리 |
| 5 | Graph Feature Preprocessor | IBM 데이터에서 추출할 시간·그래프 피처 설계 |
| 6 | Time-aware and Interpretable AML Monitoring | 시간 분할, Alert 평가 및 개별 판정 설명 기준 설계 |
| 7 | AMAP | 1단계 의심 거래 탐지 후 주변 서브네트워크를 찾는 2단계 구조 이해 |
| 8 | The Shape of Money Laundering | AML을 개별 거래가 아닌 서브그래프 패턴으로 보는 근거 확인 |
| 9 | Project Aurora | 여러 금융기관을 연결하는 분석 플랫폼 기획 근거 확인 |

---

## 3. IBM 데이터와 연결되는 후속 논문

폴더:

`docs/01_research/donghyeon/IBM데이터_연결되는_후속논문`

현재 진행 중인 **IBM 합성 데이터 패턴·라벨 품질 검토와 피처 설계**에 가장 직접적으로 관련된 폴더다.

### 3.1 Realistic Synthetic Financial Transactions for Anti-Money Laundering Models

- 간단한 설명: 현재 사용하는 IBM AML 합성 데이터와 AMLworld 생성기를 소개한 공식 논문이다. 정상 거래, 표준 AML 패턴, 합성 데이터 생성 방식과 모델 실험을 설명한다.
- 기획 관점에서 중요한 이유: `Patterns`와 `Is Laundering`의 관계, 8개 표준 패턴, 패턴 외 자금세탁, HI/LI 데이터의 의미를 해석하는 기준점이다. 단건 거래나 자기거래가 왜 만들어졌는지 확인할 때 가장 먼저 봐야 한다.
- 원본 PDF: `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/Realistic Synthetic Financial Transactions for Anti-Money Laundering Models.pdf`
- 번역본: [번역본 바로가기](<IBM데이터_연결되는_후속논문/번역본/Realistic Synthetic Financial Transactions for Anti-Money Laundering Models_번역본.md>) — `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/번역본/Realistic Synthetic Financial Transactions for Anti-Money Laundering Models_번역본.md`

### 3.2 TransXion: A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering

- 간단한 설명: 정상 활동에는 개체 프로필을 반영하고, 불법 거래에는 고정 템플릿이 아닌 확률적 서브그래프를 사용하는 최신 AML 그래프 벤치마크다.
- 기획 관점에서 중요한 이유: 기존 합성 데이터가 고정 패턴이나 식별자 흔적 때문에 실제보다 쉽게 분류될 수 있다는 문제를 검토한다. IBM 단건 거래 모델의 성능이 실제 의미를 학습한 것인지 생성기를 외운 것인지 판단하는 비교 기준이다.
- 원본 PDF: `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering.pdf`
- 번역본: [번역본 바로가기](<IBM데이터_연결되는_후속논문/번역본/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering_번역본.md>) — `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/번역본/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering_번역본.md`
- 중복 안내: 같은 논문이 `최신동향` 폴더에도 보관되어 있다. 한 버전만 읽으면 된다.

### 3.3 Graph Feature Preprocessor: Real-time Subgraph-based Feature Extraction for Financial Crime Detection

- 간단한 설명: 거래 스트림에서 과거 그래프를 유지하면서 fan-in, fan-out, cycle, scatter-gather 등의 서브그래프 피처를 실시간으로 추출하는 방법을 제안한다.
- 기획 관점에서 중요한 이유: GNN을 바로 사용하지 않고도 시간·관계 피처와 LightGBM/XGBoost 같은 기준 모델을 결합할 수 있다. 현재 EDA에서 어떤 피처를 추출해야 하는지 가장 구체적으로 보여준다.
- 원본 PDF: `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/Graph Feature Preprocessor-Real-time Subgraph-based Feature Extraction for Financial Crime Detection.pdf`
- 번역본: [번역본 바로가기](<IBM데이터_연결되는_후속논문/번역본/Graph Feature Preprocessor-Real-time Subgraph-based Feature Extraction for Financial Crime Detection_번역본.md>) — `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/번역본/Graph Feature Preprocessor-Real-time Subgraph-based Feature Extraction for Financial Crime Detection_번역본.md`

### 3.4 Provably Powerful Graph Neural Networks for Directed Multigraphs

- 간단한 설명: 방향이 있고 같은 노드 사이에 여러 엣지가 존재하는 다중 그래프를 표준 GNN보다 잘 구분하도록 개선한 Multi-GNN 연구다.
- 기획 관점에서 중요한 이유: 금융 거래는 방향, 반복 송금, 병렬 엣지가 중요하다. 동일 계좌쌍의 반대 방향 거래나 반복 거래를 하나로 합치면 어떤 정보가 사라지는지 판단하는 근거가 된다.
- 원본 PDF: `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/Provably Powerful Graph Neural Networks for Directed Multigraphs.pdf`
- 번역본: [번역본 바로가기](<IBM데이터_연결되는_후속논문/번역본/Provably Powerful Graph Neural Networks for Directed Multigraphs_번역본.md>) — `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/번역본/Provably Powerful Graph Neural Networks for Directed Multigraphs_번역본.md`

### 3.5 Advances in Continual Graph Learning for Anti-Money Laundering Systems

- 간단한 설명: 시간이 지나면서 자금세탁 수법과 데이터 분포가 변할 때 기존 지식을 유지하면서 새 패턴을 학습하는 지속적 그래프 학습을 정리하고 실험한다.
- 기획 관점에서 중요한 이유: 무작위 분할이 아니라 기간을 분리해 평가해야 하는 이유와, 새로운 패턴을 학습하면서 이전 패턴을 잊는 문제를 장기 확장 관점에서 이해할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/Advances in Continual Graph Learning for Anti-Money Laundering Systems-A Comprehensive Review.pdf`
- 번역본: [번역본 바로가기](<IBM데이터_연결되는_후속논문/번역본/Advances in Continual Graph Learning for Anti-Money Laundering Systems-A Comprehensive Review_번역본.md>) — `docs/01_research/donghyeon/IBM데이터_연결되는_후속논문/번역본/Advances in Continual Graph Learning for Anti-Money Laundering Systems-A Comprehensive Review_번역본.md`
- 중복 안내: 축약된 이름의 같은 논문이 `최신동향` 폴더에도 보관되어 있다.

---

## 4. 최신 동향

폴더:

`docs/01_research/donghyeon/최신동향`

AML 연구의 전체 지도, 실제 운영 평가, 기관 간 분석, 이종 그래프와 시간 변화 등 프로젝트의 확장 방향을 확인하는 폴더다.

### 4.1 Network Analytics for Anti-Money Laundering: A Systematic Literature Review and Experimental Evaluation

- 간단한 설명: AML 네트워크 분석 관련 97개 연구를 분류하고, 수작업 그래프 피처·랜덤워크·GNN 등을 동일한 실험 환경에서 비교한 체계적 문헌고찰이다.
- 기획 관점에서 중요한 이유: 거래·계좌·고객·커뮤니티 중 어떤 단위로 탐지할 수 있는지 전체 지도를 제공한다. 다른 논문을 읽기 전에 연구 방향과 용어를 정리하기 좋다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/Network Analytics for Anti-Money Laundering -- A Systematic Literature Revi...pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/Network Analytics for Anti-Money Laundering -- A Systematic Literature Revi.._번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/Network Analytics for Anti-Money Laundering -- A Systematic Literature Revi.._번역본.md`

### 4.2 Time-aware and Interpretable Predictive Monitoring System for Anti-Money Laundering

- 간단한 설명: 시간에 따라 반복 실행되는 AML 모니터링에서 정확하고 중복되지 않으며 적시에 발생하는 Alert와 설명을 제공하는 시스템을 제안한다.
- 기획 관점에서 중요한 이유: 거래 단위 Precision, 계좌·고객 단위 Recall, 중복 Alert, 탐지 시점과 담당자 처리량을 함께 평가해야 한다는 근거가 된다. 임계값 설계와 설명 가능한 Alert 기획에 직접 사용할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/Time-aware and interpretable predictive monitoring system for Anti-Money Laundering.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/Time-aware and interpretable predictive monitoring system for Anti-Money Laundering_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/Time-aware and interpretable predictive monitoring system for Anti-Money Laundering_번역본.md`

### 4.3 Project Aurora

- 간단한 설명: 개인정보 보호 기술, 머신러닝, 네트워크 분석을 이용해 여러 기관과 국경을 넘는 거래를 공동 분석한 BIS의 AML 프로젝트다.
- 기획 관점에서 중요한 이유: 프로젝트를 개별 은행용 탐지 시스템이 아니라 여러 금융기관의 거래 관계를 분석하는 플랫폼으로 설정하는 가장 직접적인 근거다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/Project Aurora.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/Project Aurora_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/Project Aurora_번역본.md`

### 4.4 Finding Money Launderers Using Heterogeneous Graph Neural Networks

- 간단한 설명: 실제 은행의 거래 및 사업 관계 데이터를 고객·계좌·사업 관계 등 서로 다른 노드와 엣지 타입을 가진 이종 그래프로 구성해 자금세탁자를 탐지한다.
- 기획 관점에서 중요한 이유: 현재는 거래와 계좌 중심으로 시작하더라도 향후 고객, 기업, 소유 관계와 기관 정보를 추가할 수 있도록 표준 스키마를 확장해야 하는 이유를 보여준다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/Finding money launderers using heterogeneous graph.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/Finding money launderers using heterogeneous graph_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/Finding money launderers using heterogeneous graph_번역본.md`
- 중복 안내: 같은 연구의 별도 한국어 번역이 `graph/이종_그래프_신경망_AML_한국어_번역.md`에도 있다.

### 4.5 A Comprehensive Survey on Graph Anomaly Detection with Deep Learning

- 간단한 설명: 딥러닝 기반 그래프 이상 탐지를 노드·엣지·서브그래프·전체 그래프 수준으로 분류하고 주요 모델과 과제를 정리한 조사 논문이다.
- 기획 관점에서 중요한 이유: 거래 단위 탐지와 서브그래프 패턴 탐지를 서로 다른 문제로 정의하고, 향후 GNN 모델 후보를 고를 때 참고할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/A Comprehensive Survey on Graph Anomaly Detection with Deep Learning.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/A Comprehensive Survey on Graph Anomaly Detection with Deep Learning_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/A Comprehensive Survey on Graph Anomaly Detection with Deep Learning_번역본.md`

### 4.6 Advances in Continual Graph Learning for Anti-Money Laundering

- 간단한 설명: 시간에 따른 분포와 패턴 변화에 대응하는 지속적 그래프 학습 연구다.
- 기획 관점에서 중요한 이유: 기간을 분리한 평가와 모델 재학습·업데이트 정책을 설계할 때 참고한다. 현재 MVP보다는 후속 확장에 가깝다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/ADVANCES IN CONTINUAL GRAPH LEARNING FOR ANTI-MONEY.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/ADVANCES IN CONTINUAL GRAPH LEARNING FOR ANTI-MONEY_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/ADVANCES IN CONTINUAL GRAPH LEARNING FOR ANTI-MONEY_번역본.md`
- 중복 안내: `IBM데이터_연결되는_후속논문` 폴더에 전체 제목으로 같은 논문이 보관되어 있다.

### 4.7 TransXion

- 간단한 설명: 프로필 기반 정상 거래와 비정형 불법 서브그래프를 생성하는 최신 합성 AML 벤치마크다.
- 기획 관점에서 중요한 이유: IBM 합성 데이터 라벨과 패턴을 비판적으로 평가하는 외부 기준이다.
- 원본 PDF: `docs/01_research/donghyeon/최신동향/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering.pdf`
- 번역본: [번역본 바로가기](<최신동향/번역본/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering_번역본.md>) — `docs/01_research/donghyeon/최신동향/번역본/TransXion-A High-Fidelity Graph Benchmark for Realistic Anti-Money Laundering_번역본.md`
- 중복 안내: `IBM데이터_연결되는_후속논문` 폴더에도 같은 파일이 있다. 해당 폴더의 버전을 우선 사용한다.

---

## 5. 이상거래 탐지 기초

폴더:

`docs/01_research/donghyeon/이상거래탐지`

단건 자금세탁을 어떤 종류의 이상치로 정의할지, 불균형 데이터를 어떻게 평가할지, 모델의 판정 근거를 어떻게 설명할지 정리하는 폴더다.

### 5.1 Anomaly Detection: A Survey

- 간단한 설명: 이상 탐지 문제를 입력 데이터, 라벨 유무, 출력 방식과 point·contextual·collective anomaly 등으로 체계화한 대표적인 조사 논문이다.
- 기획 관점에서 중요한 이유: 단건 거래 자체가 이상한지, 계좌의 과거 행동과 비교해야 이상한지, 여러 거래가 모여야 이상한지를 구분하는 이론적 기준을 제공한다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/Anomaly_detection_A_survey.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/Anomaly_detection_A_survey_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/Anomaly_detection_A_survey_번역본.md`

### 5.2 Graph-based Anomaly Detection and Description: A Survey

- 간단한 설명: 그래프에서 발생하는 노드·엣지·서브그래프 이상과 정적·동적 그래프 탐지 방법을 정리한다.
- 기획 관점에서 중요한 이유: 1단계 거래 탐지와 2단계 패턴 탐지를 서로 다른 탐지 단위로 정의하는 근거다. 허브 계좌와 고립 거래를 바로 제거하지 않고 구조적 맥락을 분석해야 하는 이유도 설명할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/Graph-based Anomaly Detection and Description-A Survey.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/Graph-based Anomaly Detection and Description-A Survey_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/Graph-based Anomaly Detection and Description-A Survey_번역본.md`

### 5.3 The Precision-Recall Plot Is More Informative than the ROC Plot on Imbalanced Datasets

- 간단한 설명: 양성 클래스가 매우 적은 불균형 데이터에서 ROC 곡선보다 Precision-Recall 곡선이 실제 양성 예측 성능을 더 잘 보여줄 수 있음을 설명한다.
- 기획 관점에서 중요한 이유: AML에서 Accuracy나 ROC-AUC만으로 성능을 판단하지 않고 PR-AUC, Recall, Precision과 Alert 수를 함께 봐야 하는 근거다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/The Precision-Recall Plot Is More Informative...pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/The Precision-Recall Plot Is More Informative..._번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/The Precision-Recall Plot Is More Informative..._번역본.md`

### 5.4 The Relationship Between Precision-Recall and ROC Curves

- 간단한 설명: ROC 공간과 PR 공간의 관계와 불균형 데이터에서 두 곡선이 다르게 보이는 이유를 이론적으로 설명한다.
- 기획 관점에서 중요한 이유: 기준 모델을 비교할 때 ROC-AUC와 PR-AUC가 서로 다른 결론을 줄 수 있음을 이해하고 평가 지표를 명확히 선정할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/The Relationship Between Precision-Recall and ROC Curves.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/The Relationship Between Precision-Recall and ROC Curves_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/The Relationship Between Precision-Recall and ROC Curves_번역본.md`

### 5.5 A Unified Approach to Interpreting Model Predictions

- 간단한 설명: 개별 예측에 대한 피처별 기여도를 계산하는 SHAP 방법을 제안한 논문이다.
- 기획 관점에서 중요한 이유: 전체 모델의 Feature Importance와 개별 의심 거래가 탐지된 이유를 구분해 담당자에게 제공하는 설명 계층의 근거가 된다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/A Unified Approach to Interpreting Model.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/A Unified Approach to Interpreting Model_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/A Unified Approach to Interpreting Model_번역본.md`

### 5.6 Statistical Fraud Detection: A Review

- 간단한 설명: 통계와 머신러닝을 이용한 사기 탐지의 초기 방법과 적용 분야를 정리한 대표적인 기초 논문이다.
- 기획 관점에서 중요한 이유: 범죄자가 고정된 탐지 규칙에 적응한다는 점과, 예방 시스템 외에도 지속적인 탐지 시스템이 필요한 이유를 프로젝트 배경으로 설명할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/Bolton_Hand_Statistical Fraud Detection- A Review_2002.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/Bolton_Hand_Statistical Fraud Detection- A Review_2002_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/Bolton_Hand_Statistical Fraud Detection- A Review_2002_번역본.md`

### 5.7 LOF: Identifying Density-Based Local Outliers

- 간단한 설명: 전체 데이터 분포가 아니라 주변 이웃의 밀도와 비교해 지역적 이상치 점수를 계산하는 비지도 이상 탐지 방법이다.
- 기획 관점에서 중요한 이유: 단건 거래를 전체 금액 분포로만 비교하지 않고, 해당 계좌 또는 유사 계좌의 평소 행동과 비교하는 기준 모델 아이디어로 사용할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/이상거래탐지/LOF-Identifying Density-Based Local Outliers.pdf`
- 번역본: [번역본 바로가기](<이상거래탐지/번역본/LOF-Identifying Density-Based Local Outliers_번역본.md>) — `docs/01_research/donghyeon/이상거래탐지/번역본/LOF-Identifying Density-Based Local Outliers_번역본.md`

---

## 6. 2단계 구조와 연결되는 서브그래프 연구

폴더:

`docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구`

1단계에서 의심 거래를 선별하고 2단계에서 주변 관계와 패턴을 분석하는 팀의 모델 구조에 직접 연결되는 폴더다.

### 6.1 Towards Learning to Discover Money Laundering Sub-network in Massive Transaction Network

- 간단한 설명: 대규모 거래망에서 자금세탁 거래를 탐지하고, 해당 거래 주변의 자금세탁 서브네트워크까지 학습으로 발견하는 AMAP 구조를 제안한다.
- 기획 관점에서 중요한 이유: 현재 기획한 `1단계 이진분류 → 2단계 패턴 분석` 구조와 가장 유사하다. 실제 평가에서는 정답 거래를 시작점으로 주는 경우와 1단계 예측 결과를 시작점으로 주는 경우를 분리해야 한다는 아이디어를 얻을 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/Towards Learning to Discover Money Laundering Sub-network in Massive Transaction Network.pdf`
- 번역본: [번역본 바로가기](<2단계_구조와_연결되는_서브그래프_연구/번역본/Towards Learning to Discover Money Laundering Sub-network in Massive Transaction Network_번역본.md>) — `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/번역본/Towards Learning to Discover Money Laundering Sub-network in Massive Transaction Network_번역본.md`

### 6.2 The Shape of Money Laundering: Subgraph Representation Learning with the Elliptic2 Dataset

- 간단한 설명: AML을 개별 노드나 거래가 아니라 여러 거래와 개체가 만든 서브그래프의 형태를 분류하는 문제로 정의하고 Elliptic2 데이터셋을 제시한다.
- 기획 관점에서 중요한 이유: 자금세탁 패턴을 개별 거래의 다중 클래스 문제가 아니라 서브그래프 단위 문제로 볼 수 있다는 근거다. 단건 거래가 정말 패턴 분류 대상인지도 다시 검토할 수 있다.
- 원본 PDF: `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/The Shape of Money Laundering-Subgraph Representation Learning on the Blockchain with the Elliptic2 Dataset.pdf`
- 번역본: [번역본 바로가기](<2단계_구조와_연결되는_서브그래프_연구/번역본/The Shape of Money Laundering-Subgraph Representation Learning on the Blockchain with the Elliptic2 Dataset_번역본.md>) — `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/번역본/The Shape of Money Laundering-Subgraph Representation Learning on the Blockchain with the Elliptic2 Dataset_번역본.md`

### 6.3 Identifying Money Laundering Subgraphs on the Blockchain

- 간단한 설명: 서브그래프 후보가 미리 주어지지 않는 상황에서 의심 서브그래프를 분류하고 새 후보를 찾는 RevClassify와 RevFilter 방법을 제안한다.
- 기획 관점에서 중요한 이유: 실제 시스템에서는 정답 패턴 범위가 제공되지 않으므로 1단계 Alert에서 조사 범위를 어떻게 확장할지 설계하는 데 도움이 된다.
- 원본 PDF: `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/Identifying Money Laundering Subgraphs on the Blockchain.pdf`
- 번역본: [번역본 바로가기](<2단계_구조와_연결되는_서브그래프_연구/번역본/Identifying Money Laundering Subgraphs on the Blockchain_번역본.md>) — `docs/01_research/donghyeon/2단계_구조와_연결되는_서브그래프_연구/번역본/Identifying Money Laundering Subgraphs on the Blockchain_번역본.md`

---

## 7. Graph 연구

폴더:

`docs/01_research/donghyeon/graph`

거래 데이터를 그래프로 표현하고 그래프 기반 딥러닝, 자기지도학습, 이종 그래프 모델로 확장하는 방법을 정리한 폴더다.

### 7.1 거래 모니터링을 위한 그래프 기반 AML 딥러닝 모델

- 간단한 설명: 전통적 머신러닝, 딥러닝, 그래프 기반 모델과 비지도학습을 AML 거래 모니터링 관점에서 설명한다.
- 기획 관점에서 중요한 이유: 계좌를 노드로, 거래를 엣지로 구성할 때 어떤 모델 선택지가 있으며 기존 테이블 모델과 그래프 모델을 어떻게 비교할지 이해하는 입문 자료다.
- 번역본: [번역본 바로가기](<graph/그래프_기반_딥러닝_AML_한국어_번역.md>) — `docs/01_research/donghyeon/graph/그래프_기반_딥러닝_AML_한국어_번역.md`
- 이미지 자료: `docs/01_research/donghyeon/graph/assets/graph_based`

### 7.2 LaundroGraph: Self-Supervised Graph Representation Learning for Anti-Money Laundering

- 간단한 설명: 고객과 거래를 이분 그래프로 구성하고 자기지도학습으로 표현을 학습해 라벨이 부족한 AML 환경에 적용한다.
- 기획 관점에서 중요한 이유: 단건 자금세탁 라벨의 품질이 낮거나 실제 금융 데이터에서 완전한 정답 라벨을 확보하기 어려울 때 사용할 수 있는 대안적 학습 방향이다.
- 번역본: [번역본 바로가기](<graph/LaundroGraph_한국어_번역.md>) — `docs/01_research/donghyeon/graph/LaundroGraph_한국어_번역.md`
- 이미지 자료: `docs/01_research/donghyeon/graph/assets/laundrograph`

### 7.3 이종 그래프 신경망을 이용한 자금세탁자 탐지

- 간단한 설명: 고객, 계좌, 기업 관계 등 서로 다른 노드와 관계를 이종 그래프로 구성해 자금세탁자를 탐지한다.
- 기획 관점에서 중요한 이유: 현재 거래·계좌 중심 MVP에서 향후 고객, Entity, 소유 관계와 금융기관 정보를 추가하는 확장 스키마를 설계할 때 참고한다.
- 번역본: [번역본 바로가기](<graph/이종_그래프_신경망_AML_한국어_번역.md>) — `docs/01_research/donghyeon/graph/이종_그래프_신경망_AML_한국어_번역.md`
- 이미지 자료: `docs/01_research/donghyeon/graph/assets/heterogeneous_gnn`
- 중복 안내: `최신동향/Finding money launderers using heterogeneous graph.pdf` 및 해당 번역본과 같은 연구 계열이다.

---

## 8. 논문별 기록 항목

논문을 읽을 때 다음 항목을 동일한 형식으로 기록하면 EDA와 모델 요구사항으로 연결하기 쉽다.

| 기록 항목 | 확인할 내용 |
|---|---|
| 탐지 단위 | 거래, 계좌, 고객, 엣지, 노드, 서브그래프 중 무엇인가 |
| 라벨 기준 | 라벨이 어떤 근거와 기간을 사용해 생성됐는가 |
| 그래프 정의 | 노드와 엣지, 방향, 다중 엣지, 시간 정보가 무엇인가 |
| 입력 피처 | 거래 자체, 계좌 과거 행동, 주변 관계 중 무엇을 사용하는가 |
| 시간 처리 | 현재 거래보다 미래인 정보가 피처에 포함되지 않았는가 |
| 불균형 처리 | 클래스 가중치, 샘플링, 증강 등을 어디에 적용했는가 |
| 평가 지표 | PR-AUC, Recall, Precision, F1, Alert 수를 어떻게 계산하는가 |
| 평가 단위 | 거래 단위와 계좌·고객 단위 평가를 구분하는가 |
| 임계값 | 운영 인력의 처리 가능량이나 상위 몇 퍼센트를 기준으로 하는가 |
| 설명 방법 | 전역 중요도와 개별 Alert 판정 이유를 구분하는가 |
| 데이터 한계 | 합성 데이터, 라벨 누락, 생성기 흔적, 기관별 단절 문제가 있는가 |
| 프로젝트 적용 | 현재 EDA·피처·모델·평가 중 어디에 적용할 수 있는가 |

---

## 9. 현재 프로젝트 단계별 참고 논문

### 합성 데이터와 단건 라벨 검토

1. Realistic Synthetic Financial Transactions for AML Models
2. TransXion
3. Anomaly Detection: A Survey
4. Graph-based Anomaly Detection and Description

### 거래 및 계좌 피처 추출

1. Graph Feature Preprocessor
2. LOF
3. LaundroGraph

### 모델 평가와 Threshold 설계

1. Time-aware and Interpretable AML Monitoring
2. The Precision-Recall Plot Is More Informative
3. The Relationship Between Precision-Recall and ROC Curves

### 2단계 패턴 탐지 모델

1. AMAP
2. The Shape of Money Laundering
3. Identifying Money Laundering Subgraphs
4. Directed Multigraph GNN

### 여러 금융기관 분석 플랫폼

1. Project Aurora
2. Finding Money Launderers Using Heterogeneous GNNs
3. Continual Graph Learning for AML

### 탐지 근거 제공

1. A Unified Approach to Interpreting Model Predictions
2. Time-aware and Interpretable AML Monitoring
3. Graph Feature Preprocessor
