# SAML-D 상세 EDA 보고서

실행 노트북: [SAML_D_상세_EDA.ipynb](SAML_D_상세_EDA.ipynb)  
분석 완료: **2026-09-17T08:00:00.959217+00:00 (UTC)**  
원본: `/workspace/SAML-D.csv` · 996,168,850바이트

이 보고서는 노트북을 실제 실행해 저장한 전체 데이터 집계와 그래프를 정리했다. 원본을 수정하거나 모델을 학습하지 않았다. 표와 그림은 한글로 표시하되 **양성 패턴명은 원본 영문 이름**을 유지한다. 마지막 부록에는 분석 코드도 함께 수록했다.


## 1. 핵심 결과와 분석 범위

- 전체 **9,504,852건**, 양성 **9,873건 (0.1039%)**.
- 관측 기간: **2022-10-07 10:35:19 ~ 2023-08-23 10:57:12**.
- 고유 계좌 ID **855,460개**. 여러 은행 위치에서 관측된 ID **6,507개**.
- 완전 중복 초과 행 **0건**, 동일 입력의 이진 라벨 충돌 **0그룹**.
- 집계 검증 **8개 통과**. SQL 집계는 전체 원본 대상이며 금액 히스토그램만 명시된 표본을 사용한다.

DuckDB로 전체 원본을 집계하고 pandas·Matplotlib로 표·그래프를 만들었다. 계좌 ID는 문자열로 보존했다. 정규화 계수 학습이나 모델 평가를 위한 데이터 분할을 확정하는 보고서는 아니다.


## 2. 원본 컬럼과 데이터 품질

원본은 12개 컬럼이다. 결측, 공백, 결측 유사 문자열, 앞뒤 공백, 고유값 수를 각각 검사했다. 숫자처럼 보이는 계좌 ID도 연속형 수치로 취급하지 않는다.

| 컬럼 | 결측 수 | 공백만 있는 행 | 결측 유사 문자열 | 앞뒤 공백 | 고유값 수 |
| --- | --- | --- | --- | --- | --- |
| 시각 | 0 | 0 | 0 | 0 | 86,400 |
| 날짜 | 0 | 0 | 0 | 0 | 321 |
| 송신 계좌 ID | 0 | 0 | 0 | 0 | 292,715 |
| 수신 계좌 ID | 0 | 0 | 0 | 0 | 652,266 |
| 원본 금액 | 0 | 0 | 0 | 0 | 2,314,277 |
| 지급 통화 | 0 | 0 | 0 | 0 | 13 |
| 수취 통화 | 0 | 0 | 0 | 0 | 13 |
| 송신 은행 위치 | 0 | 0 | 0 | 0 | 18 |
| 수신 은행 위치 | 0 | 0 | 0 | 0 | 18 |
| 지급 방식 | 0 | 0 | 0 | 0 | 7 |
| 세탁 여부 원본 | 0 | 0 | 0 | 0 | 2 |
| 거래 유형 | 0 | 0 | 0 | 0 | 28 |

[전체 CSV](notebook_outputs/column_quality.csv)

![컬럼별 결측·공백 검사: 0이면 해당 검사에서 문제 없음](notebook_outputs/01_quality.png)

*컬럼별 결측·공백 검사: 0이면 해당 검사에서 문제 없음* · [PDF](notebook_outputs/01_quality.pdf)


## 3. 기본 통계·변환 오류·계좌 ID 형식

날짜·금액 변환 실패와 비유한값, 비정상 라벨, 음수·0원 금액을 확인했다. 아래 0건은 해당 검사를 통과했다는 뜻이며 데이터의 모든 의미적 오류가 없다는 보장은 아니다.

| 항목 | 값 |
| --- | --- |
| 전체 거래 수 | 9504852 |
| 첫 거래 일시 | 2022-10-07 10:35:19 |
| 마지막 거래 일시 | 2023-08-23 10:57:12 |
| 양성 거래 수 | 9873 |
| 정상 거래 수 | 9494979 |
| 날짜·시간 변환 실패 | 0 |
| 금액 변환 실패·비유한값 | 0 |
| 비정상 정답 | 0 |
| 음수 금액 | 0 |
| 0원 거래 | 0 |
| 자기 계좌 거래 | 0 |

non_digits는 숫자 외 문자가 들어간 ID의 등장 행 수, leading_zero는 선행 0이 있는 등장 행 수다. 선행 0은 삭제 대상이 아니다.

| 역할 | 숫자 외 문자 포함 행 | 선행 0이 있는 행 | 고유 계좌 ID 수 |
| --- | --- | --- | --- |
| 송신 | 0 | 0 | 292,715 |
| 수신 | 0 | 0 | 652,266 |

[전체 CSV](notebook_outputs/id_quality.csv)


## 4. 클래스 불균형

| 정답(0 정상·1 양성) | 거래 수 |
| --- | --- |
| 0 | 9,494,979 |
| 1 | 9,873 |

[전체 CSV](notebook_outputs/labels.csv)

![정상·양성 거래 수(로그 축)와 전체 대비 비율](notebook_outputs/02_class_balance.png)

*정상·양성 거래 수(로그 축)와 전체 대비 비율* · [PDF](notebook_outputs/02_class_balance.pdf)

양성이 약 0.104%인 불균형 데이터다. 정상만 예측해도 높은 정확도가 나올 수 있으므로 향후 모델 평가는 정밀도·재현율·PR-AUC 등을 함께 봐야 한다. 이 보고서는 모델 성능을 측정하지 않았다.


## 5. 시간 분포: 일별·월별·요일·시간대

첫날·마지막 날의 거래 시각과 거래량을 확인한다. 기간 경계가 하루 전체를 포함하지 않더라도 자동으로 삭제하지 않았다.

| 날짜 | 거래 수 | 양성 거래 수 | 양성 비율(%) | 당일 첫 거래 | 당일 마지막 거래 |
| --- | --- | --- | --- | --- | --- |
| 2022-10-07 | 20,892 | 27 | 0.1292 | 2022-10-07 10:35:19 | 2022-10-07 23:59:55 |
| 2023-08-23 | 8,400 | 7 | 0.0833 | 2023-08-23 00:00:01 | 2023-08-23 10:57:12 |

[전체 일별 집계 CSV](notebook_outputs/daily.csv). 일별 표의 모든 행 대신 월별 요약과 전체 시계열을 아래에 제시한다.

| 월 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 2022-10 | 708,654 | 694 | 0.0979 |
| 2022-11 | 897,621 | 794 | 0.0885 |
| 2022-12 | 900,341 | 907 | 0.1007 |
| 2023-01 | 908,320 | 940 | 0.1035 |
| 2023-02 | 904,806 | 946 | 0.1046 |
| 2023-03 | 908,562 | 927 | 0.102 |
| 2023-04 | 902,883 | 962 | 0.1065 |
| 2023-05 | 917,601 | 866 | 0.0944 |
| 2023-06 | 897,243 | 1,024 | 0.1141 |
| 2023-07 | 902,239 | 983 | 0.109 |
| 2023-08 | 656,582 | 830 | 0.1264 |

[전체 CSV](notebook_outputs/monthly.csv)

![일별 전체 거래 수·양성 거래 수·양성 비율](notebook_outputs/03_daily.png)

*일별 전체 거래 수·양성 거래 수·양성 비율* · [PDF](notebook_outputs/03_daily.pdf)

거래 수와 비율은 다른 지표다. 양성 건수가 늘어도 전체 거래량 증가 때문일 수 있으므로 비율을 함께 확인한다.

| 시간대 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 0 | 121,548 | 136 | 0.1119 |
| 1 | 121,964 | 122 | 0.1 |
| 2 | 121,627 | 138 | 0.1135 |
| 3 | 121,282 | 138 | 0.1138 |
| 4 | 121,568 | 126 | 0.1036 |
| 5 | 122,114 | 140 | 0.1146 |
| 6 | 121,484 | 146 | 0.1202 |
| 7 | 142,497 | 222 | 0.1558 |
| 8 | 538,992 | 632 | 0.1173 |
| 9 | 539,044 | 527 | 0.0978 |
| 10 | 539,942 | 589 | 0.1091 |
| 11 | 539,901 | 599 | 0.1109 |
| 12 | 538,855 | 577 | 0.1071 |
| 13 | 540,796 | 601 | 0.1111 |
| 14 | 540,282 | 566 | 0.1048 |
| 15 | 539,480 | 516 | 0.0956 |
| 16 | 539,647 | 556 | 0.103 |
| 17 | 539,364 | 579 | 0.1073 |
| 18 | 519,658 | 494 | 0.0951 |
| 19 | 519,059 | 497 | 0.0958 |
| 20 | 518,346 | 456 | 0.088 |
| 21 | 518,362 | 516 | 0.0995 |
| 22 | 519,870 | 501 | 0.0964 |
| 23 | 519,170 | 499 | 0.0961 |

[전체 CSV](notebook_outputs/hourly.csv)

| 요일 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 1 | 1,389,246 | 1,472 | 0.106 |
| 2 | 1,369,343 | 1,424 | 0.104 |
| 3 | 1,366,034 | 1,433 | 0.1049 |
| 4 | 1,350,706 | 1,455 | 0.1077 |
| 5 | 1,369,872 | 1,483 | 0.1083 |
| 6 | 1,336,623 | 1,310 | 0.098 |
| 7 | 1,323,028 | 1,296 | 0.098 |

[전체 CSV](notebook_outputs/weekday.csv)

![시간대·요일별 양성 비율: 요일 번호 1은 월요일](notebook_outputs/04_hour_weekday.png)

