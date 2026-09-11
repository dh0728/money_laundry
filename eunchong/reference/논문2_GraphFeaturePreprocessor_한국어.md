# Graph Feature Preprocessor: 금융범죄 탐지를 위한 실시간 부분그래프 기반 피처 추출

**원제**: Graph Feature Preprocessor: Real-time Subgraph-based Feature Extraction for Financial Crime Detection

**저자**
- Jovan Blanuša — IBM Research Europe, 취리히, 스위스 (jov@zurich.ibm.com)
- Maximo Cravero Baraja — Caltech, 패서디나, 미국 (mcravero@caltech.edu)
- Andreea Anghel — IBM Research Europe, 취리히, 스위스 (aan@zurich.ibm.com)
- Luc von Niederhäusern — IBM Research Europe, 취리히, 스위스 (lvn@zurich.ibm.com)
- Erik Altman — IBM Watson Research, 요크타운 하이츠, 미국 (ealtman@us.ibm.com)
- Haris Pozidis — IBM Research Europe, 취리히, 스위스 (hap@zurich.ibm.com)
- Kubilay Atasu — TU Delft, 델프트, 네덜란드 (kubilay.atasu@tudelft.nl)

*(본 연구는 Maximo Cravero Baraja와 Kubilay Atasu가 IBM Research Europe 취리히에 재직 중일 때 수행되었습니다.)*

**출처**: arXiv:2402.08593v2 [cs.LG], 2024년 10월 3일 / ACM ICAIF'24 학회 논문 게재 예정

---

## 초록 (Abstract)

본 논문은 **Graph Feature Preprocessor**를 제시합니다. 이는 금융 거래 그래프에서 전형적인 자금세탁 패턴을 실시간으로 탐지하는 소프트웨어 라이브러리입니다. 이 패턴들은 사기 금융거래 탐지 같은 다운스트림 머신러닝 학습·추론 작업을 위한 풍부한 거래 피처 집합을 생성하는 데 사용됩니다.

본 연구는 이렇게 풍부해진 거래 피처가 **그래디언트 부스팅 기반 머신러닝 모델의 예측 정확도를 극적으로 개선**함을 보입니다. 본 라이브러리는 멀티코어 병렬성을 활용하고, 동적 인메모리 그래프를 유지하며, 유입되는 거래 스트림에서 부분그래프 패턴을 효율적으로 마이닝하여 **스트리밍 방식으로 운영**될 수 있게 합니다.

Graph Feature Preprocessor와 그래디언트 부스팅 기반 머신러닝 모델을 결합한 본 솔루션은, 자금세탁방지 및 피싱 데이터셋에서 **표준 그래프 신경망(GNN)보다 높은 소수 클래스 F1 점수**로 불법 거래를 탐지합니다. 또한 멀티코어 CPU에서 실행된 본 솔루션의 종단간 처리량은 강력한 V100 GPU에서 실행된 그래프 신경망 베이스라인을 능가합니다.

전반적으로 높은 정확도, 높은 처리량, 낮은 지연시간의 조합은 본 라이브러리가 실세계 응용에서 갖는 실용적 가치를 입증합니다.

---

## 1. 서론 (Introduction)

금융거래는 계좌 간 자금 이동을 문서화하는 기록으로 기능합니다. 일반적으로 이 거래들은 표(tabular) 형식으로 포착되는데, 각 행은 하나의 개별 금융거래를 나타내고 열은 타임스탬프, 출처 계좌, 목표 계좌, 이전 금액, 통화, 결제 유형 같은 기본 거래 피처를 나타냅니다.

이러한 표 표현이 데이터의 구조화된 시야를 제공하는 반면, **거래를 그래프의 엣지로, 계좌를 정점으로 취급**하여 금융거래를 그래프로 표현하면 더 통찰력 있는 접근법이 등장합니다(Fig. 1 참조). 이러한 그래프 표현은 분석가가 표 형식에서는 즉시 드러나지 않을 수 있는 통찰을 발견할 수 있게 합니다. 결과적으로 금융거래 그래프는 복잡한 금융 데이터의 효율적 분석과 해석을 촉진하여 금융범죄 탐지를 돕습니다.

### 금융범죄 패턴

금융거래 그래프의 부분그래프 패턴은 종종 금융범죄의 지표로 기능할 수 있습니다.

- **단순 순환 (Simple cycle)** — Fig. 1a에 표현된 것으로, 자금을 한 은행 계좌에서 동일 계좌로 다시 이전하는 거래 시퀀스를 나타냅니다. 이러한 순환은 자금세탁, 조세 회피, 신용카드 사기, 또는 주가 조작에 사용되는 순환 거래(circular trading)의 지표가 될 수 있습니다.
- **Gather-scatter 패턴** — Fig. 1b에 표현된 것으로, **펌프 앤 덤프(pump and dump)** 주가 조작 수법을 시사할 수 있습니다. 이 수법에서는 소셜 미디어를 이용해 다른 투자자의 투자를 유인하여 기업 주가를 인위적으로 상승시킵니다. 주가가 충분히 상승한 후 악의적 거래자들이 주식을 매도합니다. 인위적으로 부풀려진 주가로 인해 그 가치가 하락하고, 다른 거래자들은 금융 손실을 입습니다.
- **Scatter-gather 패턴** — Fig. 1c에 표현된 것으로, **스머핑(smurfing)**이라 불리는 자금세탁 전술을 나타낼 수 있습니다. 여기서 악의적 행위자는 여러 중개 계좌(Fig. 1c의 파란색 노드)를 사용하여 소액의 불법 자금을 합법적 뱅킹 시스템에 통합시킵니다.

유사하게 암호화폐 거래 네트워크에서 범죄자는 정교한 믹싱·셔플링 수법을 사용하여 활동 추적을 흐리게 합니다. 이러한 수법은 보통 부분그래프 구조로 표현될 수 있습니다. 이러한 의심스러운 부분그래프 구조의 발견은 범죄 활동과 그 가담자를 찾아내고 중단시킬 수 있게 합니다.

> **Fig. 1** — 금융거래 그래프의 범죄 패턴: **(a) 순환 자금세탁(Circular money laundering), (b) 펌프 앤 덤프(Pump and dump), (c) 스머핑(Smurfing)**

### 문제 정의

의심 금융거래의 신속한 탐지와 처리는 금융 손실을 방지하는 데 중요합니다. 금융 데이터는 종종 표 형식으로 표현되므로, 이 입력 형식에 대해 가장 빠르고 정확한 머신러닝 모델은 **그래디언트 부스팅 모델**입니다. 그러나 이 모델들은 근본적 그래프 구조를 고려할 수 없고 금융범죄와 연관될 수 있는 그래프 패턴을 발견할 수 없습니다. 나아가 금융거래와 연관된 기본 피처의 제한된 집합(Fig. 2 참조)은 그래디언트 부스팅 기반 모델이 의심 거래를 충분한 정확도로 탐지할 수 있는 정보를 제공하지 않습니다. 결과적으로 이 방법들만으로 의심 거래를 탐지하는 것은 과제가 됩니다.

### 제안 솔루션

앞서 언급한 한계를 극복하기 위해 Fig. 2에 나타난 솔루션을 제안합니다. 구체적으로 금융거래를 위한 풍부한 그래프 기반 피처 집합을 생성하는 **Graph Feature Preprocessor (GFP)** 라이브러리를 개발했습니다. 본 라이브러리는 자금세탁 순환과 scatter-gather 패턴 같은 전형적 금융범죄 패턴을 탐색하고(Fig. 1 참조), 이러한 그래프 패턴을 거래 테이블의 추가 열(즉 피처)로 인코딩합니다.

그래프 기반 피처로 풍부해진 거래 테이블은 사전 학습된 그래디언트 부스팅 기반 머신러닝 모델로 전달되어 금융거래를 분류하고 의심 거래를 탐지합니다. 결과적으로 머신러닝 모델은 금융거래 그래프에서 추출된 추가 거래 피처를 제공받게 되며, 이는 금융범죄와 연관된 거래의 탐지를 촉진합니다.

