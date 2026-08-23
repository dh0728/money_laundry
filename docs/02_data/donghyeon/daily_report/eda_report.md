# IBM AML 데이터셋 aml일기
- 작성일: 2026-08-23

## 데이터셋 별 컬럼 이해하기

### Trans


| 컬럼 | 의미 | 현재 Pandas 타입 | HI-Small 유니크 | LI-Small 유니크 | 실제 예시 |
|---|---|---:|---:|---:|---|
| `Timestamp` | 거래가 발생한 날짜와 시각 | `str` | 15,018 | 14,533 | `2022/09/01 00:20` |
| `From Bank` | 송금 계좌가 속한 은행의 ID | `int64` | 30,470 | 41,814 | HI: `10`, `3208` / LI: `11`, `3402` |
| `Account` | 송금 계좌번호 | `str` | 496,995 | 681,281 | HI: `8000EBD30` / LI: `8000ECA90` |
| `To Bank` | 수취 계좌가 속한 은행의 ID | `int64` | 15,811 | 21,588 | HI: `10`, `1` / LI: `11`, `3402` |
| `Account.1` | 수취 계좌번호. 동일한 `Account` 이름이 두 번 있어 Pandas가 `.1`을 붙임 | `str` | 420,636 | 576,176 | HI: `8000F5340` / LI: `8006AA910` |
| `Amount Received` | 수취 계좌가 `Receiving Currency` 기준으로 받은 금액 | `float64` | 915,161 | 1,194,921 | HI: `3697.34` / LI: `3195403.00` |
| `Receiving Currency` | 수취 금액에 적용되는 통화 | `str` | 15 | 15 | `US Dollar`, `Bitcoin`, `Euro` |
| `Amount Paid` | 송금 계좌가 `Payment Currency` 기준으로 지급한 금액 | `float64` | 923,873 | 1,204,309 | HI: `3697.34` / LI: `3195403.00` |
| `Payment Currency` | 지급 금액에 적용되는 통화 | `str` | 15 | 15 | `US Dollar`, `Bitcoin`, `Euro` |
| `Payment Format` | 거래에 사용된 결제 또는 이체 방식 | `str` | 7 | 7 | `Reinvestment`, `Cheque`, `ACH` |
| `Is Laundering` | 거래의 자금세탁 여부. `0`은 정상, `1`은 자금세탁 | `int64` | 2 | 2 | `0`, `1` |

데이터 크기:
| 데이터셋 | 거래 수 | 컬럼 수 | 메모리 사용량 |
|---|---:|---:|---:|
| HI-Small | 5,078,345 | 11 | 약 699.6MB |
| LI-Small | 6,924,049 | 11 | 약 952.8MB |

### Accounts

| 컬럼 | 의미 | 현재 Pandas 타입 | HI-Small 유니크 | LI-Small 유니크 | 실제 예시 |
|---|---|---:|---:|---:|---|
| `Bank Name` | 계좌가 속한 은행의 이름 | `str` | 20,053 | 27,652 | `Portugal Bank #4507`, `China Bank #2820` |
| `Bank ID` | 계좌가 속한 은행의 ID | `int64` | 30,470 | 41,815 | HI: `331579` / LI: `314693` |
| `Account Number` | 해당 은행에 개설된 계좌번호 | `str` | 518,573 | 712,684 | HI: `80B779D80` / LI: `81B86A280` |
| `Entity ID` | 계좌를 소유하거나 관리하는 개인·회사 엔티티의 ID | `str` | 166,207 | 224,931 | HI: `80062E240` / LI: `800D8CCF0` |
| `Entity Name` | 계좌 소유 엔티티의 합성 이름 | `str` | 166,207 | 224,931 | `Sole Proprietorship #50438`, `Corporation #41344` |

데이터셋 크기:
| 데이터셋 | 계좌 행 수 | 컬럼 수 | 메모리 사용량 |
|---|---:|---:|---:|
| HI-Small | 518,581 | 5 | 약 47.3MB |
| LI-Small | 712,688 | 5 | 약 65.4MB |


## HI 범주형 컬럼값 확인

### Receiving Currency - 수취 금액에 적용되는 통화

	count	ratio_percent