*시간대·요일별 양성 비율: 요일 번호 1은 월요일* · [PDF](notebook_outputs/04_hour_weekday.pdf)


## 6. 거래 유형과 이진 라벨

| 거래 유형 | 정상 거래 수 | 양성 거래 수 |
| --- | --- | --- |
| Behavioural_Change_1 | 0 | 394 |
| Behavioural_Change_2 | 0 | 345 |
| Bipartite | 0 | 383 |
| Cash_Withdrawal | 0 | 1,334 |
| Cycle | 0 | 382 |
| Deposit-Send | 0 | 945 |
| Fan_In | 0 | 364 |
| Fan_Out | 0 | 237 |
| Gather-Scatter | 0 | 354 |
| Layered_Fan_In | 0 | 656 |
| Layered_Fan_Out | 0 | 529 |
| 정상 현금 입금 | 223,801 | 0 |
| 정상 현금 인출 | 305,031 | 0 |
| 정상 다수→단일 유입 | 2,104,285 | 0 |
| 정상 단일→다수 유출 | 2,302,220 | 0 |
| 정상 전달 | 42,031 | 0 |
| 정상 그룹 | 528,351 | 0 |
| 정상 상호 거래 | 125,335 | 0 |
| 정상 주기 거래 | 210,526 | 0 |
| 정상 추가 상호 거래 | 155,041 | 0 |
| 정상 소규모 분산 | 3,477,717 | 0 |
| 정상 단일 고액 | 20,641 | 0 |
| Over-Invoicing | 0 | 54 |
| Scatter-Gather | 0 | 338 |
| Single_large | 0 | 250 |
| Smurfing | 0 | 932 |
| Stacked Bipartite | 0 | 506 |
| Structuring | 0 | 1,870 |

유형별 건수는 **거래 건수**이며 독립 사건·작전 개수가 아니다. SAML-D 원본에는 작전 ID가 없어 같은 유형의 거래를 동일 사건이라고 단정할 수 없다. 유형명 한글 번역은 표시용 설명이며 상세 생성 규칙을 확정하는 정의가 아니다.

![정상 유형과 양성 패턴별 거래 건수: 양성 패턴명은 영문 유지](notebook_outputs/05_type_distribution.png)

*정상 유형과 양성 패턴별 거래 건수: 양성 패턴명은 영문 유지* · [PDF](notebook_outputs/05_type_distribution.pdf)

정상·양성 라벨이 혼재한 유형은 **0개**다. `Is_laundering`과 `Laundering_type`은 정답 성격의 정보이므로 입력 피처에서 제외해야 한다.


## 7. 월별 양성 패턴 구성

| 거래 유형 | 2022-10 | 2022-11 | 2022-12 | 2023-01 | 2023-02 | 2023-03 | 2023-04 | 2023-05 | 2023-06 | 2023-07 | 2023-08 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Behavioural_Change_1 | 48 | 21 | 36 | 32 | 17 | 26 | 64 | 24 | 57 | 53 | 16 |
| Behavioural_Change_2 | 20 | 22 | 28 | 31 | 30 | 13 | 44 | 33 | 57 | 45 | 22 |
| Bipartite | 14 | 18 | 64 | 40 | 41 | 49 | 59 | 43 | 29 | 18 | 8 |
| Cash_Withdrawal | 74 | 138 | 118 | 147 | 106 | 145 | 81 | 125 | 151 | 110 | 139 |
| Cycle | 15 | 1 | 54 | 46 | 59 | 44 | 24 | 58 | 32 | 41 | 8 |
| Deposit-Send | 54 | 90 | 69 | 85 | 96 | 104 | 105 | 86 | 81 | 107 | 68 |
| Fan_In | 34 | 26 | 54 | 13 | 12 | 23 | 65 | 53 | 45 | 11 | 28 |
| Fan_Out | 10 | 13 | 29 | 3 | 19 | 10 | 8 | 22 | 61 | 16 | 46 |
| Gather-Scatter | 22 | 47 | 34 | 12 | 42 | 33 | 33 | 8 | 38 | 44 | 41 |
| Layered_Fan_In | 28 | 45 | 45 | 43 | 111 | 98 | 61 | 55 | 57 | 66 | 47 |
| Layered_Fan_Out | 53 | 48 | 78 | 35 | 69 | 52 | 25 | 39 | 28 | 56 | 46 |
| Over-Invoicing | 2 | 8 | 3 | 5 | 4 | 3 | 4 | 11 | 6 | 4 | 4 |
| Scatter-Gather | 11 | 3 | 25 | 41 | 46 | 41 | 49 | 35 | 37 | 40 | 10 |
| Single_large | 22 | 32 | 20 | 34 | 19 | 24 | 22 | 21 | 21 | 26 | 9 |
| Smurfing | 65 | 77 | 54 | 127 | 90 | 88 | 84 | 84 | 104 | 78 | 81 |
| Stacked Bipartite | 55 | 40 | 31 | 77 | 3 | 24 | 35 | 50 | 53 | 54 | 84 |
| Structuring | 167 | 165 | 165 | 169 | 182 | 150 | 199 | 119 | 167 | 214 | 173 |

![각 월의 전체 양성 대비 패턴별 구성비(%)](notebook_outputs/06_monthly_types.png)

*각 월의 전체 양성 대비 패턴별 구성비(%)* · [PDF](notebook_outputs/06_monthly_types.pdf)

히트맵은 월별 비율, 앞의 표는 건수다. 드문 패턴에서는 작은 건수 차이로도 비율이 변할 수 있다.


## 8. 지급 통화·수취 통화·지급 방식

### 지급 통화

| 범주 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 영국 파운드 | 9,099,293 | 8,830 | 0.097 |
| 유로 | 117,164 | 260 | 0.2219 |
| 튀르키예 리라 | 27,996 | 73 | 0.2608 |
| 스위스 프랑 | 27,492 | 82 | 0.2983 |
| 디르함 | 27,263 | 89 | 0.3264 |
| 파키스탄 루피 | 27,196 | 62 | 0.228 |
| 나이지리아 나이라 | 27,143 | 62 | 0.2284 |
| 미국 달러 | 26,061 | 60 | 0.2302 |
| 일본 엔 | 25,562 | 65 | 0.2543 |
| 모로코 디르함 | 25,395 | 90 | 0.3544 |
| 멕시코 페소 | 24,852 | 68 | 0.2736 |
| 알바니아 레크 | 24,778 | 64 | 0.2583 |
| 인도 루피 | 24,657 | 68 | 0.2758 |

[전체 CSV](notebook_outputs/Payment_currency.csv)

![지급 통화별 거래 수와 양성 비율](notebook_outputs/07_Payment_currency.png)

*지급 통화별 거래 수와 양성 비율* · [PDF](notebook_outputs/07_Payment_currency.pdf)

### 수취 통화

| 범주 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 영국 파운드 | 8,783,655 | 6,919 | 0.0788 |
| 유로 | 231,911 | 716 | 0.3087 |
| 파키스탄 루피 | 45,993 | 204 | 0.4435 |
| 일본 엔 | 45,814 | 118 | 0.2576 |
| 모로코 디르함 | 45,748 | 285 | 0.623 |
| 알바니아 레크 | 45,736 | 262 | 0.5729 |
| 멕시코 페소 | 45,255 | 235 | 0.5193 |
| 나이지리아 나이라 | 45,046 | 288 | 0.6393 |
| 인도 루피 | 43,757 | 172 | 0.3931 |
| 미국 달러 | 43,664 | 118 | 0.2702 |
| 스위스 프랑 | 42,931 | 113 | 0.2632 |
| 디르함 | 42,797 | 225 | 0.5257 |
| 튀르키예 리라 | 42,545 | 218 | 0.5124 |

[전체 CSV](notebook_outputs/Received_currency.csv)

![수취 통화별 거래 수와 양성 비율](notebook_outputs/07_Received_currency.png)

*수취 통화별 거래 수와 양성 비율* · [PDF](notebook_outputs/07_Received_currency.pdf)

### 지급 방식

| 범주 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- |
| 신용카드 | 2,012,909 | 1,136 | 0.0564 |
| 직불카드 | 2,012,103 | 1,124 | 0.0559 |
| 수표 | 2,011,419 | 1,087 | 0.054 |
| 자동이체(ACH) | 2,008,807 | 1,159 | 0.0577 |
| 국경 간 거래 | 933,931 | 2,628 | 0.2814 |
| 현금 인출 | 300,477 | 1,334 | 0.444 |
| 현금 입금 | 225,206 | 1,405 | 0.6239 |

[전체 CSV](notebook_outputs/Payment_type.csv)

![지급 방식별 거래 수와 양성 비율](notebook_outputs/07_Payment_type.png)

*지급 방식별 거래 수와 양성 비율* · [PDF](notebook_outputs/07_Payment_type.pdf)

범주별 비율은 해당 범주의 전체 거래를 분모로 한다. 거래량이 적은 범주의 높은 비율을 그대로 위험 점수나 인과 효과로 해석하지 않는다.


## 9. 통화별 금액 분포와 극단값

금액은 지급 통화별로 분리해 분석했다. `Amount`가 어느 통화 기준인지는 이 EDA만으로 확정하지 않으며 데이터 명세와 대조할 항목이다. 환율 보정은 하지 않았다. 분위수·극값·평균은 전체 유효 금액으로 계산했다.

### 정상 거래 금액 분위수