> **Fig. 2** — 의심 금융거래 탐지를 위한 그래프 ML 파이프라인 개요: **금융거래 배치 → Graph Feature Preprocessor → 그래프 기반 피처가 추가된 금융거래 배치 → 그래디언트 부스팅 기반 ML 모델 → 의심 거래**

### 주요 기여

- **Graph Feature Preprocessor**라 불리는 그래프 기반 피처 추출 라이브러리를 제시합니다. 이는 그래프에서 의심스러운 부분그래프 패턴을 열거하고 그래프 정점의 다양한 통계적 속성을 계산하여 금융거래 그래프의 엣지 피처 집합을 풍부하게 합니다. 그런 다음 이 라이브러리를 사용하여 금융거래 네트워크를 모니터링하는 그래프 머신러닝(graph ML) 파이프라인을 개발합니다. **§2**에서 이 라이브러리를 소개합니다.
- 자금세탁 탐지 과제에서 그래프 신경망(GNN) 베이스라인과 비교하여 **소수 클래스 F1 점수를 최대 36% 개선**하는 실험을 수행합니다. 또한 Intel Xeon 프로세서 32코어에서 실행된 본 그래프 ML 파이프라인이 NVIDIA Tesla V100 GPU에서 실행된 GNN 베이스라인보다 **높은 처리량**을 달성함을 입증합니다. 실험 평가는 **§4**에 제시됩니다.

### 공개 및 배포

GFP 라이브러리는 **Snap ML** 패키지의 일부로 PyPI에서 공개 이용 가능합니다. 또한 IBM 메인프레임 소프트웨어 제품 **Cloud Pak for Data on Z**와 **AI Toolkit for IBM Z and LinuxONE**에 함께 제공됩니다. 나아가 IBM Z 환경을 사용하여 그래프 ML 파이프라인을 개발·배포하는 방법을 보여주는 **AI on IBM Z Anti-Money Laundering Solution Template**이 오픈소스로 공개되어 있습니다.

---

## 2. Graph Feature Preprocessor

Graph Feature Preprocessor(GFP)의 개요는 Fig. 3에 제시됩니다. GFP는 **스트리밍 방식**으로 작동하며, Fig. 2와 같이 기본 피처만 가진 거래 배치를 입력으로 받아 추가 그래프 기반 피처를 출력으로 생성합니다.

GFP는 과거 금융거래를 **인메모리 그래프**에 저장하며, 이 그래프는 새 거래가 수신될 때마다 동적으로 갱신됩니다. 그래프 기반 피처는 그래프의 부분그래프 패턴을 열거하고 해당 그래프에 저장된 계좌의 다양한 통계적 속성을 생성하여 계산됩니다. GFP는 여러 CPU 코어에 걸쳐 병렬로 그래프 기반 피처를 계산할 수 있으며, 이는 동적 그래프 표현과 함께 **실시간 피처 추출**을 가능하게 합니다.

### scikit-learn 인터페이스

GFP는 **fit/transform 인터페이스**를 갖춘 scikit-learn 전처리기로 구현되었으며, Snap ML 패키지의 일부로 PyPI에 공개되어 있습니다. GFP의 주 기능은 `transform` 함수로 구현되며, Fig. 3에 나타나 있습니다.

- **`transform`** — 입력 거래 배치를 인메모리 그래프에 삽입하고, 해당 거래들에 대한 그래프 기반 피처를 계산합니다.
- **`fit`** — 일부 과거 거래를 입력으로 제공하여 초기 인메모리 그래프를 생성합니다.
- **`partial_fit`** — 그래프 피처를 계산하지 않고 기존 인메모리 그래프를 갱신합니다.

GFP가 지원하는 기타 표준 전처리기 함수는 공개 문서에 기술되어 있습니다.

> **Fig. 3** — GFP는 fit/transform 메서드를 갖춘 scikit-learn 전처리기로 제공됩니다. 내부 구성: **동적 그래프 관리**(create new graph → update graph → 인메모리 그래프)와 **그래프 패턴 마이닝**(fan-in/out, scatter-gather, cycle, vertex statistics)

본 절의 나머지에서는 GFP의 동적 그래프 관리 및 그래프 패턴 마이닝 구성요소를 기술하고(Fig. 3 참조), 라이브러리가 생성하는 그래프 기반 피처가 어떻게 인코딩되는지 설명합니다.

### 2.1 동적 그래프 관리 (Dynamic Graph Management)

GFP의 동적 그래프 관리 구성요소는 금융거래 네트워크를 표현하기 위해 **인메모리 그래프**를 사용합니다. 이 시나리오에서 각 계좌는 그래프 정점으로 취급되고, 각 거래는 출처 계좌에서 목적지 계좌로의 엣지로 표현됩니다.

금융거래는 일반적으로 거래가 생성된 시점을 나타내는 **타임스탬프**를 포함하므로(Fig. 2 참조), 금융거래 그래프는 **시계열 그래프(temporal graph)**로 간주됩니다. 나아가 금융거래 그래프는 **멀티그래프(multigraph)**이기도 합니다 — 동일한 출처·목적지 정점 쌍을 연결하는 여러 **평행 엣지(parallel edge)**가 존재할 수 있습니다. 따라서 인메모리 그래프는 **시계열 멀티그래프**를 표현할 수 있어야 합니다.

스트리밍 방식의 매끄러운 거래 처리를 가능하게 하기 위해, 인메모리 그래프는 새 거래의 삽입과 만료된 거래의 제거를 지원해야 합니다.

- **새 거래(new transaction)** — 인메모리 그래프의 현존 거래 타임스탬프보다 큰 타임스탬프를 가진 거래
- **만료 거래(outdated transaction)** — t_now − δ보다 작은 타임스탬프를 가진 거래 (t_now는 인메모리 그래프 내 거래의 최대 타임스탬프, δ는 사용자 정의 시간 윈도우)

결과적으로 인메모리 그래프는 시간 윈도우 **[t_now − δ : t_now]** 내에 속하는 거래만 보유하여, 메모리 사용량을 효과적으로 제약합니다.

#### 자료구조

인메모리 그래프는 두 가지 주요 자료구조로 구성됩니다 — **거래 로그(transaction log)**와 **인덱스(index)**.

- **거래 로그**: 양단 큐(double-ended queue)로 구현되며, 타임스탬프 오름차순으로 정렬된 엣지 리스트를 유지합니다. 이 자료구조는 가장 작은 타임스탬프를 가진 엣지의 탐지·제거를 **O(1)** 연산으로 지원하여 만료 엣지 처리를 촉진합니다.
- **인덱스**: 정점 v의 이웃에 빠르게 접근할 수 있게 하는 **인접 리스트(adjacency list)** 표현을 사용합니다. **해시맵의 벡터**로 구현되며, 벡터의 각 항목은 정점 v를 나타내고 해당 정점과 연관된 해시맵은 v의 인접 리스트를 의미합니다. 정점은 내부적으로 0, 1, ..., n−1 범위의 정수로 매핑되며(n은 그래프의 정점 수), 이 정수들은 이 벡터 내 정점 v의 인접 리스트에 접근하는 데 사용됩니다. 나아가 각 엣지는 인덱스를 사용하여 **O(1)** 시간에 접근 가능하며, 이는 그래프 패턴 마이닝 구성요소가 요구하는 그래프 순회를 촉진합니다.

**평행 엣지 유지를 지원하기 위해**, 정점 v의 인접 리스트 내 각 항목(정점 v의 이웃 u를 표현)은 v와 u를 연결하는 엣지 리스트도 포함하며, 이를 **평행 엣지 리스트(parallel edge list)**라 부릅니다. 이 리스트의 엣지들은 양단 큐로도 구현되어 ID와 타임스탬프로 표현되며, 타임스탬프 오름차순으로 정렬됩니다. 이 때문에 새 엣지 삽입과 만료 엣지 제거 연산을 **O(1)** 시간에 수행할 수 있습니다.

### 2.2 그래프 패턴 마이닝 (Graph Pattern Mining)

그래프 패턴 마이닝 구성요소의 과제는 `transform` 함수를 통해 라이브러리에 전달된 엣지에 대한 그래프 기반 피처를 생성하는 것입니다. 두 가지 유형의 그래프 기반 피처가 지원됩니다 — **i) 그래프 패턴 기반 피처**, **ii) 정점 통계 기반 피처**.