Receiving Currency		
US Dollar	1879341	37.0070
Euro	1172017	23.0787
Swiss Franc	237884	4.6843
Yuan	206551	4.0673
Shekel	194988	3.8396
Rupee	192065	3.7820
UK Pound	181255	3.5692
Ruble	157361	3.0987
Yen	156319	3.0781
Bitcoin	148151	2.9173
Canadian Dollar	141357	2.7835
Australian Dollar	138511	2.7275
Mexican Peso	111030	2.1863
Saudi Riyal	89971	1.7717
Brazil Real	71544	1.4088

### Payment Currency - 지급 금액에 적용되는 통화
	count	ratio_percent
Payment Currency		
US Dollar	1895172	37.3187
Euro	1168297	23.0055
Swiss Franc	234860	4.6247
Yuan	213752	4.2091
Shekel	192184	3.7844
Rupee	190202	3.7454
UK Pound	180738	3.5590
Yen	155209	3.0563
Ruble	155178	3.0557
Bitcoin	146066	2.8763
Canadian Dollar	140042	2.7576
Australian Dollar	136769	2.6932
Mexican Peso	110159	2.1692
Saudi Riyal	89014	1.7528
Brazil Real	70703	1.3922

### Payment Format - 거래에 사용된 결제 또는 이체 방식
	count	ratio_percent
Payment Format		
Cheque	1864331	36.7114
Credit Card	1323324	26.0582
ACH	600797	11.8306
Cash	490891	9.6664
Reinvestment	481056	9.4727
Wire	171855	3.3841
Bitcoin	146091	2.8767

[Is Laundering]
count	ratio_percent
Is Laundering		
0	5073168	99.8981
1	5177	0.1019


## LI 범주형 컬럼값 확인

[Receiving Currency]
count	ratio_percent
Receiving Currency		
US Dollar	2537242	36.6439
Euro	1596407	23.0560
Yuan	474978	6.8598
Rupee	344237	4.9716
Bitcoin	313196	4.5233
Saudi Riyal	261882	3.7822
Australian Dollar	213905	3.0893
Yen	211631	3.0565
Brazil Real	202717	2.9277
Canadian Dollar	177966	2.5703
Shekel	177298	2.5606
Swiss Franc	140076	2.0230
UK Pound	98000	1.4154
Ruble	89140	1.2874
Mexican Peso	85374	1.2330

[Payment Currency]
count	ratio_percent
Payment Currency		
US Dollar	2553887	36.8843
Euro	1595859	23.0481
Yuan	483603	6.9844
Rupee	340641	4.9197
Bitcoin	309240	4.4662
Saudi Riyal	257948	3.7254
Australian Dollar	211155	3.0496
Yen	210125	3.0347
Brazil Real	199840	2.8862
Canadian Dollar	176069	2.5429
Shekel	174530	2.5206
Swiss Franc	138251	1.9967
UK Pound	99668	1.4394
Ruble	88492	1.2780
Mexican Peso	84741	1.2239

[Payment Format]
count	ratio_percent
Payment Format		
Cheque	2503158	36.1517
Credit Card	1780389	25.7131
ACH	796581	11.5046
Cash	655688	9.4697
Reinvestment	650458	9.3942
Bitcoin	309208	4.4657
Wire	228567	3.3011

[Is Laundering]
count	ratio_percent
Is Laundering		
0	6920484	99.9485
1	3565	0.0515



### 데이터셋에서 나온 패턴들

| 패턴 | 데이터에서 확인할 구조 |
|---|---|
| FAN-OUT | 한 계좌가 여러 계좌로 분산 송금 |
| FAN-IN | 여러 계좌가 한 계좌로 집중 송금 |
| GATHER-SCATTER | 여러 계좌 → 중심 계좌 → 다시 여러 계좌 |
| SCATTER-GATHER | 한 계좌 → 여러 중간 계좌 → 한 계좌 |
| CYCLE | 자금이 여러 계좌를 거쳐 시작 계좌로 복귀 |
| RANDOM | 통제 계좌 사이를 무작위 경로처럼 이동하고 시작점으로 돌아오지 않음 |
| BIPARTITE | 여러 입력 계좌에서 여러 출력 계좌로 이동 |
| STACK | Bipartite 구조가 여러 층으로 이어짐 |