| 지급 통화 | 거래 수 | 최솟값 | 1백분위수 | 25백분위수 | 중앙값 | 75백분위수 | 95백분위수 | 99백분위수 | 99.9백분위수 | 최댓값 | 평균 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 알바니아 레크 | 24,714 | 18.82 | 119.2842 | 3,903.935 | 7,154.855 | 11,633.075 | 23,832.511 | 48,922.2801 | 238,321.6739 | 935,820.72 | 9,615.5981 |
| 디르함 | 27,174 | 17.17 | 159.7833 | 4,593.8375 | 7,161.275 | 11,694.1625 | 23,679.2715 | 49,462.5739 | 251,564.1485 | 956,193 | 9,907.2176 |
| 유로 | 116,904 | 9.15 | 172.9233 | 4,972.83 | 7,642.735 | 12,156.18 | 25,429.531 | 53,604.7423 | 296,221.6464 | 995,675.88 | 10,523.2693 |
| 인도 루피 | 24,589 | 13.41 | 161.4128 | 4,646.09 | 7,323.48 | 11,936.55 | 24,032.4 | 55,993.2252 | 341,286.6594 | 985,678.03 | 10,217.4464 |
| 멕시코 페소 | 24,784 | 5.9 | 122.5754 | 4,632.9925 | 7,395.62 | 11,741.6075 | 25,546.058 | 50,473.1953 | 270,737.596 | 992,045.52 | 10,212.4665 |
| 모로코 디르함 | 25,305 | 18.17 | 123.2756 | 4,691.97 | 7,396.86 | 11,705.47 | 24,168.968 | 48,566.9428 | 248,857.6732 | 883,295.9 | 10,072.1985 |
| 나이지리아 나이라 | 27,081 | 13.91 | 146.762 | 4,792.45 | 7,657.93 | 11,907.06 | 23,989.51 | 58,323.062 | 300,286.32 | 980,326.83 | 10,438.9923 |
| 파키스탄 루피 | 27,134 | 10.14 | 174.0728 | 4,866.2825 | 7,586.685 | 11,728.3075 | 24,053.939 | 46,927.7168 | 278,474.6698 | 893,360.76 | 10,131.4418 |
| 스위스 프랑 | 27,410 | 14.01 | 172.4187 | 4,709.805 | 7,537.4 | 11,924.6125 | 24,666.959 | 52,354.1324 | 370,590.3862 | 980,925.83 | 10,391.6613 |
| 튀르키예 리라 | 27,923 | 15.25 | 119.764 | 4,565.34 | 7,232.73 | 11,747.8 | 24,141.593 | 48,043.6138 | 261,131.2985 | 990,051.52 | 9,786.1121 |
| 영국 파운드 | 9,090,463 | 3.73 | 67.92 | 2,069.505 | 6,047.08 | 10,389.445 | 21,926.029 | 44,566.6668 | 342,546.3571 | 999,962.19 | 8,664.1019 |
| 미국 달러 | 26,001 | 20.23 | 162.09 | 4,981.08 | 7,546.9 | 11,607.72 | 23,419.41 | 48,302.31 | 285,249.24 | 881,277.95 | 10,162.2084 |
| 일본 엔 | 25,497 | 10.47 | 149.9796 | 4,452.36 | 7,178.11 | 11,511.7 | 23,622.402 | 52,550.3152 | 327,510.3424 | 828,398.2 | 9,925.6662 |

### 양성 거래 금액 분위수

| 지급 통화 | 거래 수 | 최솟값 | 1백분위수 | 25백분위수 | 중앙값 | 75백분위수 | 95백분위수 | 99백분위수 | 99.9백분위수 | 최댓값 | 평균 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 알바니아 레크 | 64 | 2,800.75 | 2,855.1442 | 4,749.345 | 6,506.99 | 11,294.895 | 34,732.9392 | 52,116.9548 | 73,326.8451 | 75,683.4996 | 10,711.8036 |
| 디르함 | 89 | 2,259.18 | 2,716.5952 | 4,245.38 | 6,289.9 | 9,798.31 | 37,250.5344 | 58,730.146 | 62,454.0875 | 62,867.8587 | 10,902.3714 |
| 유로 | 260 | 1,250.41 | 2,311.9071 | 4,470.5075 | 6,497.5015 | 11,887.8375 | 66,535.6483 | 154,557.2394 | 282,278.9421 | 294,167.63 | 16,758.7144 |
| 인도 루피 | 68 | 2,618.8 | 2,631.463 | 4,088.455 | 6,020.8877 | 9,534.0818 | 23,943.5334 | 66,606.8547 | 67,532.5635 | 67,635.42 | 9,736.1775 |
| 멕시코 페소 | 68 | 2,302.4 | 2,539.044 | 5,009.025 | 6,709.145 | 11,178.06 | 41,611.1353 | 1,380,757.8273 | 1,874,037.6417 | 1,928,846.51 | 54,143.3307 |
| 모로코 디르함 | 90 | 903.59 | 1,593.4201 | 5,092.43 | 7,781.63 | 14,282.9975 | 266,510.8885 | 2,993,771.1074 | 5,592,806.5177 | 5,881,588.23 | 129,704.5768 |
| 나이지리아 나이라 | 62 | 2,291.54 | 2,548.5818 | 4,201.09 | 5,757.16 | 7,813.92 | 14,016.039 | 21,540.3105 | 29,327.2991 | 30,192.52 | 6,858.6279 |
| 파키스탄 루피 | 62 | 1,919.9 | 2,282.1302 | 4,544.7425 | 6,922.39 | 9,431.6825 | 29,467.5555 | 46,467.6594 | 50,359.5356 | 50,791.9663 | 9,650.8339 |
| 스위스 프랑 | 82 | 2,172.7567 | 2,189.4049 | 4,676.9225 | 6,871.625 | 10,020.8713 | 42,819.6454 | 4,237,820.3677 | 6,554,724.3988 | 6,812,158.18 | 137,133.2455 |
| 튀르키예 리라 | 73 | 2,652.74 | 2,667.7448 | 4,685.39 | 6,286.73 | 9,789.6733 | 38,375.8198 | 73,336.1614 | 101,740.3232 | 104,896.3412 | 11,315.2272 |
| 영국 파운드 | 8,830 | 15.82 | 46.4647 | 2,448.6675 | 5,091.06 | 9,671.085 | 38,619.4622 | 421,175.1385 | 7,253,863.6138 | 12,618,498.4 | 41,243.594 |
| 미국 달러 | 60 | 1,098.71 | 1,735.0368 | 4,547.355 | 7,641.635 | 13,367.1442 | 43,619.515 | 47,276.3807 | 47,335.5461 | 47,342.12 | 11,610.2253 |
| 일본 엔 | 65 | 2,608.19 | 2,642.302 | 4,352.05 | 6,791.24 | 12,823.7069 | 30,963.072 | 56,184.5751 | 65,807.6258 | 66,876.8537 | 11,070.9539 |

[전체 금액 분위수 CSV](notebook_outputs/amount_quantiles.csv). p01~p999는 1~99.9백분위수다.

![통화별 log10(1+금액) 분포: 정상 약 1% 표본·양성 전량](notebook_outputs/08_amount_histograms.png)

*통화별 log10(1+금액) 분포: 정상 약 1% 표본·양성 전량* · [PDF](notebook_outputs/08_amount_histograms.pdf)

히스토그램만 행 ID 해시로 정상 약 1%를 선택하고 양성은 전량 사용했다. 각 클래스의 밀도 면적이 1이므로 그래프 면적은 양성 비율을 뜻하지 않는다. log 변환은 시각화용이며 학습 변환을 확정하지 않았다.

| 지급 통화 | 거래 수 | IQR 상단 초과 거래 | 99백분위수 초과 거래 | 99백분위수 초과 양성 |
| --- | --- | --- | --- | --- |
| 알바니아 레크 | 24,778 | 1,365 | 248 | 1 |
| 디르함 | 27,263 | 1,573 | 273 | 3 |
| 유로 | 117,164 | 7,358 | 1,172 | 17 |
| 인도 루피 | 24,657 | 1,367 | 247 | 2 |
| 멕시코 페소 | 24,852 | 1,671 | 249 | 3 |
| 모로코 디르함 | 25,395 | 1,524 | 254 | 8 |
| 나이지리아 나이라 | 27,143 | 1,594 | 272 | 0 |
| 파키스탄 루피 | 27,196 | 1,663 | 272 | 1 |
| 스위스 프랑 | 27,492 | 1,653 | 275 | 4 |
| 튀르키예 리라 | 27,996 | 1,623 | 280 | 2 |
| 영국 파운드 | 9,099,293 | 409,043 | 90,993 | 382 |
| 미국 달러 | 26,061 | 1,581 | 261 | 0 |
| 일본 엔 | 25,562 | 1,514 | 256 | 1 |

[전체 CSV](notebook_outputs/amount_tails.csv)

IQR 상단은 Q3+1.5×IQR이다. 분위수 초과는 분포상 큰 값이라는 의미이며 오류나 세탁 판정이 아니다. 이 기준으로 원본 행을 삭제하지 않았다.


## 10. 송수신 통화·은행 위치 조합

### 송수신 통화