#### 그래프 패턴 기반 피처 (Graph-pattern-based features)

전달된 엣지 중 하나를 포함하는 인메모리 그래프의 그래프 패턴을 추출하여 계산됩니다. 본 라이브러리는 다음 그래프 패턴을 추출합니다.

- **fan-in**, **fan-out**
- **scatter-gather**, **gather-scatter**
- **단순 순환(simple cycle)**, **시계열 순환(temporal cycle)**

**Fan-in / fan-out 패턴**은 정점 v와 그의 모든 유입·유출 엣지로 각각 정의되는 패턴을 지칭합니다.

**Gather-scatter 패턴**은 정점 v의 fan-in 패턴과 동일 정점 v의 fan-out 패턴을 결합합니다(Fig. 1b 참조).

**Scatter-gather 패턴**: 정점 v의 fan-out 패턴과 정점 u의 fan-in 패턴이, v와 u의 fan-out과 fan-in이 각각 동일한 중간 정점 집합에 연결될 경우 scatter-gather 패턴을 형성합니다(Fig. 1c의 파란색 정점).

**단순 순환(simple cycle)**은 정점 v에서 동일 정점 v로의 경로이며, 첫 정점과 마지막 정점을 제외하고 정점이 반복되지 않습니다.

**시계열 순환(temporal cycle)**은 엣지가 시간 순서로 정렬된 단순 순환입니다.

#### 스트리밍 방식의 피처 계산

그래프 패턴 기반 피처를 스트리밍 방식으로 계산하기 위해, 본 라이브러리는 엣지 배치를 그래프에 삽입한 후 형성된 **새로운 패턴만** 열거합니다.

- 입력 배치에 속하는 정점 v의 **fan-in 및 fan-out 패턴 피처**는 v의 유출·유입 정점 수를 세어 결정됩니다. 이 피처들은 인덱스 자료구조에서 정점 v의 인접 리스트를 구현하는 해시맵 크기를 단순 질의하여 **O(1)** 시간에 결정될 수 있습니다(§2.1 참조).
- **gather-scatter 패턴**은 정점 v의 fan-in과 fan-out이 각각 최소 2 이상일 경우 암묵적으로 탐지됩니다.
- 지면 제약으로 인해 scatter-gather 패턴 탐색 알고리즘의 기술은 생략합니다.

**단순 순환과 시계열 순환을 스트리밍 방식으로 열거하기 위해**, Blanuša 등이 도입한 **세밀 병렬(fine-grained parallel) 알고리즘**을 사용합니다. 이 알고리즘들은 여러 스레드를 사용하여 단일 엣지 또는 소규모 엣지 배치에서 시작하는 순환 탐색을 병렬로 수행할 수 있게 합니다. 이 알고리즘의 이점은 **소규모 배치의 거래도 높은 처리량으로 처리**할 수 있다는 점입니다.

예컨대 순환 계산이 **조대 병렬(coarse-grained parallel)** 접근법을 채택하여 병렬화되는 경우, 배치의 각 엣지에 대한 재귀적 순환 탐색이 서로 다른 스레드에 의해 수행됩니다. 그러나 Blanuša 등이 보인 것처럼, 조대 접근법은 스레드 간 잠재적 작업부하 불균형으로 인해 차선의 성능을 낼 수 있습니다. 이와 대조적으로 **세밀 열거 알고리즘**은 Fig. 4와 같이 여러 스레드를 사용하여 단일 엣지에서 시작하는 재귀 탐색을 실행할 수 있어, 병렬성을 증가시킵니다. 결과적으로 입력 배치가 단 하나의 거래만 포함해도 본 라이브러리는 순환 탐색을 병렬화할 수 있습니다.

> **Fig. 4** — GFP가 활용하는 세밀 병렬성. 라이브러리는 각 입력 거래에 대해 거래 그래프를 재귀적으로 탐색하여 순환을 독립적으로 탐색합니다. **조대 접근법은 4개 스레드만 사용하는 반면, 세밀 접근법은 11개 스레드를 사용합니다.**

#### Scatter-gather 스트리밍 알고리즘

scatter-gather 패턴을 스트리밍 방식으로 계산하기 위해, Fig. 5에 그림으로 나타나고 Algorithm 1에 제시된 알고리즘을 사용합니다. 이 알고리즘에서 (u → v, t_uv)는 출처 정점 u, 목표 정점 v, 타임스탬프 t_uv를 가진 시계열 엣지를 나타냅니다. 이 알고리즘은 입력 배치의 각 엣지 u → v를 처리하여, 그 엣지를 포함하는 모든 scatter-gather 패턴을 탐색합니다.

이 알고리즘의 **첫 번째 국면과 두 번째 국면**은 각각 v와 u를 중간 정점으로 포함하는 scatter-gather 패턴을 탐색합니다.

**첫 번째 국면**:
1. 먼저 u와 v의 유출 이웃을 결정하며, 각각 N⁺_u와 N⁺_v로 표기합니다(Fig. 5a 참조).
2. 그런 다음 v의 각 유출 이웃 w에 대해, 채워진 원으로 표현되는 정점 w의 유입 이웃 N⁻_w를 탐색합니다(Fig. 5b).
3. 이후 N⁺_u와 N⁻_w 간 **집합 교차**를 수행하여 scatter-gather 패턴의 중간 정점 I를 찾습니다.
4. 최종적으로 알고리즘은 Fig. 5c와 같이 정점 u, w, I로 정의된 결과 scatter-gather 패턴을 보고합니다.

**두 번째 국면**(Algorithm 1의 9~14행)은 첫 번째 국면과 유사하므로, 간결성을 위해 기술을 생략합니다. 이 알고리즘은 Algorithm 1에서 보듯 루프를 병렬화하여 **세밀한 방식으로 병렬화**될 수 있음에 주목하십시오.

#### Algorithm 1: ScatterGatherStream (G(V, E), batch, δ_p)

```
입력: G — 정점 V와 엣지 E를 가진 입력 그래프
      batch — 엣지 배치
      δ_p — 시간 윈도우

 1  parallel foreach (u → v, t_uv) : batch do
 2      TW = [t_uv − δ_p : t_uv]                    ▷ 크기 δ_p의 시간 윈도우
        // 첫 번째 국면
 3      N⁺_u = {∀x | (u → x, t_s) ∈ E ∧ t_s ∈ TW};
 4      N⁺_v = {∀x | (v → x, t_s) ∈ E ∧ t_s ∈ TW};
 5      parallel foreach w : N⁺_v do
 6          N⁻_w = {∀x | (x → w, t_s) ∈ E ∧ t_s ∈ TW};
 7          I = N⁺_u ∩ N⁻_w;
 8          if |I| ≥ 2 then scatter-gather 패턴 {u, I, w} 보고;
        // 두 번째 국면
 9      N⁻_u = {∀x | (x → u, t_s) ∈ E ∧ t_s ∈ TW};
10      N⁻_v = {∀x | (x → v, t_s) ∈ E ∧ t_s ∈ TW};
11      parallel foreach w : N⁻_v do
12          N⁺_w = {∀x | (w → x, t_s) ∈ E ∧ t_s ∈ TW};
13          I = N⁻_u ∩ N⁺_w;
14          if |I| ≥ 2 then scatter-gather 패턴 {w, I, v} 보고;
```

> **Fig. 5** — v를 중간 정점으로 하여 엣지 u → v를 포함하는 scatter-gather 패턴의 열거: **(a) N⁺_u와 N⁺_v 결정 → (b) N⁻_w 결정 → (c) 결과 패턴 (I = N⁺_u ∩ N⁻_w)**

#### 시간 제약을 통한 탐색 시간 단축

병렬화와 별도로, 그래프 패턴 탐색에 필요한 시간을 줄이는 또 다른 방법은 **시간 윈도우 제약**을 부과하는 것입니다. 이 경우 각 그래프 패턴에 대해 시간 윈도우 파라미터 **δ_p**를 명세할 수 있으며, 라이브러리는 엣지의 타임스탬프가 **t_now − δ_p** 이상인 패턴만 탐색합니다(t_now는 인메모리 그래프 내 엣지의 최대 타임스탬프). 추가로 단순 순환의 경우 **최대 길이를 제한**하여 탐색 공간을 제약할 수 있습니다.