| 송신·지급 범주 | 수신·수취 범주 | 거래 수 | 양성 거래 수 |
| --- | --- | --- | --- |
| 영국 파운드 | 영국 파운드 | 8,414,112 | 6,171 |
| 영국 파운드 | 유로 | 220,504 | 625 |
| 유로 | 영국 파운드 | 106,608 | 186 |
| 영국 파운드 | 파키스탄 루피 | 43,895 | 187 |
| 영국 파운드 | 일본 엔 | 43,517 | 101 |
| 영국 파운드 | 모로코 디르함 | 43,461 | 261 |
| 영국 파운드 | 멕시코 페소 | 43,174 | 220 |
| 영국 파운드 | 알바니아 레크 | 43,040 | 232 |
| 영국 파운드 | 나이지리아 나이라 | 42,696 | 261 |
| 영국 파운드 | 인도 루피 | 41,719 | 156 |
| 영국 파운드 | 미국 달러 | 41,571 | 100 |
| 영국 파운드 | 스위스 프랑 | 40,581 | 98 |
| 영국 파운드 | 디르함 | 40,581 | 216 |
| 영국 파운드 | 튀르키예 리라 | 40,442 | 202 |
| 튀르키예 리라 | 영국 파운드 | 25,548 | 58 |

거래량 상위 15개 조합 표시. [전체 조합 CSV](notebook_outputs/currency_pairs.csv)

![송수신 통화 조합별 거래 수: 색상은 log10(1+건수)](notebook_outputs/09_currency_pairs.png)

*송수신 통화 조합별 거래 수: 색상은 log10(1+건수)* · [PDF](notebook_outputs/09_currency_pairs.pdf)

### 송수신 은행 위치

| 송신·지급 범주 | 수신·수취 범주 | 거래 수 | 양성 거래 수 |
| --- | --- | --- | --- |
| 영국 | 영국 | 8,569,083 | 6,817 |
| 영국 | 파키스탄 | 37,595 | 160 |
| 영국 | 오스트리아 | 37,360 | 152 |
| 영국 | 모로코 | 37,146 | 245 |
| 영국 | 일본 | 37,130 | 76 |
| 영국 | 독일 | 37,056 | 97 |
| 영국 | 프랑스 | 37,043 | 75 |
| 영국 | 멕시코 | 36,977 | 195 |
| 영국 | 알바니아 | 36,788 | 213 |
| 영국 | 나이지리아 | 36,579 | 236 |
| 영국 | 스페인 | 35,886 | 80 |
| 영국 | 네덜란드 | 35,782 | 141 |
| 영국 | 인도 | 35,533 | 129 |
| 영국 | 미국 | 35,410 | 81 |
| 영국 | 이탈리아 | 34,856 | 120 |

거래량 상위 15개 조합 표시. [전체 조합 CSV](notebook_outputs/location_pairs.csv)

![송수신 은행 위치 조합별 거래 수: 색상은 log10(1+건수)](notebook_outputs/09_location_pairs.png)

*송수신 은행 위치 조합별 거래 수: 색상은 log10(1+건수)* · [PDF](notebook_outputs/09_location_pairs.pdf)

| 통화 변경 여부 | 은행 위치 변경 여부 | 거래 수 | 양성 거래 수 | 양성 비율(%) |
| --- | --- | --- | --- | --- |
| 실패 | 실패 | 8,414,812 | 6,177 | 0.0734 |
| 실패 | 통과 | 4,178 | 39 | 0.9335 |
| 통과 | 실패 | 155,692 | 651 | 0.4181 |
| 통과 | 통과 | 930,170 | 3,006 | 0.3232 |

[전체 CSV](notebook_outputs/cross_currency_location.csv)

통화 변경과 위치 변경은 별개다. 은행 위치가 다르다는 사실만으로 불법 거래라고 분류하지 않는다.


## 11. 계좌 활동과 식별자 일관성

| 전체 고유 계좌 ID | 송수신 모두 등장한 ID | 여러 위치에 등장한 ID | 계좌 활동 중앙값 | 계좌 활동 최댓값 |
| --- | --- | --- | --- | --- |
| 855,460 | 89,521 | 6,507 | 12 | 1,498 |

[전체 CSV](notebook_outputs/account_summary.csv)

| 관측 위치 수 | 계좌 수 |
| --- | --- |
| 1 | 848,953 |
| 2 | 5,652 |
| 3 | 790 |
| 4 | 58 |
| 5 | 7 |

[전체 CSV](notebook_outputs/account_locations.csv)

| 구간 | 계좌 수 |
| --- | --- |
| 101-1000 | 23,181 |
| 2-10 | 216,135 |
| 1001+ | 281 |
| 11-100 | 567,242 |
| 1 | 48,621 |

[전체 CSV](notebook_outputs/account_activity_bins.csv)

![송수신 등장 횟수 구간 및 계좌 ID별 관측 위치 수](notebook_outputs/10_accounts.png)

*송수신 등장 횟수 구간 및 계좌 ID별 관측 위치 수* · [PDF](notebook_outputs/10_accounts.pdf)

송신·수신 ID의 합집합으로 고유 계좌 수를 계산했다. 활동도는 양쪽 역할의 등장 횟수이며 자기 거래가 있으면 두 역할을 각각 센다. 동일 ID가 여러 위치에 나타나는 현상은 ID의 전역 유일성 및 위치 컬럼의 의미와 함께 확인해야 한다.

| 계좌 ID | 송수신 등장 횟수 | 송신 건수 | 수신 건수 | 양성 거래의 계좌 등장 횟수 | 관측 위치 수 |
| --- | --- | --- | --- | --- | --- |
| 2,938,210,715 | 1,498 | 753 | 745 | 6 | 1 |
| 4,808,614,002 | 1,491 | 754 | 737 | 8 | 1 |
| 5,579,295,130 | 1,490 | 751 | 739 | 8 | 1 |
| 8,600,542,721 | 1,489 | 738 | 751 | 8 | 1 |
| 2,357,599,526 | 1,481 | 749 | 732 | 8 | 1 |
| 4,724,445,469 | 1,467 | 731 | 736 | 0 | 1 |
| 9,810,335,545 | 1,467 | 742 | 725 | 6 | 1 |
| 6,408,343,900 | 1,465 | 735 | 730 | 8 | 1 |
| 3,747,015,869 | 1,464 | 730 | 734 | 9 | 1 |
| 9,824,280,342 | 1,463 | 731 | 732 | 9 | 1 |
| 3,748,489,503 | 1,461 | 732 | 729 | 9 | 1 |
| 5,460,360,634 | 1,456 | 716 | 740 | 6 | 1 |
| 5,782,689,214 | 1,456 | 729 | 727 | 5 | 1 |
| 8,913,863,501 | 1,451 | 736 | 715 | 7 | 1 |
| 9,544,431,251 | 1,451 | 717 | 734 | 7 | 1 |
| 1,424,693,007 | 1,444 | 719 | 725 | 6 | 1 |
| 9,416,949,366 | 1,443 | 721 | 722 | 6 | 1 |
| 4,924,631,375 | 1,440 | 706 | 734 | 0 | 1 |
| 6,174,306,361 | 1,440 | 712 | 728 | 7 | 1 |
| 8,063,440,965 | 1,438 | 733 | 705 | 5 | 1 |

[전체 CSV](notebook_outputs/top_accounts.csv)

상위 활동 계좌 표는 탐색 자료이며 활동량만으로 이상 계좌를 판정하지 않는다.


## 12. 방향성 계좌 쌍과 동일 시각 거래

| 방향성 계좌 쌍 수 | 1회 거래 계좌 쌍 | 쌍별 거래 수 중앙값 | 쌍별 거래 수 최댓값 |
| --- | --- | --- | --- |
| 887,497 | 105,866 | 12 | 84 |

[전체 CSV](notebook_outputs/pair_summary.csv)

| 같은 초의 거래 수 | 해당 시각 그룹 수 | 거래 수 |
| --- | --- | --- |
| 1 | 6,248,689 | 6,248,689 |
| 2 | 1,286,549 | 2,573,098 |
| 3 | 194,111 | 582,333 |
| 4 | 22,283 | 89,132 |
| 5 | 2,087 | 10,435 |
| 6 | 180 | 1,080 |
| 7 | 11 | 77 |
| 8 | 1 | 8 |

[전체 CSV](notebook_outputs/timestamp_concurrency.csv)

![한 시각에 발생한 거래 수별 시각 그룹 수(로그 축)](notebook_outputs/11_concurrency.png)

*한 시각에 발생한 거래 수별 시각 그룹 수(로그 축)* · [PDF](notebook_outputs/11_concurrency.pdf)

송신→수신과 수신→송신은 서로 다른 계좌 쌍이다. 같은 초의 여러 거래는 실제 선후 관계가 확정되지 않을 수 있으므로, 시간 피처를 만들 때 동률 시각 처리 규칙이 필요하다. 일 마감 그래프와 거래 즉시 탐지는 정보 사용 시점이 다르다.


## 13. 완전 중복과 정답 충돌

| 완전 중복 그룹 수 | 중복 초과 행 수 | 중복 관련 전체 행 |
| --- | --- | --- |
| 0 | 0 | 0 |

[전체 CSV](notebook_outputs/exact_duplicates.csv)

| 반복 입력 그룹 수 | 이진 정답 충돌 그룹 | 유형이 여러 개인 그룹 |
| --- | --- | --- |
| 0 | 0 | 0 |

[전체 CSV](notebook_outputs/input_conflicts.csv)

완전 중복은 분석용 row_id를 제외한 원본 12개 컬럼 전체가 같은 경우다. 정답 충돌 검사는 라벨·유형을 제외한 입력 컬럼으로 그룹화한다. 실제 값으로 비교했으며 해시 근사 중복 검사가 아니다. 발견 여부와 무관하게 이 EDA는 원본 행을 삭제하지 않는다.


## 14. SAML-D 시간순 60/20/20 분할 예시

아래는 **SAML-D 자체의 관측일 전체를 나눈 참고 예시**다. HI-Large에서 실행 중인 분할 실험과 별개이며 모델 학습 설정을 변경하지 않았다. 첫날·마지막 날을 포함했고 별도 정규화 기간이나 꼬리 제외 기준도 확정하지 않았다.