#### 정점 통계 기반 피처 (Vertex-statistics-based features)

입력 엣지 배치에 나타나는 정점들에 대해 계산됩니다. 그러한 각 정점 v에 대해, v의 유출 엣지와 유입 엣지에 연관된 선택된 기본 피처를 사용하여 일부 사전 정의된 통계적 속성이 계산될 수 있습니다.

현재 지원되는 통계적 속성은 다음과 같습니다.
**합(sum), 평균(mean), 최소(minimum), 최대(maximum), 중앙값(median), 분산(variance), 왜도(skew), 첨도(kurtosis)**

예컨대 "Amount(금액)"가 선택된 기본 피처라면, 통계적 피처는 계좌가 수신하거나 송금한 **평균 금액과 총 금액**을 포함합니다. 서로 다른 통계적 피처 유형을 서로 다른 사용자 명세 기본 피처와 이런 방식으로 결합하면, **피처 공간을 상당히 확장**합니다.

정점 통계 기반 피처는 **증분적(incremental) 방식**으로 스트리밍하며 결정될 수 있습니다. 이를 위해 본 라이브러리는 계좌 통계(예: "Amount") 계산에 사용되는 각 기본 피처와 그래프의 각 정점에 대해 **2차, 3차, 4차 중심 모멘트(central moment)**를 유지합니다. 엣지 u → v를 삽입하거나 제거한 후, u와 v에 대한 모든 중심 모멘트가 증분적으로 갱신됩니다. 이 중심 모멘트들은 이후 다음 통계적 피처를 계산하는 데 사용됩니다 — **합, 평균, 분산, 왜도, 첨도**. 앞서 언급한 각 통계적 피처의 계산은 **O(1)** 시간에 수행될 수 있음에 주목하십시오. 최소, 최대, 중앙값 같은 기타 통계적 피처는 단순히 정점의 인접 엣지들을 반복하여 계산되며, 이는 통계적 피처당 **O(Δ)** 시간에 실행됩니다(Δ는 그래프의 최대 차수).

### 2.3 피처 인코딩 (Feature Encoding)

GFP의 `transform` 함수가 생성하는 피처의 인코딩은 Fig. 6에 나타납니다. 출력 피처 테이블의 각 행은 단일 거래의 피처 벡터를 저장합니다. 피처 벡터의 서로 다른 열에는 다음이 있습니다.

- **기본 거래 피처**
- **그래프 패턴 기반 거래 피처**
- 거래의 **출처 계좌 및 목적지 계좌의 계좌 피처**

**계좌 피처**는 정점 통계 기반 피처와, fan-in 및 fan-out 패턴에 기반한 피처로 구성되며, 둘 다 단일 홉(single-hop) 패턴입니다. fan-in 및 fan-out 패턴 기반 피처는 각 계좌 v에 대해 계산되며, 그 패턴 내에서 v에 연결된 계좌의 수를 나타냅니다.

**그래프 패턴 기반 거래 피처**는 다중 홉(multi-hop) 부분그래프 패턴을 사용하여 계산됩니다 — **scatter-gather, 홉 제약 단순 순환(hop-constrained simple cycle), 시계열 순환**. 각 거래에 대해 본 라이브러리는 이 거래가 참여하는 서로 다른 크기의 다중 홉 부분그래프 패턴의 수를 보고합니다.

다중 홉 부분그래프 패턴에 기반한 피처의 예는 Fig. 6에 제시됩니다. 여기서 첫 번째 거래는 **3개 중간 정점을 가진 4개의 scatter-gather 패턴**과 **30개 엣지를 가진 2개의 시계열 순환**에 참여합니다. 이 다중 홉 부분그래프 패턴들이 계좌 피처를 계산하는 데도 사용될 수 있지만, 이를 거래 피처로 계산하는 것이 **더 간결한 피처 벡터**를 제공합니다.

> **Fig. 6** — 피처 인코딩: **scatter-gather 패턴은 보유한 중간 정점 수에 따라 구간화(binned)되고, 순환은 길이에 따라 구간화됩니다.**
>
> 구조: 기본 거래 피처 | 그래프 패턴 기반 거래 피처 | 출처 계좌 피처 | 목표 계좌 피처
> - **다중 홉 부분그래프 거래 피처**: Scatter-gather (2, 3, ..., ≥30) / Simple cycles (2, 3, ..., ≥10) / Temporal cycles (2, 3, ..., ≥30)
> - **계좌 피처**: 유출 엣지(Fan Deg., Timestamp statistics, Amount statistics) / 유입 엣지(Fan Deg., Timestamp statistics, Amount statistics)

---

## 3. 실험 설정 (Experimental setup)

### 데이터셋

Table 1은 평가에 사용된 데이터셋을 제시합니다.

**AML 데이터셋**은 **AMLworld** 생성기가 생성한 공개 합성 AML 데이터셋입니다. 이 데이터셋들은 합법(licit) 또는 불법(illicit)으로 라벨링된 거래를 포함하므로, 거래 분류를 수행하는 본 그래프 ML 파이프라인에 직접 사용될 수 있습니다. 데이터셋은 두 변형으로 나뉩니다 — **불법률이 더 높은 것(AML HI)**과 **더 낮은 것(AML LI)**.

추가로 **ETH Phishing 데이터셋**을 사용하며, 이는 피싱으로 라벨링된 1,165개 계좌를 가진 실세계 이더리움 데이터셋입니다. 이 데이터셋으로 거래 분류를 가능하게 하기 위해, 목적지 계좌가 피싱으로 라벨링된 경우 해당 거래를 피싱으로 라벨링합니다. 결과적으로 이더리움 거래의 **0.278%**가 피싱으로 라벨링됩니다.

**Table 1: 실험에 사용된 데이터셋**

| 데이터셋 | 노드 수 | 엣지 수 | 불법률 | 기간 |
|---|---:|---:|---:|---:|
| AML HI Small | 0.5 M | 5 M | 0.102% | 10일 |
| AML HI Medium | 2.1 M | 32 M | 0.110% | 16일 |
| AML HI Large | 2.1 M | 180 M | 0.124% | 97일 |
| AML LI Small | 0.7 M | 7 M | 0.051% | 10일 |
| AML LI Medium | 2.1 M | 32 M | 0.051% | 16일 |
| AML LI Large | 2.1 M | 180 M | 0.057% | 97일 |
| ETH Phishing | 2.9 M | 13 M | 0.278% | 1261일 |

### 베이스라인 (Baselines)

- **그래디언트 부스팅 모델**: 표 데이터에 널리 사용되는 ML 모델인 **LightGBM (버전 3.1.1)**과 **XGBoost (버전 1.7.5)** 부스팅 머신을 그래프 ML 파이프라인에 사용합니다. 본 그래프 ML 파이프라인을, GFP가 생성한 피처 없이 기본 피처만으로 학습된 LightGBM 및 XGBoost 모델과 비교합니다. 이 모델들의 하이퍼파라미터 튜닝을 수행하기 위해 **successive halving** 모델 튜닝 접근법을 사용합니다.
- **그래프 신경망(GNN) 베이스라인**: 다음 GNN들을 사용합니다.
  - **GIN (Graph Isomorphism Network)**
  - **GIN+EU (GIN with edge updates)**
  - **PNA (Principal Neighbourhood Aggregation)**
  
  GIN+EU 베이스라인은 자금세탁방지를 위해 특별히 설계된 GNN인 **LaundroGraph**와 유사합니다. 이 GNN들의 AML 데이터셋에 대한 정확도 결과는 Altman 등에서 가져왔습니다. 나아가 모든 베이스라인과 본 그래프 ML 파이프라인은 **거래의 출처·목적지 계좌 ID 없이 학습**됩니다. 이는 모델이 계좌 ID의 암기(memorisation)에 기반하여 자금세탁 거래를 식별하는 것을 방지합니다.

**Table 2: LightGBM 및 XGBoost 모델의 하이퍼파라미터 튜닝에 사용된 successive halving 구성**

| 데이터셋 | AML Small | AML Medium | AML Large | ETH |
|---|---:|---:|---:|---:|
| x₀ | 1000 | 100 | 16 | 100 |
| η | 2 | 2 | 2 | 2 |
| r₀ | 0.1 | 0.2 | 0.2 | 0.1 |

**Table 3: 튜닝 시 사용된 모델 파라미터 범위**

| LightGBM 파라미터 | 범위 | XGBoost 파라미터 | 범위 |
|---|---|---|---|
| num_round | (10, 1000) | num_round | (10, 1000) |
| num_leaves | (1, 16384) | max_depth | (1, 15) |
| learning_rate | 10^(−2.5, −1) | learning_rate | 10^(−2.5, −1) |
| lambda_l2 | 10^(−2, 2) | lambda | 10^(−2, 2) |
| scale_pos_weight | (1, 10) | scale_pos_weight | (1, 10) |
| lambda_l1 | 10^(0.01, 0.5) | colsample_bytree | (0.5, 1.0) |
| | | subsample | (0.5, 1.0) |
| **early_stopping_rounds = 20** | | | |

### Graph Feature Preprocessor 설정

GFP는 다음과 같이 그래프 기반 피처를 추출하도록 구성됩니다.

- **AML 데이터셋**: scatter-gather 패턴에는 **6시간** 시간 윈도우, 나머지 모든 그래프 기반 피처에는 **1일** 시간 윈도우를 사용합니다. 단순 순환 열거에는 **순환 길이 제약 10**을 명세합니다. 정점 통계 기반 피처 생성에는 기본 거래 피처의 **"Amount"와 "Timestamp"** 필드를 사용합니다.
- **ETH Phishing 데이터셋**: 모든 그래프 기반 피처에 **20일** 시간 윈도우를 사용합니다. 추가로 시계열 순환 생성을 **비활성화**하고, 단순 순환 열거에 **순환 길이 제약 5**와 **홉 제약 5**를 명세합니다. 계좌 통계 생성에는 기본 거래 피처의 **"Amount", "Timestamp", "Block Nr."** 필드를 사용합니다.

이 파라미터들은 GFP의 처리량과 스코어링에 사용되는 ML 모델의 정확도 사이의 **최적 절충점(trade-off)**을 찾기 위한 신중한 탐색을 통해 선택되었습니다.

### 그래프 ML 파이프라인 학습

본 그래프 ML 파이프라인의 학습 단계는 Fig. 7a에 나타납니다.

1. 먼저 학습에 사용 가능한 거래들이 타임스탬프 오름차순으로 정렬되어 학습(train), 검증(validation), 테스트(test) 집합으로 분할됩니다. 이 분할은 학습 집합의 거래가 가장 낮은 타임스탬프를, 테스트 집합의 거래가 가장 높은 타임스탬프를 갖도록 수행됩니다.
2. 그런 다음 학습 및 검증 집합의 거래들이 GFP로 전달되어 이 두 집합의 거래에 대한 풍부해진 그래프 기반 피처를 생성합니다. **학습 시 어떤 형태의 정보 누수(information leakage)도 방지하기 위해**, 학습 집합이 검증 집합보다 먼저 처리됩니다. 이 경우 학습 집합 거래의 그래프 기반 피처는 해당 거래들만으로 생성된 그래프를 사용하여 계산되므로, **검증 집합의 정보가 사용되지 않습니다**.
3. 최종적으로 풍부해진 피처를 가진 학습 및 검증 집합이 그래디언트 부스팅 모델 학습에 사용됩니다.

### 부스팅 머신 파라미터 튜닝

그래디언트 부스팅 기반 모델 학습의 일부로, **successive halving** 접근법을 사용하여 하이퍼파라미터 튜닝을 수행합니다. 이 접근법은 학습 집합의 분수 r₀ ≤ 1을 사용하여 x₀개의 모델 파라미터 조합을 무작위로 시작합니다. 그런 다음 주어진 η > 1 파라미터에 대해, 알고리즘은 최적의 x₀/η 구성을 찾고, 이는 학습 집합의 η × r₀를 사용하는 다음 successive halving 라운드에 사용됩니다. 이 과정은 평가에 사용된 학습 집합의 분수가 1에 도달할 때까지 계속됩니다. 실험에 사용된 successive halving 파라미터는 Table 2에, 하이퍼파라미터 튜닝에 사용된 LightGBM 및 XGBoost 모델의 파라미터 범위는 Table 3에 제시됩니다.

### 그래프 ML 파이프라인 추론

본 그래프 ML 파이프라인의 추론 단계는 Fig. 7b에 나타납니다.

1. 먼저 Fig. 7a의 설정으로 학습된 모델을 로드합니다.
2. 그런 다음 `fit` 함수를 사용하여 과거 금융거래를 로드하여 GFP를 초기화합니다. 이 과거 금융거래는 초기 인메모리 그래프를 생성하는 데 사용됩니다.
3. 다음으로 테스트 집합의 거래들이 배치로 그룹화되어 `transform` 함수를 사용하여 GFP로 전달됩니다. 이 함수는 전달된 거래를 사용하여 기존 동적 그래프를 갱신하고, 학습 설정과 동일한 유형의 그래프 기반 피처로 해당 거래들을 풍부하게 합니다(Fig. 7a 참조).
4. 최종적으로 풍부해진 테스트 거래들이 사전 학습된 머신러닝 모델로 전송되어 금융범죄와 연관된 거래를 탐지합니다.

> **Fig. 7** — 의심 거래 탐지를 위한 그래프 ML 파이프라인의 **(a) 학습 파이프라인**과 **(b) 추론 파이프라인** 구성요소

### 데이터 분할 (Data split)

모델의 파라미터를 튜닝하고 모델의 일반화 성능을 테스트하기 위해, 입력 데이터를 학습, 검증, 테스트 집합으로 분할합니다. 학습 및 검증 집합은 successive halving 방식으로 모델 튜닝에 사용되고, 테스트 집합은 모델의 최종 평가에 사용됩니다.

- **AML 데이터셋**: 가장 작은 타임스탬프를 가진 거래의 **60%**가 학습 집합으로 선택되고, 학습 집합을 제외한 그 다음 **20%** 거래가 검증 집합으로 선택되며, 나머지가 테스트 집합으로 선택됩니다.
- **ETH 데이터셋**: 계좌의 타임스탬프를 해당 계좌가 관여한 거래들 중 최소 타임스탬프로 정의하고, 데이터셋의 계좌를 다음과 같이 분할합니다 — 가장 작은 타임스탬프를 가진 계좌의 **65%**는 학습 집합에만 존재하고, 그 다음 **15%** 계좌는 검증 데이터셋에만 존재하며, 나머지는 테스트 집합에 있습니다.

앞서 언급한 방식으로 데이터셋을 분할하면 실험에서 **데이터 누수를 방지**합니다.

---

## 4. 결과 (Results)

본 절에서는 Table 1의 데이터셋으로 학습된 본 그래프 ML 파이프라인과 기타 베이스라인의 정확도를 평가합니다. LightGBM 및 XGBoost를 사용하는 본 그래프 ML 파이프라인을 각각 **GFP+LightGBM**과 **GFP+XGBoost**로 지칭합니다.

정확도 척도로 **소수 클래스 F1 점수(minority-class F1 score)**를 사용합니다. 보고된 F1 점수는 서로 다른 5회 실행의 평균이며, F1 점수의 표준편차도 각 실험에 대해 보고됩니다.

본 그래프 ML 파이프라인은 거래가 배치로 도착할 것을 요구합니다. AML 데이터셋의 경우 그래프 ML 파이프라인은 배치 크기 **128과 2048**을 사용합니다. 추가로 ETH Phishing 데이터셋의 경우 배치 크기 **128과 ∞**를 사용하여 피처 추출을 수행합니다. 배치 크기 ∞를 사용할 때는 테스트 집합의 모든 거래가 단일 배치로 GFP에 제공됩니다. 배치 크기 ∞를 사용하는 것은 본질적으로 **오프라인 솔루션**에 대응하며, 원칙적으로 더 나은 정확도로 이어질 수 있습니다 — 이 경우 미래 거래도 피처 추출 중에 보이기 때문입니다. 그러나 응용에서 실시간 처리 능력이 요구되는 경우 배치 크기가 제약되어야 합니다. GNN 베이스라인은 전체 데이터셋이 메모리에 있어야 하므로, 사실상 배치 크기 ∞의 오프라인 솔루션임에 주목하십시오.