| 예시 분할 | 시작일 | 종료일 | 날짜 수 | 거래 수 | 양성 거래 수 | 양성 비율(%) | 거래 건수 비중(%) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 학습 | 2022-10-07 | 2023-04-16 | 192 | 5,707,316 | 5,751 | 0.1008 | 60.0463 |
| 검증 | 2023-04-17 | 2023-06-19 | 64 | 1,899,527 | 1,986 | 0.1046 | 19.9848 |
| 테스트 | 2023-06-20 | 2023-08-23 | 65 | 1,898,009 | 2,136 | 0.1125 | 19.9688 |

[전체 CSV](notebook_outputs/example_split_summary.csv)

| 거래 유형 | 학습 | 검증 | 테스트 |
| --- | --- | --- | --- |
| Behavioural_Change_1 | 207 | 97 | 90 |
| Behavioural_Change_2 | 178 | 74 | 93 |
| Bipartite | 258 | 83 | 42 |
| Cash_Withdrawal | 779 | 282 | 273 |
| Cycle | 235 | 97 | 50 |
| Deposit-Send | 562 | 175 | 208 |
| Fan_In | 187 | 113 | 64 |
| Fan_Out | 92 | 69 | 76 |
| Gather-Scatter | 215 | 39 | 100 |
| Layered_Fan_In | 398 | 102 | 156 |
| Layered_Fan_Out | 349 | 73 | 107 |
| Over-Invoicing | 26 | 18 | 10 |
| Scatter-Gather | 190 | 73 | 75 |
| Single_large | 165 | 41 | 44 |
| Smurfing | 541 | 215 | 176 |
| Stacked Bipartite | 240 | 100 | 166 |
| Structuring | 1,129 | 335 | 406 |

![SAML-D 시간순 분할 예시와 일별 양성 비율](notebook_outputs/12_example_split.png)

*SAML-D 시간순 분할 예시와 일별 양성 비율* · [PDF](notebook_outputs/12_example_split.pdf)

일수는 192/64/65일이며 거래 수 비중은 약 60.05/19.98/19.97%다. 이 탐색 결과를 이용해 테스트 성능이 좋게 경계를 반복 선택하지 않는다. 정규화·피처 선정·임계값 설정은 향후 학습·검증 구간에서만 수행해야 한다.


## 15. 검증 결과와 재현 방법

| 검사 | 결과 |
| --- | --- |
| 라벨별 건수 합계 | 통과 |
| 유형별 건수 합계 | 통과 |
| 유형별 양성 합계 | 통과 |
| 일별 유효 날짜 건수 | 통과 |
| 통화별 건수 합계 | 통과 |
| 지급 방식별 건수 합계 | 통과 |
| 유효 금액 건수 합계 | 통과 |
| 원본 변경 없음 | 통과 |

실행 환경: DuckDB 1.5.5, pandas 3.0.3. 기록된 전체 실행 시간은 168.5초다. 시스템 부하에 따라 재실행 시간은 달라질 수 있다.

[실행 노트북](SAML_D_상세_EDA.ipynb)에서 첫 설정 셀의 원본 경로를 확인한 후 위에서부터 실행한다. 한글 글꼴은 `assets/NotoSansKR.ttf`를 사용하며 다른 환경으로 옮길 때 `assets/`도 함께 복사한다. [실행 안내](NOTEBOOK_README_ko.md) · [검증 JSON](notebook_outputs/validation.json) · [실행 요약 JSON](notebook_outputs/run_summary.json).


## 16. 해석 시 주의할 점

- 유형은 정답 메타데이터다. 입력 피처로 사용하지 않는다.
- 유형별 거래 건수는 사건 수가 아니다.
- 전체 기간 통계는 EDA용이며 과거 시점의 학습 피처로 그대로 넣지 않는다.
- 금액의 통화 기준과 계좌 ID 식별 기준은 별도 명세 확인이 필요하다.
- 현재 거래 이후의 같은 날 정보를 사용하는 그래프는 일 마감 탐지 기준으로 설명해야 한다.
- 양성 비율·유형 구성이 다른 데이터셋과 모델 성능을 직접 비교하지 않는다.


## 부록. 노트북에서 실행한 분석 코드

아래 코드는 노트북의 분석 셀을 실행 순서대로 수록했다. 접힌 항목을 펼쳐 확인할 수 있다. 공통 환경·글꼴·표시 사전은 노트북의 앞 두 코드 셀에 있으므로, 독립 실행하려면 노트북을 사용한다. `조회()`는 SQL 집계, `표보기()`는 한글 표 출력, `그림저장()`은 그래프 출력·저장 함수다.

<details>
<summary>2-1. 원본 읽기·변환 및 스키마 표</summary>

```python
# 2-1. 원본 읽기·변환 및 스키마 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
con.execute(f"CREATE OR REPLACE TABLE raw AS SELECT row_number() OVER () - 1 AS row_id, * FROM read_csv({sqlstr(SOURCE)}, header=true, all_varchar=true, strict_mode=true, ignore_errors=false)")
columns = [r[0] for r in con.execute('DESCRIBE raw').fetchall() if r[0] != 'row_id']
expected = ['Time','Date','Sender_account','Receiver_account','Amount',
            'Payment_currency','Received_currency','Sender_bank_location',
            'Receiver_bank_location','Payment_type','Is_laundering','Laundering_type']
assert columns == expected, f'예상하지 못한 스키마: {columns}'
con.execute("""CREATE OR REPLACE TABLE tx AS SELECT *,
    try_strptime(Date || ' ' || Time, '%Y-%m-%d %H:%M:%S') AS ts,
    try_cast(Amount AS DOUBLE) AS amount_num,
    CASE WHEN trim(Is_laundering) IN ('0','1') THEN cast(trim(Is_laundering) AS INTEGER) END AS y
    FROM raw""")
N = con.execute('SELECT count(*) FROM tx').fetchone()[0]
표보기(조회('DESCRIBE tx'))
```

</details>

<details>
<summary>2-2. 원본 행과 변환 결과 예시</summary>

```python
# 2-2. 원본 행과 변환 결과 예시
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
표보기(조회('SELECT * FROM tx ORDER BY row_id LIMIT 5'))
print(f'전체 거래: {N:,}건 / 원본 컬럼: {len(columns)}개')
```

</details>

<details>
<summary>3-1. 컬럼별 품질 검사표</summary>

```python
# 3-1. 컬럼별 품질 검사표
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
quality_rows = []
for name in columns:
    x = ident(name)
    v = con.execute(f"""SELECT count(*) FILTER(WHERE {x} IS NULL),
        count(*) FILTER(WHERE {x} IS NOT NULL AND trim({x})=''),
        count(*) FILTER(WHERE lower(trim({x})) IN ('null','none','nan','na','n/a','undefined','-')),
        count(*) FILTER(WHERE {x} != trim({x})), count(DISTINCT {x}) FROM raw""").fetchone()
    quality_rows.append([name, *v])
quality = pd.DataFrame(quality_rows, columns=['column','nulls','blank','null_like','outer_spaces','unique'])
quality.to_csv(OUTPUT/'column_quality.csv', index=False)
표보기(quality)
```

</details>

<details>
<summary>3-2. 품질 검사 시각화</summary>

```python
# 3-2. 품질 검사 시각화
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
quality.set_index('column')[['nulls','blank','null_like','outer_spaces']].plot.barh(figsize=(10,6))
plt.xlabel('행 수')
plt.title('전체 데이터 품질 검사 (0이면 발견 없음)')
그림저장('01_quality')
```

</details>

<details>
<summary>4-1. 전체 규모·관측 기간·변환 오류 표</summary>

```python
# 4-1. 전체 규모·관측 기간·변환 오류 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
summary = 조회("""SELECT count(*) AS rows, min(ts) AS first_timestamp, max(ts) AS last_timestamp,
    sum(y)::BIGINT AS positives, count(*) FILTER(WHERE y=0) AS negatives,
    count(*) FILTER(WHERE ts IS NULL) AS invalid_datetime,
    count(*) FILTER(WHERE amount_num IS NULL OR NOT isfinite(amount_num)) AS invalid_amount,
    count(*) FILTER(WHERE y IS NULL) AS invalid_label,
    count(*) FILTER(WHERE amount_num<0) AS negative_amount,
    count(*) FILTER(WHERE amount_num=0) AS zero_amount,
    count(*) FILTER(WHERE Sender_account=Receiver_account) AS self_transfers
    FROM tx""", 'summary')
표보기(summary.T.rename(columns={0:'value'}))
```

</details>

<details>
<summary>4-2. 송신·수신 계좌 ID 형식 표</summary>

```python
# 4-2. 송신·수신 계좌 ID 형식 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
ids = 조회("""SELECT 'sender' AS role,
    count(*) FILTER(WHERE NOT regexp_full_match(Sender_account,'[0-9]+')) AS non_digits,
    count(*) FILTER(WHERE starts_with(Sender_account,'0')) AS leading_zero,
    count(DISTINCT Sender_account) AS unique_ids FROM tx
    UNION ALL SELECT 'receiver',
    count(*) FILTER(WHERE NOT regexp_full_match(Receiver_account,'[0-9]+')),
    count(*) FILTER(WHERE starts_with(Receiver_account,'0')),
    count(DISTINCT Receiver_account) FROM tx""", 'id_quality')
표보기(ids)
```

</details>

<details>
<summary>5-1. 정상·양성 건수와 비율 표</summary>