### AML 결과

AML 데이터셋에서 세탁 탐지를 수행하는 ML 모델의 소수 클래스 F1 점수는 Table 4에 나타납니다.

**Table 4: AML 데이터셋을 사용한 자금세탁 탐지 과제 및 ETH Phishing 데이터셋을 사용한 피싱 탐지 과제의 소수 클래스 F1 점수 (%)**

NA는 사용 불가(not available)를 의미합니다.

| 모델 | batch size | AML HI Small | AML HI Medium | AML HI Large | AML LI Small | AML LI Medium | AML LI Large | batch size | ETH Phishing |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| GIN | ∞ | 28.70 ± 1.13 | 42.30 ± 0.44 | NA | 7.90 ± 2.78 | 3.86 ± 3.62 | NA | ∞ | 26.92 ± 7.52 |
| GIN+EU | ∞ | 47.73 ± 7.86 | 49.26 ± 4.02 | NA | 20.62 ± 2.41 | 6.19 ± 8.32 | NA | ∞ | 33.92 ± 7.34 |
| PNA | ∞ | 56.77 ± 2.41 | 59.71 ± 1.91 | NA | 16.45 ± 1.46 | 27.73 ± 1.65 | NA | ∞ | 51.49 ± 4.29 |
| LightGBM | — | 21.30 ± 0.30 | 18.60 ± 0.10 | 24.50 ± 0.20 | 2.05 ± 0.81 | 3.3 ± 0.48 | 4.04 ± 0.16 | — | 13.74 ± 0.54 |
| **GFP+LightGBM** | 128 | 62.86 ± 0.25 | 59.48 ± 0.15 | **58.03 ± 0.19** | 20.83 ± 1.50 | 24.74 ± 0.46 | **23.67 ± 0.11** | 128 | 40.17 ± 0.22 |
| **GFP+LightGBM** | 2048 | 60.52 ± 0.59 | 56.12 ± 0.37 | 54.76 ± 0.08 | 17.99 ± 0.60 | 21.06 ± 0.08 | 22.65 ± 0.59 | ∞ | **51.00 ± 1.01** |
| XGBoost | — | 19.75 ± 0.89 | 20.10 ± 0.22 | 10.61 ± 6.73 | 0.21 ± 0.22 | 0.40 ± 0.14 | 0.00 ± 0.00 | — | 15.52 ± 0.15 |
| **GFP+XGBoost** | 128 | 63.23 ± 0.17 | **65.69 ± 0.26** | 42.68 ± 12.93 | 27.28 ± 0.69 | **31.03 ± 0.22** | **24.23 ± 0.12** | 128 | 37.01 ± 2.45 |
| **GFP+XGBoost** | 2048 | **64.77 ± 0.47** | 59.19 ± 0.29 | 56.88 ± 0.21 | **28.25 ± 0.80** | 21.36 ± 0.90 | 22.64 ± 0.15 | ∞ | 49.40 ± 0.54 |

**핵심 관찰**:

본 그래프 기반 피처는 그래디언트 부스팅 모델이 달성하는 F1 점수의 상당한 개선을 이끕니다.

- 그래프 기반 피처가 없을 때 LightGBM과 XGBoost가 달성하는 최대 F1 점수는 **AML HI 데이터셋에서 24.5%**, **AML LI 데이터셋에서 4.04%**입니다. 이 낮은 정확도의 이유는 AML 데이터셋의 라벨이 매우 불균형하고, 이 데이터셋의 불법 거래 수가 전체 거래 수의 **최대 0.13%**에 불과하기 때문입니다(Table 1 참조).
- LightGBM과 XGBoost가 기본 피처에 더해 그래프 기반 피처를 사용하는 본 그래프 ML 파이프라인은, 그러한 피처가 없는 모델보다 **최대 46% 높은 F1 점수**를 달성합니다.
- 나아가 XGBoost 모델을 사용하는 본 그래프 ML 파이프라인은 GNN 베이스라인보다 **일관되게 높은 F1 점수**를 달성합니다. 가장 높은 정확도의 GNN 베이스라인인 **PNA와 비교하여**, XGBoost를 사용하는 본 그래프 ML 파이프라인은 AML HI 데이터셋에서 **최대 8% 높은 F1 점수**를, LI 데이터셋에서 **최대 11.8% 높은 F1 점수**를 달성합니다.

### 피처 유형별 효과 (Ablation)

GFP가 생성하는 서로 다른 유형의 그래프 기반 피처가 AML 과제에 대한 본 그래프 ML 파이프라인의 정확도에 미치는 효과는 Table 5에 나타납니다.

**Table 5: GFP가 생성하는 서로 다른 그래프 기반 피처가 자금세탁 탐지 정확도에 미치는 효과를 보여주는 본 그래프 ML 파이프라인의 소수 클래스 F1 점수 (%)**

다중 홉 패턴 피처는 단순 순환, 시계열 순환, scatter-gather 패턴에 기반한 피처를 포함합니다.

| 데이터셋 | AML HI Small LightGBM 128 | AML HI Small LightGBM 2048 | AML HI Small XGBoost 128 | AML HI Small XGBoost 2048 | AML HI Medium LightGBM 128 | AML HI Medium LightGBM 2048 | AML HI Medium XGBoost 128 | AML HI Medium XGBoost 2048 | ETH LightGBM ∞ | ETH XGBoost ∞ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 기본 피처 | 21.30 ± 0.30 | 21.30 ± 0.30 | 19.75 ± 0.89 | 19.75 ± 0.89 | 18.60 ± 0.10 | 18.60 ± 0.10 | 20.10 ± 0.22 | 20.10 ± 0.22 | 13.74 ± 0.54 | 15.52 ± 0.15 |
| + fan-in/fan-out 피처 | 50.85 ± 0.83 | 49.73 ± 1.20 | 56.88 ± 0.66 | 59.71 ± 0.07 | 46.71 ± 0.17 | 50.59 ± 0.36 | 53.00 ± 0.08 | 55.25 ± 0.19 | 35.92 ± 1.96 | 40.66 ± 0.94 |
| + 다중 홉 패턴 피처 | 54.66 ± 0.39 | 55.54 ± 0.55 | 58.60 ± 0.15 | 61.01 ± 0.24 | 47.47 ± 0.21 | 51.40 ± 0.15 | 55.42 ± 0.23 | 55.92 ± 0.26 | 39.46 ± 0.27 | 42.76 ± 0.48 |
| + 정점 통계 기반 피처 | **62.86 ± 0.25** | **60.52 ± 0.59** | **63.23 ± 0.17** | **64.77 ± 0.47** | **59.48 ± 0.15** | **56.12 ± 0.37** | **65.70 ± 0.26** | **59.19 ± 0.29** | **51.00 ± 1.01** | **49.40 ± 0.54** |

**핵심 관찰**:

- **fan-in 및 fan-out 패턴에 기반한 그래프 피처를 포함하는 것만으로도** 기본 거래 피처만 사용하는 경우에 비해 소수 클래스 F1 점수가 **30% 이상** 개선됩니다.
- **다중 홉 그래프 패턴 피처**(순환과 scatter-gather 패턴 기반 피처)를 포함하면 F1 점수가 **최대 4% 추가 개선**됩니다.
- 최종적으로 **GFP가 생성하는 정점 통계 기반 피처를 통합**함으로써, 본 그래프 ML 파이프라인은 PNA 베이스라인 대비 더 높은 정확도를 달성할 수 있습니다(Table 4 참조).

따라서 **각 유형의 그래프 기반 피처가 본 그래프 ML 파이프라인의 전체 정확도에 기여**합니다.

### 처리량 (Throughput)

Fig. 8은 본 그래프 ML 파이프라인과 GNN 베이스라인의 처리량을 보여줍니다.

- 본 그래프 ML 파이프라인의 성능은 IBM Cloud에서 사용 가능한 **Cascade Lake Intel Xeon Processor의 64 소프트웨어 스레드**를 사용하여 평가되었습니다.
- GNN 베이스라인의 성능은 **NVIDIA Tesla V100 GPU**에서 평가되었습니다.

본 그래프 ML 파이프라인은 **2048 배치로 거래를 받을 때 GNN 베이스라인보다 높은 처리량을 달성**할 수 있음을 관찰합니다. 이 처리량은 Fig. 9에서 보듯 GFP가 사용하는 확장 가능한 병렬 그래프 패턴 마이닝 알고리즘의 결과입니다.

> **Fig. 8** — 본 그래프 ML 파이프라인은 V100 GPU에서 실행된 GNN 베이스라인 대비 더 높은 처리량을 가집니다.

### 확장성 (Scalability)

Fig. 9는 또한 **§2.2에서 도입한 스트리밍 scatter-gather 알고리즘이 배치 크기가 무한일 때 소프트웨어 스레드 수에 대해 거의 선형적으로 확장**됨을 보여줍니다.

이러한 확장성의 결과로, AML 데이터셋의 **128 거래 배치 처리 평균 지연시간은 30 ms**, **2048 거래 배치는 143 ms**입니다. 낮은 지연시간으로 거래 배치를 처리할 수 있다는 점이 **GFP를 실시간 처리에 적합**하게 만듭니다.

> **Fig. 9** — GFP 라이브러리의 서로 다른 부분 실행 및 종단간 실행의 확장성. 속도 향상은 단일 스레드 실행 대비 상대값입니다. (Scatter-Gather 열거 / Simple cycle 열거 / Temporal cycle 열거 / End-to-end, AML HI Small 및 HI Medium, batch size = 2048 및 ∞)

### 설명 가능성 (Explainability)

본 그래프 ML 파이프라인의 이점은 **설명 가능한 결과**를 생성한다는 점입니다. **SHAP 라이브러리**를 사용하여, 거래를 불법으로 플래그하는 데 사용된 그래디언트 부스팅 기반 모델의 피처 중요도를 얻을 수 있습니다.

예컨대 Fig. 10에서 거래를 불법으로 플래그하는 데 사용된 **가장 중요한 두 피처**는 다음과 같습니다.

1. **2홉 시계열 순환의 수 (Temporal Cycle length 2)** — SHAP 값 +0.14
2. **목표 계좌가 수신한 금액의 합을 나타내는 정점 통계 피처 (Target Sum amountRecUSD Out)** — SHAP 값 +0.17

사기 탐지 시스템에서 의사결정을 설명하는 것은 분석가가 시스템의 결정을 검증할 수 있게 하므로 **신뢰 증진에 결정적**입니다.

> **Fig. 10** — AML HI Small 거래를 불법으로 플래그하기 위해 GFP+LightGBM 설정이 사용한 피처의 중요도 (SHAP 값)
>
> 주요 피처 순위:
> - Target Sum amountRecUSD Out: **+0.17**
> - Temporal Cycle length 2: **+0.14**
> - Payment Format: **+0.09**
> - Source Sum amountRecUSD In: **+0.06**
> - Source Var timestamp in: **+0.05**
> - Amount Received [USD]: **+0.04**
> - Amount Ratio In: **−0.04**
> - Source Ratio Out: +0.04 / Payment Currency: +0.04
> - Target Fan Out: +0.03 / Target Ratio In: +0.03
> - Target Ratio Out: +0.02 / Simple Cycle length 2: +0.02
> - Target Sum timestampOut: −0.02
> - Source Sum amountRecUSD Out: +0.02 / Amount Received: +0.02
> - Hour: +0.01 / Ratio In: −0.01 / Target Var timestamp in: −0.01
> - Sum of 113 other features: −0.02

### ETH Phishing 결과

Table 4는 ETH Phishing 데이터셋으로 학습된 ML 모델이 피싱 탐지에서 달성한 소수 클래스 F1 점수도 보여줍니다.

- **배치 크기 128**을 사용할 때, 본 그래프 기반 피처는 LightGBM과 XGBoost 양쪽에서 **20%를 초과하는 F1 점수 개선**을 가능하게 합니다.
- 배치 크기를 **∞로 설정**하면 LightGBM의 F1 점수가 **51%까지** 추가 개선됩니다. 이 경우 본 그래프 기반 피처를 사용하는 LightGBM이 **GIN+EU 베이스라인을 10% 앞서고** PNA와 경쟁력 있는 정확도를 달성합니다.
- 그러나 배치 크기를 128에서 ∞로 증가시키면 본 그래프 ML 파이프라인이 사실상 오프라인 솔루션이 됩니다. 일반적으로 **GFP의 최적 구성은 최종 응용의 요구사항에 따라 달라지며, 정확도를 위해 성능을 절충해야 할 수 있습니다.**

---

## 5. 관련 연구 (Related Work)

### 그래프 머신러닝 (Graph machine learning)

그래프 머신러닝은 금융거래 네트워크 분석, 사기 탐지, 신약 개발, 유전체학, 분자 특성 예측, 추천 시스템, 소셜 네트워크 분석, 지식 그래프의 관계 예측 등 다양한 분야에 응용됩니다.

**TitAnt**와 **Eddin 등**의 사기 탐지 시스템은, 노드 임베딩을 생성하거나 그래프에서 랜덤 워크를 수행하여 거래 그래프로부터 피처를 추출하는 그래프 머신러닝 시스템입니다. 이 피처들은 이후 머신러닝 모델이 유입되는 거래가 사기적인지 예측하는 데 사용됩니다.

### 그래프 신경망 (Graph neural networks, GNNs)

GNN은 금융범죄 탐지 목적으로 사용될 수 있는 강력한 도구입니다.

- **Cardoso 등**과 **Weber 등**은 자금세탁방지 문제에 GNN을 적용합니다.
- **Kanezashi 등**은 이더리움 블록체인의 피싱 탐지 문제에 GNN을 적용합니다.
- **Rao 등**은 사기 거래 탐지에 GNN을 사용합니다.
- **Bouritsas 등**이 제안한 **Graph Substructure Network**는 GNN의 표현력을 개선하기 위해 **사전 계산된 부분그래프 패턴 카운트**를 활용합니다.

GNN은 **Chen 등**의 연구처럼 부분그래프 패턴을 세는 데도 사용될 수 있으며, 이는 금융범죄와 연관된 패턴 탐지를 가능하게 할 수 있습니다. 그러나 **본 연구와 대조적으로 GNN은 스트리밍 방식으로 직접 작동할 수 없고, 테스트 시점에 전체 데이터셋이 사용 가능해야 합니다.**

### 동적 그래프 관리 (Dynamic graph management)

동적 그래프 관리는 금융거래의 실시간 처리에 종종 필요합니다.

- **STINGER**, **GraphTinker**, **Sortledton** 같은 동적 그래프 자료구조는 그래프에 엣지의 동적 삽입과 제거를 가능하게 합니다. 그러나 STINGER와 GraphTinker는 **동일한 출처·목적지 정점을 가진 여러 엣지의 유지를 지원하지 않으므로** 금융거래 그래프 표현에 직접 사용될 수 없습니다.
- **인메모리 그래프 데이터베이스**도 동적 그래프 관리에 사용될 수 있습니다. Bing의 분산 인메모리 그래프 데이터베이스 **A1**은 수십억 정점·엣지를 포함하는 진화하는 그래프를 유지하기 위해 고속 **RDMA(Remote Direct Memory Access)**를 활용합니다. LinkedIn의 인메모리 그래프 데이터베이스는 그래프에 대한 저지연 읽기·쓰기 연산을 가능하게 하고 그래프의 **N-ary 관계** 표현을 지원합니다. 본 연구의 동적 그래프 자료구조는 N-ary 관계 지원을 필요로 하지 않으므로 **더 단순한 방식으로 구현**될 수 있습니다.

---

## 6. 결론 (Conclusions)

본 논문은 동적으로 변화하는 거래 그래프로부터 빠른 피처 추출을 위한 소프트웨어 라이브러리 **Graph Feature Preprocessor (GFP)**를 제시했습니다.