```python
# 5-1. 정상·양성 건수와 비율 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
labels = 조회('SELECT y,count(*) AS transactions FROM tx GROUP BY y ORDER BY y', 'labels')
labels['percent'] = 100 * labels.transactions / N
표보기(labels)
```

</details>

<details>
<summary>5-2. 클래스 불균형 그래프</summary>

```python
# 5-2. 클래스 불균형 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
fig, ax = plt.subplots(1,2,figsize=(11,4))
labels.plot.bar(x='y',y='transactions',logy=True,legend=False,ax=ax[0],color=['#3979ac','#c85555'])
ax[0].set_ylabel('거래 수 (로그 축)')
ax[0].set_xlabel('정답: 0 정상, 1 자금세탁 양성')
labels.plot.bar(x='y',y='percent',legend=False,ax=ax[1],color=['#3979ac','#c85555'])
for i,v in enumerate(labels.percent): ax[1].text(i,v+1,f'{v:.4f}%',ha='center')
ax[1].set_ylim(0,110)
ax[1].set_ylabel('전체 거래 대비 비율(%)')
그림저장('02_class_balance')
```

</details>

<details>
<summary>5-3. 양성 비율 요약</summary>

```python
# 5-3. 양성 비율 요약
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
POS = int(summary.positives.iloc[0])
표보기(Markdown(f'**양성 {POS:,}건 / 전체 {N:,}건 = {100*POS/N:.4f}%**'))
```

</details>

<details>
<summary>6-1. 기간 경계일의 거래 범위</summary>

```python
# 6-1. 기간 경계일의 거래 범위
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
daily = 조회("""SELECT cast(ts AS DATE) AS day,count(*) AS transactions,sum(y)::BIGINT AS positives,
    100.0*sum(y)/count(*) AS positive_pct,min(ts) AS first_time,max(ts) AS last_time
    FROM tx WHERE ts IS NOT NULL GROUP BY 1 ORDER BY 1""", 'daily')
daily.day = pd.to_datetime(daily.day)
missing_days = pd.date_range(daily.day.min(),daily.day.max()).difference(daily.day)
print('관측일:',len(daily),'거래 없는 날짜 수:',len(missing_days))
표보기(daily.iloc[[0,-1]])
```

</details>

<details>
<summary>6-2. 월별 거래·양성 집계표</summary>

```python
# 6-2. 월별 거래·양성 집계표
# groupby: 같은 범주끼리 묶습니다. sum=합계, count/size=개수, nunique=고유값 수입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
monthly = daily.assign(month=daily.day.dt.strftime('%Y-%m')).groupby('month')[['transactions','positives']].sum()
monthly['positive_pct'] = 100*monthly.positives/monthly.transactions
표보기(monthly)
```

</details>

<details>
<summary>6-3. 일별 추이 그래프</summary>

```python
# 6-3. 일별 추이 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
monthly.to_csv(OUTPUT/'monthly.csv')
fig,ax=plt.subplots(3,1,figsize=(13,8),sharex=True)
for a,col,color in zip(ax,['transactions','positives','positive_pct'],['#3979ac','#c85555','#248a75']):
    a.plot(daily.day,daily[col],color=color); a.set_ylabel(col); a.grid(alpha=.2)
ax[0].set_title('일별 전체 거래·양성 거래·양성 비율')
그림저장('03_daily')
```

</details>

<details>
<summary>6-4. 시간대·요일별 양성 비율 그래프</summary>

```python
# 6-4. 시간대·요일별 양성 비율 그래프
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
hourly=조회("""SELECT hour(ts) AS hour,count(*) AS transactions,sum(y)::BIGINT AS positives,
    100.0*sum(y)/count(*) AS positive_pct FROM tx WHERE ts IS NOT NULL GROUP BY 1 ORDER BY 1""",'hourly')
weekday=조회("""SELECT isodow(ts) AS weekday,count(*) AS transactions,sum(y)::BIGINT AS positives,
    100.0*sum(y)/count(*) AS positive_pct FROM tx WHERE ts IS NOT NULL GROUP BY 1 ORDER BY 1""",'weekday')
fig,ax=plt.subplots(1,2,figsize=(12,4))
ax[0].plot(hourly.hour,hourly.positive_pct,marker='o')
ax[0].set_xlabel('시간대')
ax[0].set_ylabel('양성 비율(%)')
ax[1].bar(weekday.weekday,weekday.positive_pct)
ax[1].set_xticks(range(1,8),['월','화','수','목','금','토','일'])
ax[1].set_ylabel('양성 비율(%)')
그림저장('04_hour_weekday')
```

</details>

<details>
<summary>7-1. 유형 × 이진 라벨 교차표</summary>

```python
# 7-1. 유형 × 이진 라벨 교차표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# pivot/pivot_table: 행·열 범주별 교차표를 만듭니다. fillna(0)은 없는 조합의 집계값을 0으로 표시합니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
types=조회("""SELECT Laundering_type,y,count(*) AS transactions FROM tx GROUP BY 1,2 ORDER BY 1,2""",'type_label')
cross=types.pivot_table(index='Laundering_type',columns='y',values='transactions',aggfunc='sum',fill_value=0)
표보기(cross)
```

</details>

<details>
<summary>7-2. 정상·양성 유형별 거래 수 그래프</summary>

```python
# 7-2. 정상·양성 유형별 거래 수 그래프
# groupby: 같은 범주끼리 묶습니다. sum=합계, count/size=개수, nunique=고유값 수입니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
conflicts=int((types.groupby('Laundering_type').y.nunique()>1).sum())
print('정상·양성 라벨이 혼재한 유형 수:',conflicts)
fig,ax=plt.subplots(1,2,figsize=(15,8))
for a,label in zip(ax,[0,1]):
    q=types[types.y==label].sort_values('transactions')
    a.barh(q.Laundering_type,q.transactions,color='#3979ac' if label==0 else '#c85555')
    a.set_title(f'유형별 거래 분포 | 정답={label}'); a.set_xlabel('거래 수')
그림저장('05_type_distribution')
```

</details>

<details>
<summary>8-1. 월별 양성 유형 건수 표</summary>

```python
# 8-1. 월별 양성 유형 건수 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# pivot/pivot_table: 행·열 범주별 교차표를 만듭니다. fillna(0)은 없는 조합의 집계값을 0으로 표시합니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
monthly_type=조회("""SELECT strftime(ts,'%Y-%m') AS month,Laundering_type,count(*) AS transactions
    FROM tx WHERE y=1 AND ts IS NOT NULL GROUP BY 1,2 ORDER BY 1,2""",'monthly_positive_type')
counts=monthly_type.pivot(index='Laundering_type',columns='month',values='transactions').fillna(0)
shares=counts.div(counts.sum(axis=0),axis=1)*100
표보기(counts.astype(int))
```

</details>

<details>
<summary>8-2. 월별 양성 유형 구성비 히트맵</summary>

```python
# 8-2. 월별 양성 유형 구성비 히트맵
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
fig,ax=plt.subplots(figsize=(13,7))
im=ax.imshow(shares.to_numpy(),aspect='auto',cmap='YlOrRd',vmin=0)
ax.set_xticks(range(len(shares.columns)),shares.columns,rotation=45,ha='right')
ax.set_yticks(range(len(shares.index)),shares.index)
ax.set_title('월별 양성 유형 구성비(%)')
fig.colorbar(im,ax=ax,label='해당 월 양성 중 비율(%)')
그림저장('06_monthly_types')
```

</details>

<details>
<summary>9-1. 지급 통화별 거래·양성 집계표</summary>

```python
# 9-1. 지급 통화별 거래·양성 집계표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
category_tables={}
column = 'Payment_currency'
t=조회(f"SELECT {ident(column)} AS category,count(*) AS transactions,sum(y)::BIGINT AS positives,100.0*sum(y)/count(*) AS positive_pct FROM tx GROUP BY 1 ORDER BY transactions DESC",column)
category_tables[column]=t
표보기(t)
```

</details>

<details>
<summary>9-2. 지급 통화별 거래량·양성 비율 그래프</summary>

```python
# 9-2. 지급 통화별 거래량·양성 비율 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
fig,ax=plt.subplots(1,2,figsize=(13,5))
ax[0].barh(t.category,t.transactions,color='#3979ac')
ax[0].set_xscale('log')
ax[0].set_xlabel('거래 수 (로그 축)')
ax[1].barh(t.category,t.positive_pct,color='#c85555')
ax[1].set_xlabel('양성 비율(%)')
fig.suptitle(column)
그림저장('07_'+column)
```

</details>

<details>
<summary>9-3. 수취 통화별 거래·양성 집계표</summary>

```python
# 9-3. 수취 통화별 거래·양성 집계표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
column = 'Received_currency'
t=조회(f"SELECT {ident(column)} AS category,count(*) AS transactions,sum(y)::BIGINT AS positives,100.0*sum(y)/count(*) AS positive_pct FROM tx GROUP BY 1 ORDER BY transactions DESC",column)
category_tables[column]=t
표보기(t)
```

</details>

<details>
<summary>9-4. 수취 통화별 거래량·양성 비율 그래프</summary>

```python
# 9-4. 수취 통화별 거래량·양성 비율 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
fig,ax=plt.subplots(1,2,figsize=(13,5))
ax[0].barh(t.category,t.transactions,color='#3979ac')
ax[0].set_xscale('log')
ax[0].set_xlabel('거래 수 (로그 축)')
ax[1].barh(t.category,t.positive_pct,color='#c85555')
ax[1].set_xlabel('양성 비율(%)')
fig.suptitle(column)
그림저장('07_'+column)
```

</details>

<details>
<summary>9-5. 지급 방식별 거래·양성 집계표</summary>

```python
# 9-5. 지급 방식별 거래·양성 집계표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
column = 'Payment_type'
t=조회(f"SELECT {ident(column)} AS category,count(*) AS transactions,sum(y)::BIGINT AS positives,100.0*sum(y)/count(*) AS positive_pct FROM tx GROUP BY 1 ORDER BY transactions DESC",column)
category_tables[column]=t
표보기(t)
```

</details>

<details>
<summary>9-6. 지급 방식별 거래량·양성 비율 그래프</summary>

```python
# 9-6. 지급 방식별 거래량·양성 비율 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
fig,ax=plt.subplots(1,2,figsize=(13,5))
ax[0].barh(t.category,t.transactions,color='#3979ac')
ax[0].set_xscale('log')
ax[0].set_xlabel('거래 수 (로그 축)')
ax[1].barh(t.category,t.positive_pct,color='#c85555')
ax[1].set_xlabel('양성 비율(%)')
fig.suptitle(column)
그림저장('07_'+column)
```

</details>

<details>
<summary>10-1. 통화·라벨별 금액 분위수 표</summary>

```python
# 10-1. 통화·라벨별 금액 분위수 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
amount=조회("""SELECT Payment_currency,y,count(*) AS transactions,min(amount_num) AS minimum,
    quantile_cont(amount_num,.01) AS p01,quantile_cont(amount_num,.25) AS p25,
    median(amount_num) AS median,quantile_cont(amount_num,.75) AS p75,
    quantile_cont(amount_num,.95) AS p95,quantile_cont(amount_num,.99) AS p99,
    quantile_cont(amount_num,.999) AS p999,max(amount_num) AS maximum,avg(amount_num) AS mean
    FROM tx WHERE isfinite(amount_num) GROUP BY 1,2 ORDER BY 1,2""",'amount_quantiles')
표보기(amount)
```

</details>

<details>
<summary>10-2. 통화별 금액 히스토그램</summary>

```python
# 10-2. 통화별 금액 히스토그램
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
sample=조회("""SELECT Payment_currency,amount_num,y FROM tx
    WHERE isfinite(amount_num) AND amount_num>=0 AND (y=1 OR hash(row_id)%100=0)""")
print('금액 시각화용 행 수:',len(sample),'| 정상 표본:',int((sample.y==0).sum()),'| 전체 양성:',int((sample.y==1).sum()))
top=category_tables['Payment_currency'].category.head(4).tolist()
fig,axes=plt.subplots(2,2,figsize=(12,8))
for ax,cur in zip(axes.flat,top):
    q=sample[sample.Payment_currency==cur]
    edges=np.histogram_bin_edges(np.log10(1+q.amount_num),bins=35)
    for label,color in [(0,'#3979ac'),(1,'#c85555')]:
        values=np.log10(1+q.loc[q.y==label,'amount_num'])
        if len(values):ax.hist(values,bins=edges,density=True,histtype='step',linewidth=1.5,color=color,label=f'정답={label}, {len(values):,}건')
    ax.set_title(cur);ax.set_xlabel('log10(1 + 금액)');ax.set_ylabel('클래스별 확률 밀도');ax.legend(fontsize=8)
그림저장('08_amount_histograms')
```

</details>

<details>
<summary>10-3. 통화별 상단 꼬리 집계표</summary>

```python
# 10-3. 통화별 상단 꼬리 집계표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
tails=조회("""WITH q AS (SELECT Payment_currency,quantile_cont(amount_num,.25) AS q1,
    quantile_cont(amount_num,.75) AS q3,quantile_cont(amount_num,.99) AS p99 FROM tx
    WHERE isfinite(amount_num) GROUP BY 1)
    SELECT t.Payment_currency,count(*) AS transactions,
    count(*) FILTER(WHERE amount_num>q3+1.5*(q3-q1)) AS above_upper_iqr,
    count(*) FILTER(WHERE amount_num>p99) AS above_p99,
    count(*) FILTER(WHERE amount_num>p99 AND y=1) AS positives_above_p99
    FROM tx t JOIN q USING(Payment_currency) GROUP BY 1 ORDER BY 1""",'amount_tails')
표보기(tails)
```

</details>

<details>
<summary>11-1. 송수신 통화 조합 상위 15개 표</summary>

```python
# 11-1. 송수신 통화 조합 상위 15개 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
(name, left, right) = ('currency_pairs', 'Payment_currency', 'Received_currency')
pairs=조회(f'SELECT {ident(left)} AS source,{ident(right)} AS destination,count(*) AS transactions,sum(y)::BIGINT AS positives FROM tx GROUP BY 1,2',name)
표보기(pairs.sort_values('transactions',ascending=False).head(15))
```

</details>

<details>
<summary>11-2. 송수신 통화 조합 히트맵</summary>

```python
# 11-2. 송수신 통화 조합 히트맵
# pivot/pivot_table: 행·열 범주별 교차표를 만듭니다. fillna(0)은 없는 조합의 집계값을 0으로 표시합니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
mat=pairs.pivot(index='source',columns='destination',values='transactions').fillna(0)
fig,ax=plt.subplots(figsize=(11,8))
im=ax.imshow(np.log10(1+mat),aspect='auto',cmap='Blues')
ax.set_xticks(range(len(mat.columns)),mat.columns,rotation=70,ha='right')
ax.set_yticks(range(len(mat.index)),mat.index)
ax.set_xlabel(right)
ax.set_ylabel(left)
fig.colorbar(im,ax=ax,label='log10(1 + 거래 수)')
그림저장('09_'+name)
```

</details>

<details>
<summary>11-3. 송수신 은행 위치 조합 상위 15개 표</summary>

```python
# 11-3. 송수신 은행 위치 조합 상위 15개 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
(name, left, right) = ('location_pairs', 'Sender_bank_location', 'Receiver_bank_location')
pairs=조회(f'SELECT {ident(left)} AS source,{ident(right)} AS destination,count(*) AS transactions,sum(y)::BIGINT AS positives FROM tx GROUP BY 1,2',name)
표보기(pairs.sort_values('transactions',ascending=False).head(15))
```

</details>

<details>
<summary>11-4. 송수신 은행 위치 조합 히트맵</summary>

```python
# 11-4. 송수신 은행 위치 조합 히트맵
# pivot/pivot_table: 행·열 범주별 교차표를 만듭니다. fillna(0)은 없는 조합의 집계값을 0으로 표시합니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
mat=pairs.pivot(index='source',columns='destination',values='transactions').fillna(0)
fig,ax=plt.subplots(figsize=(11,8))
im=ax.imshow(np.log10(1+mat),aspect='auto',cmap='Blues')
ax.set_xticks(range(len(mat.columns)),mat.columns,rotation=70,ha='right')
ax.set_yticks(range(len(mat.index)),mat.index)
ax.set_xlabel(right)
ax.set_ylabel(left)
fig.colorbar(im,ax=ax,label='log10(1 + 거래 수)')
그림저장('09_'+name)
```

</details>

<details>
<summary>11-5. 통화 변경 × 위치 변경 교차표</summary>

```python
# 11-5. 통화 변경 × 위치 변경 교차표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
relations=조회("""SELECT Payment_currency!=Received_currency AS currency_change,
    Sender_bank_location!=Receiver_bank_location AS location_change,
    count(*) AS transactions,sum(y)::BIGINT AS positives,100.0*sum(y)/count(*) AS positive_pct
    FROM tx GROUP BY 1,2 ORDER BY 1,2""",'cross_currency_location')
표보기(relations)
```

</details>

<details>
<summary>12-1. 계좌 수·역할·활동도 요약표</summary>

```python
# 12-1. 계좌 수·역할·활동도 요약표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
con.execute("""CREATE OR REPLACE TABLE account_activity AS
    WITH endpoints AS (
      SELECT Sender_account AS account,Sender_bank_location AS location,y,'sender' AS role FROM tx
      UNION ALL SELECT Receiver_account,Receiver_bank_location,y,'receiver' FROM tx)
    SELECT account,count(*) AS endpoint_count,count(*) FILTER(WHERE role='sender') AS sent,
      count(*) FILTER(WHERE role='receiver') AS received,sum(y)::BIGINT AS positive_endpoints,
      count(DISTINCT location) AS locations FROM endpoints GROUP BY account""")
account_summary=조회("""SELECT count(*) AS unique_accounts,
    count(*) FILTER(WHERE sent>0 AND received>0) AS both_roles,
    count(*) FILTER(WHERE locations>1) AS multiple_locations,
    median(endpoint_count) AS median_activity,max(endpoint_count) AS max_activity FROM account_activity""",'account_summary')
표보기(account_summary)
```

</details>

<details>
<summary>12-2. 계좌 활동과 위치 수 분포 그래프</summary>

```python
# 12-2. 계좌 활동과 위치 수 분포 그래프
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
location_counts=조회('SELECT locations,count(*) AS accounts FROM account_activity GROUP BY 1 ORDER BY 1','account_locations')
activity=조회("""SELECT CASE WHEN endpoint_count=1 THEN '1' WHEN endpoint_count<=10 THEN '2-10'
    WHEN endpoint_count<=100 THEN '11-100' WHEN endpoint_count<=1000 THEN '101-1000'
    ELSE '1001+' END AS bucket,count(*) AS accounts FROM account_activity GROUP BY 1""",'account_activity_bins')
activity=activity.set_index('bucket').reindex(['1','2-10','11-100','101-1000','1001+']).fillna(0)
fig,ax=plt.subplots(1,2,figsize=(12,4))
activity.plot.bar(y='accounts',logy=True,legend=False,ax=ax[0])
ax[0].set_ylabel('계좌 수 (로그 축)')
ax[0].set_xlabel('송수신 등장 횟수')
ax[1].bar(location_counts.locations,location_counts.accounts)
ax[1].set_yscale('log')
ax[1].set_xlabel('계좌 ID별 관측 위치 수')
ax[1].set_ylabel('계좌 수 (로그 축)')
그림저장('10_accounts')
```