빠른 피처 추출을 달성하기 위해, 본 라이브러리는 **인메모리 동적 멀티그래프 표현**과 **세밀 병렬 부분그래프 열거 알고리즘**을 활용합니다. GFP는 본 그래프 ML 파이프라인이 실험에서 제시된 GNN 베이스라인 대비 **낮은 배치당 지연시간과 높은 처리량**으로 스트리밍 방식으로 작동할 수 있게 합니다. 이 능력은 **GFP를 실시간 처리가 필요한 시나리오에 적합**하게 만듭니다.

또한 GFP가 생성하는 그래프 기반 피처가 그래디언트 부스팅 기반 머신러닝 모델의 정확도를 상당히 개선할 수 있음을 보였습니다.

- 그래프 기반 피처는 그래디언트 부스팅 기반 머신러닝 모델의 소수 클래스 F1 점수를 합성 AML 데이터셋에서 **최대 46%**, 이더리움에서 추출한 실세계 피싱 탐지 데이터셋에서 **최대 35%** 개선합니다.
- 나아가 본 솔루션은 AML 과제에서 GNN 베이스라인보다 **최대 36% 높은 F1 점수**를 달성합니다.
- 특히 본 그래프 ML 파이프라인은 자금세탁방지를 위해 특별히 설계된 GNN인 **LaundroGraph**와 유사한 아키텍처를 가진 **GIN+EU 베이스라인 대비 최대 24% 높은 소수 클래스 F1 점수**를 달성합니다.

### 향후 과제

GFP 라이브러리의 응용 범위는 자금세탁 탐지에 국한되지 않습니다. 그래프의 순환이 조세 회피, 순환 거래, 신용카드 사기의 지표가 될 수 있으므로, GFP는 이러한 유형의 사기 탐지에도 도움이 될 수 있습니다.

그러나 순환 같은 **사전 정의된 부분그래프 패턴에 의존한다는 점이 본 라이브러리의 한 가지 단점**이며, 이를 향후 과제의 일부로 **사용자 정의 부분그래프 패턴을 사용한 부분그래프 매칭 지원을 GFP에 추가**하여 해결할 계획입니다.

나아가 **클리크(clique)**와 **바이클리크(biclique)** 같은 추가 부분그래프 패턴에 기반한 피처 추출 지원도 추가할 계획입니다. 이러한 패턴을 열거할 수 있게 되면, 다양한 금융범죄 시나리오에서 마주치는 **밀접하게 결합된 커뮤니티**와 **누적된(stacked) 자금세탁 패턴** 탐지가 가능해질 수 있습니다.

---

## 감사의 말 (Acknowledgments)

스위스 국립과학재단(Swiss National Science Foundation, 프로젝트 번호 172610)의 지원에 감사드립니다. 저자들은 본 연구 과정에서 지원, 피드백, 제안을 제공한 IBM의 Donna Eng Dillenberger, Thomas Parnell, Martin Petermann, Erwin Rivera, Elpida Tzortzatos에게 감사를 표합니다.

---

## 참고문헌 (References)

원문에는 86개 참고문헌이 수록되어 있습니다. 주요 문헌은 다음과 같습니다.

- **[1]** Erik Altman, Jovan Blanuša, Luc von Niederhäusern, Béni Egressy, Andreea Anghel, Kubilay Atasu. 2023. *Realistic Financial Transactions for Anti-Money Laundering Models.* NeurIPS'23 Datasets and Benchmarks Track. — **AMLworld 데이터셋**
- **[6]** Jovan Blanuša, Paolo Ienne, Kubilay Atasu. 2022. *Manycore Clique Enumeration with Fast Set Intersections.* / *Scalable Fine-Grained Parallel Cycle Enumeration Algorithms.* SPAA'22. — **세밀 병렬 순환 열거 알고리즘**
- **[7]** Jovan Blanuša, Kubilay Atasu, Paolo Ienne. 2023. *Fast Parallel Algorithms for Enumeration of Simple, Temporal, and Hop-constrained Cycles.* ACM Trans. Parallel Comput. 10, 3.
- **[8]** Giorgos Bouritsas, Fabrizio Frasca, Stefanos Zafeiriou, Michael M. Bronstein. 2023. *Improving Graph Neural Network Expressivity via Subgraph Isomorphism Counting.* IEEE TPAMI 45, 1. — **Graph Substructure Network**
- **[12]** Mário Cardoso, Pedro Saleiro, Pedro Bizarro. 2022. *LaundroGraph: Self-Supervised Graph Representation Learning for Anti-Money Laundering.* ICAIF'22. — **AML 특화 GNN 베이스라인**
- **[16]** Tianqi Chen, Carlos Guestrin. 2016. *XGBoost: A Scalable Tree Boosting System.* KDD'16.
- **[22]** Gabriele Corso, Luca Cavalleri, Dominique Beaini, Pietro Liò, Petar Veličković. 2020. *Principal Neighbourhood Aggregation for Graph Nets.* NeurIPS. — **PNA 베이스라인**
- **[25]** David Ediger, Rob McColl, Jason Riedy, David A. Bader. 2012. *STINGER: High performance data structure for streaming graphs.* HPEC.
- **[29]** Per Fuchs, Domagoj Margan, Jana Giceva. 2022. *Sortledton: a universal, transactional graph data structure.* VLDB Endow. 15, 6.
- **[35]** Keyulu Xu, Weihua Hu, Jure Leskovec, Stefanie Jegelka. 2018. *How powerful are graph neural networks?* arXiv:1810.00826. — **GIN 베이스라인**
- **[36]** IBM. 2023. *AI Toolkit for IBM Z and LinuxONE.*
- **[37]** IBM. 2023. *Cloud Pak for Data.*
- **[40]** Kevin Jamieson, Robert Nowak. 2014. *Best-arm identification algorithms for multi-armed bandits in the fixed confidence setting.* CISS. — **successive halving**
- **[43]** Guolin Ke 등. 2017. *LightGBM: A Highly Efficient Gradient Boosting Decision Tree.* NeurIPS.
- **[52]** Scott M Lundberg, Su-In Lee. 2017. *A Unified Approach to Interpreting Model Predictions.* NeurIPS. — **SHAP**
- **[64][65][66]** IBM Research. 2022. *Graph Feature Preprocessor Public Examples / Documentation / Snap ML PyPI package.* — **GFP 공개 자료**
- **[68]** Evan Rivera, Jovan Blanuša, Jawaharlal Rajan, Alexis Landis, Haris Pozidis. 2024. *AI on IBM Z Anti-Money Laundering Solution Template.* — **오픈소스 템플릿**
- **[72]** Michele Starnini, Charalampos E. Tsourakakis 등. 2021. *Smurf-Based Anti-money Laundering in Time-Evolving Transaction Networks.* ECML PKDD. — **scatter-gather / 스머핑**
- **[73]** Shixuan Sun, Qiong Luo. 2020. *In-Memory Subgraph Matching: An In-depth Study.* SIGMOD.
- **[74]** Toyotaro Suzumura, Hiroki Kanezashi. *Anti-Money Laundering Datasets: InPlusLab Anti-Money Laundering DataDatasets.*
- **[80]** Mark Weber 등. 2019. *Anti-money laundering in bitcoin: Experimenting with graph convolutional networks for financial forensics.* arXiv:1908.02591.
- **[82]** Xblock. 2024. *Ethereum Phishing Transaction Network.* — **ETH Phishing 데이터셋**

전체 목록은 원문 9~11페이지를 참조하십시오.

---

### 번역 참고사항

- 본 문서는 원문의 구조(초록 → 서론 → GFP → 실험 설정 → 결과 → 관련 연구 → 결론)를 그대로 유지했습니다.
- 표(Table 1~5)와 Algorithm 1의 모든 수치·의사코드는 원문 그대로 옮겼습니다.
- 기술 용어는 한국어 번역 후 첫 등장 시 영어 원어를 병기했습니다.
- 원문의 그림(Fig. 1~10)은 이미지이므로 캡션과 본문 내 설명, 그리고 Fig. 10의 SHAP 수치를 텍스트로 옮겼습니다. 그림 자체는 원문 PDF를 참조하십시오.