</details>

<details>
<summary>12-3. 활동 상위 20개 계좌 표</summary>

```python
# 12-3. 활동 상위 20개 계좌 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
표보기(조회('SELECT * FROM account_activity ORDER BY endpoint_count DESC, account LIMIT 20','top_accounts'))
```

</details>

<details>
<summary>13-1. 방향성 계좌 쌍 요약표</summary>

```python
# 13-1. 방향성 계좌 쌍 요약표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
pair_summary=조회("""WITH p AS (SELECT Sender_account,Receiver_account,count(*) AS n FROM tx GROUP BY 1,2)
    SELECT count(*) AS directed_pairs,count(*) FILTER(WHERE n=1) AS single_transaction_pairs,
    median(n) AS median_pair_transactions,max(n) AS max_pair_transactions FROM p""",'pair_summary')
표보기(pair_summary)
```

</details>

<details>
<summary>13-2. 동일 시각 거래 빈도표</summary>

```python
# 13-2. 동일 시각 거래 빈도표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
concurrency=조회("""WITH t AS (SELECT ts,count(*) AS n FROM tx WHERE ts IS NOT NULL GROUP BY 1)
    SELECT n AS transactions_at_same_second,count(*) AS timestamp_groups,sum(n) AS transactions
    FROM t GROUP BY 1 ORDER BY 1""",'timestamp_concurrency')
표보기(concurrency)
```

</details>

<details>
<summary>13-3. 동일 시각 거래 분포 그래프</summary>

```python
# 13-3. 동일 시각 거래 분포 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
plt.figure(figsize=(9,4))
plt.bar(concurrency.transactions_at_same_second,concurrency.timestamp_groups)
plt.yscale('log')
plt.xlabel('같은 시각의 거래 수')
plt.ylabel('시각 그룹 수 (로그 축)')
그림저장('11_concurrency')
```

</details>

<details>
<summary>14-1. 완전 중복 검사표</summary>

```python
# 14-1. 완전 중복 검사표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
fields=','.join(ident(x) for x in columns)
duplicates=조회(f"""SELECT count(*) AS duplicate_groups,coalesce(sum(n-1),0)::BIGINT AS extra_rows,
    coalesce(sum(n),0)::BIGINT AS involved_rows FROM
    (SELECT count(*) AS n FROM raw GROUP BY {fields} HAVING count(*)>1)""",'exact_duplicates')
표보기(duplicates)
```

</details>

<details>
<summary>14-2. 동일 입력의 라벨·유형 충돌표</summary>

```python
# 14-2. 동일 입력의 라벨·유형 충돌표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
inputs=','.join(ident(x) for x in columns if x not in ['Is_laundering','Laundering_type'])
conflicting=조회(f"""SELECT count(*) FILTER(WHERE n>1) AS repeated_input_groups,
    count(*) FILTER(WHERE labels>1) AS conflicting_binary_labels,
    count(*) FILTER(WHERE types>1) AS multiple_types FROM
    (SELECT count(*) AS n,count(DISTINCT Is_laundering) AS labels,
    count(DISTINCT Laundering_type) AS types FROM raw GROUP BY {inputs})""",'input_conflicts')
표보기(conflicting)
```

</details>

<details>
<summary>15-1. SAML-D 예시 시간 분할 요약표</summary>

```python
# 15-1. SAML-D 예시 시간 분할 요약표
# groupby: 같은 범주끼리 묶습니다. sum=합계, count/size=개수, nunique=고유값 수입니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
days=daily.day.sort_values().tolist()
a=int(len(days)*.6)
b=int(len(days)*.8)
assert 0<a<b<len(days)
VAL_START,TEST_START=days[a],days[b]
daily['example_split']=np.where(daily.day<VAL_START,'train',np.where(daily.day<TEST_START,'val','test'))
example=daily.groupby('example_split').agg(start=('day','min'),end=('day','max'),days=('day','size'),transactions=('transactions','sum'),positives=('positives','sum')).reindex(['train','val','test'])
example['positive_pct']=100*example.positives/example.transactions
example['row_share_pct']=100*example.transactions/example.transactions.sum()
표보기(example)
```

</details>

<details>
<summary>15-2. 예시 분할별 양성 유형 건수 표</summary>

```python
# 15-2. 예시 분할별 양성 유형 건수 표
# 조회(): SQL 조건으로 원본 전체를 집계합니다. SELECT=컬럼 선택, WHERE=조건, GROUP BY=그룹별 집계입니다.
# pivot/pivot_table: 행·열 범주별 교차표를 만듭니다. fillna(0)은 없는 조합의 집계값을 0으로 표시합니다.
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
example.to_csv(OUTPUT/'example_split_summary.csv')
by_type=조회(f"""SELECT CASE WHEN ts<{sqlstr(VAL_START)}::TIMESTAMP THEN 'train'
    WHEN ts<{sqlstr(TEST_START)}::TIMESTAMP THEN 'val' ELSE 'test' END AS split,
    Laundering_type,count(*) AS positives FROM tx WHERE y=1 AND ts IS NOT NULL GROUP BY 1,2""",'example_split_types')
표보기(by_type.pivot(index='Laundering_type',columns='split',values='positives').fillna(0).astype(int))
```

</details>

<details>
<summary>15-3. 예시 분할과 일별 양성 비율 그래프</summary>

```python
# 15-3. 예시 분할과 일별 양성 비율 그래프
# 그래프의 데이터는 앞 표와 동일합니다. 로그 축 여부와 비율의 분모를 확인하세요.
seen=set(by_type.loc[by_type.split=='train','Laundering_type'])
print('학습 구간에 없고 이후에 등장한 양성 유형:',[한글(x) for x in sorted(set(by_type.Laundering_type)-seen)])
fig,ax=plt.subplots(figsize=(13,4))
ax.plot(daily.day,daily.positive_pct,color='#3979ac')
for left,right,color,label in [(days[0],VAL_START,'#dbeafe','Train'),(VAL_START,TEST_START,'#dcfce7','Val'),(TEST_START,days[-1]+pd.Timedelta(days=1),'#ffedd5','Test')]:
    ax.axvspan(left,right,color=color,alpha=.5,label=label)
ax.axvline(VAL_START,color='#555',ls='--')
ax.axvline(TEST_START,color='#555',ls='--')
ax.set_ylabel('일별 양성 비율(%)')
ax.set_title('시간순 분할 예시 (실제 학습 설정 아님)')
ax.legend()
그림저장('12_example_split')
```

</details>

<details>
<summary>16-1. 집계 합계 검증표</summary>

```python
# 16-1. 집계 합계 검증표
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
checks={
    'label_counts':int(labels.transactions.sum())==N,
    'type_counts':int(types.transactions.sum())==N,
    'type_positive_counts':int(types.loc[types.y==1,'transactions'].sum())==POS,
    'daily_valid_timestamp_counts':int(daily.transactions.sum())==N-int(summary.invalid_datetime.iloc[0]),
    'currency_counts':int(category_tables['Payment_currency'].transactions.sum())==N,
    'payment_counts':int(category_tables['Payment_type'].transactions.sum())==N,
    'amount_valid_counts':int(amount.transactions.sum())==N-int(summary.invalid_amount.iloc[0]),
    'source_unchanged':SOURCE_STAT==(SOURCE.stat().st_size,SOURCE.stat().st_mtime_ns),
}
assert all(checks.values()),checks
(OUTPUT/'validation.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
run={'source':str(SOURCE),'source_bytes':SOURCE_STAT[0],'source_mtime_ns':SOURCE_STAT[1],
     'rows':N,'positives':POS,'positive_pct':100*POS/N,
     'finished_utc':datetime.now(timezone.utc).isoformat(),'elapsed_seconds':round(time.time()-START,1),
     'duckdb_version':duckdb.__version__,'pandas_version':pd.__version__,'checks':checks}
(OUTPUT/'run_summary.json').write_text(json.dumps(run,ensure_ascii=False,indent=2)+'\n')
표보기(pd.Series(checks,name='passed').to_frame())
```

</details>

<details>
<summary>16-2. 이번 실행의 핵심 결과</summary>

```python
# 16-2. 이번 실행의 핵심 결과
# 표보기(): 계산값은 그대로 두고 화면의 컬럼·범주 이름만 한글로 바꿉니다.
표보기(Markdown(f"""**분석 완료**

- 전체 **{N:,}건**, 양성 **{POS:,}건 ({100*POS/N:.4f}%)**.
- 고유 계좌 ID **{int(account_summary.unique_accounts.iloc[0]):,}개**, 여러 은행 위치에 등장하는 ID **{int(account_summary.multiple_locations.iloc[0]):,}개**.
- 완전 중복 초과 행 **{int(duplicates.extra_rows.iloc[0]):,}건**, 동일 입력의 이진 라벨 충돌 **{int(conflicting.conflicting_binary_labels.iloc[0]):,}그룹**.
- 검증 **{len(checks)}개 통과**, 산출물: `{OUTPUT}`.
"""))
con.close()
print('DB 연결을 닫았습니다. SQL을 다시 실행하려면 첫 설정 셀부터 실행하세요.')
```

</details>

