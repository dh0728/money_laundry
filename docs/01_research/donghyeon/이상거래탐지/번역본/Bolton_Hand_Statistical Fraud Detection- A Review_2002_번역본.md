# 통계적 사기 탐지: 문헌 검토

> **원문 제목:** Statistical Fraud Detection: A Review  
> **저자:** Richard J. Bolton · David J. Hand  
> **게재 정보:** Statistical Science, Vol. 17, No. 3, 2002, pp. 235-255  
> **DOI:** [https://doi.org/10.1214/ss/1042727940](https://doi.org/10.1214/ss/1042727940)

> **번역 안내:** 본문과 부록은 문단 문맥을 기준으로 한국어로 옮겼습니다. 수식과 참고문헌은 정확성을 위해 원문 표기를 유지했습니다. 원문의 그림과 표는 개별 이미지로 잘라 해당 본문 위치에 바로 배치했습니다.

---

<!-- 원문 1쪽 -->

추상적인. 현대 기술의 확장과 전 세계 초고속 통신망의 발달로 인해 사기 행위가 급격히 증가하고 있으며, 이로 인해 매년 전 세계적으로 수십억 달러의 손실이 발생하고 있습니다. 예방 기술이 사기를 줄이는 가장 좋은 방법이지만 사기꾼은 적응력이 뛰어나며 시간이 지나면 일반적으로 그러한 조치를 피할 수 있는 방법을 찾습니다. 사기 예방이 실패한 후 사기꾼을 잡으려면 사기 탐지 방법론이 필수적입니다. 통계 및 기계 학습은 사기 탐지를 위한 효과적인 기술을 제공하며 자금세탁, 전자상거래 신용카드 사기, 통신 사기, 컴퓨터 침입 등의 활동을 탐지하는 데 성공적으로 적용되었습니다. 통계적 사기 탐지에 사용할 수 있는 도구와 사기 탐지 기술이 가장 많이 사용되는 영역에 대해 설명합니다.

핵심 단어 및 문구: 사기 탐지, 사기 예방, 통계, 기계 학습, 자금세탁, 컴퓨터 침입, 전자 상거래, 신용 카드, 통신.

## 1 서론

간결한 옥스퍼드 사전(Concise Oxford Dictionary)에서는 사기를 "범죄적 속임수, 부당한 이익을 얻기 위해 허위 진술을 사용하는 것"으로 정의합니다. 사기는 인류만큼이나 오래되었으며 다양한 형태를 취할 수 있습니다. 그러나 최근 몇 년간 의사소통을 더 쉽게 만들고 소비력을 높이는 데 도움이 된 신기술의 개발로 인해 범죄자들이 사기를 저지를 수 있는 방법이 더욱 다양해졌습니다. 자금세탁과 같은 전통적인 형태의 사기 행위가 범해지기 쉬워졌으며, 이동통신 사기, 컴퓨터 침입과 같은 새로운 종류의 사기가 합류했습니다.

먼저 사기 예방과 사기 탐지를 구별합니다. 사기 예방은 사기 발생을 애초에 방지하기 위한 조치를 말합니다. 여기에는 정교한 디자인, 형광 섬유, 멀티톤 그림, 워터마크, 적층 금속 스트립 및 지폐의 홀로그램이 포함됩니다. 개인 Richard J. Bolton은 임페리얼 칼리지 수학과 통계학과의 연구원입니다. David J. Hand는 영국 런던 SW7 2BZ Imperial College 수학과 통계학 교수입니다(이메일: r.bolton, d.j.hand@ic.ac.uk). 은행 카드의 식별 번호, 신용 카드 거래를 위한 인터넷 보안 시스템, 휴대 전화의 SIM(가입자 식별 모듈) 카드, 컴퓨터 시스템 및 전화 은행 계좌의 비밀번호. 물론 이러한 방법 중 어느 것도 완벽하지 않으며 일반적으로 비용과 불편함(예: 고객에 대한)과 효율성 사이에서 절충안을 찾아야 합니다.

이와 대조적으로, 사기 탐지에는 사기가 발생한 후 가능한 한 빨리 사기를 식별하는 것이 포함됩니다. 사기 예방이 실패하면 사기 탐지가 작동합니다. 실제로는 일반적으로 사기 예방이 실패했다는 사실을 인식하지 못하기 때문에 사기 탐지를 지속적으로 사용해야 합니다. 본 연구에서는 카드를 철저히 보호하여 신용카드 사기를 예방할 수 있지만, 그럼에도 불구하고 카드 정보가 도난당한다면 가능한 한 빨리 사기 행위를 감지할 수 있어야 합니다.

사기 탐지는 지속적으로 발전하는 분야입니다. 하나의 탐지 방법이 있다는 사실이 알려질 때마다 범죄자는 자신의 전략을 조정하고 다른 방법을 시도합니다. 물론 새로운 범죄자들도 끊임없이 등장하고 있습니다. 그들 중 다수는 과거에 성공적이었던 사기 탐지 방법을 인식하지 못하고 식별 가능한 사기로 이어지는 전략을 채택할 것입니다. 이는 최신 개발뿐만 아니라 초기 탐지 도구도 적용해야 함을 의미합니다.

<!-- 원문 2쪽 -->

## 236 RJ 볼턴과 DJ 핸드

사기 탐지에 대한 아이디어 교환이 심각하게 제한되어 있다는 사실로 인해 새로운 사기 탐지 방법의 개발이 더욱 어려워지고 있습니다. 공개 도메인에서 사기 탐지 기술을 매우 자세하게 설명하는 것은 범죄자에게 탐지를 회피하는 데 필요한 정보를 제공하므로 의미가 없습니다. 데이터셋를 사용할 수 없으며 결과가 검열되는 경우가 많아 평가하기 어렵습니다(예: Leonard, 1993).

많은 사기 탐지 문제에는 지속적으로 발전하는 대규모 데이터셋가 관련되어 있습니다. 예를 들어, 신용 카드 회사 Barclaycard는 영국에서만 연간 약 350 million 거래를 처리하고(Hand, Blunt, Kelly and Adams, 2000), 유럽에서 가장 큰 신용 카드 가맹점 인수 사업을 보유한 스코틀랜드 왕립 은행은 연간 10억 건 이상의 거래를 처리하며 AT&T는 매주 275 million 통화를 처리합니다(Cortes and Pregibon, 1998). 사기 거래 또는 통화를 검색하기 위해 이러한 데이터셋를 처리하려면 단순한 통계 모델의 참신함 이상이 필요하며 빠르고 효율적인 알고리즘도 필요합니다. 데이터 마이닝 기술이 관련됩니다. 이 숫자는 또한 사기 탐지의 잠재적 가치를 나타냅니다. 100 million 거래 중 0.1%가 사기인 경우 각 회사는 £10만 손실을 입게 되고 회사 전체는 £1 million의 손실을 입게 됩니다.

사기 탐지를 위한 통계 도구는 다양하고 다양합니다. 다양한 애플리케이션의 데이터는 크기와 유형이 다양할 수 있지만 공통된 주제가 있기 때문입니다. 이러한 도구는 기본적으로 관찰된 데이터를 기대값과 비교하는 데 기반을 두고 있지만, 기대값은 상황에 따라 다양한 방식으로 도출될 수 있습니다. 이는 행동의 일부 측면에 대한 단일 수치 요약일 수 있으며 이상 징후를 쉽게 확인할 수 있는 간단한 그래픽 요약인 경우가 많지만 더 복잡한(다변량) 행동 프로필인 경우도 많습니다. 이러한 행동 프로필은 연구 중인 시스템의 과거 행동(예: 은행 계좌가 이전에 사용된 방식)을 기반으로 하거나 다른 유사한 시스템에서 추정될 수 있습니다. 일부 영역(예: 주식 시장 거래)에서 특정 행위자가 사기 행위를 할 때도 있고 다른 때는 하지 않을 수도 있다는 사실로 인해 상황이 더욱 복잡해지는 경우가 많습니다.

통계적 사기 탐지 방법은 감독되거나 감독되지 않을 수 있습니다. 지도 방법에서는 사기 기록과 사기 기록이 아닌 기록의 샘플을 사용하여 두 클래스 중 하나에 새로운 관찰을 할당할 수 있는 모델을 구성합니다. 물론 이를 위해서는 모델을 구축하는 데 사용된 원본 데이터의 실제 클래스에 대한 확신이 필요합니다. 또한 두 클래스 모두의 예가 필요합니다. 또한 이전에 발생한 유형의 사기를 탐지하는 데에만 사용할 수 있습니다.

대조적으로, 비지도 방법은 단순히 표준과 가장 다른 계정, 고객 등을 찾습니다. 그런 다음 이를 더 자세히 조사할 수 있습니다. 특이치는 비표준 관찰의 기본 형태입니다. 데이터 품질을 확인하는 데 사용되는 도구를 사용할 수 있지만 우발적인 오류를 감지하는 것은 의도적으로 위조된 데이터나 사기 패턴을 정확하게 설명하는 데이터를 감지하는 것과는 다소 다른 문제입니다.

이는 통계 분석만으로는 사기가 저질러졌다는 사실을 거의 확신할 수 없다는 근본적인 점을 지적하게 해줍니다. 오히려, 분석은 관찰이 변칙적이거나 다른 관찰보다 사기 가능성이 높다는 사실을 우리에게 경고하여 더 자세히 조사할 수 있도록 하는 것으로 간주되어야 합니다. 통계 분석의 목적은 의심 점수(낮은 점수보다 높은 점수를 더 의심스러운 것으로 간주함)를 반환하는 것으로 생각할 수 있습니다. 점수가 높을수록 관찰 결과가 더 이상하거나 이전에 사기성이었던 값과 더 유사하다는 의미입니다. 사기가 저질러질 수 있는 방법과 사기가 발생할 수 있는 시나리오가 다양하다는 사실은 의심 점수를 계산하는 방법도 다양하다는 것을 의미합니다.

의심 점수는 데이터베이스의 각 기록(은행 계좌나 신용 카드가 있는 각 고객, 휴대폰 소유자, 데스크톱 컴퓨터 등)에 대해 계산될 수 있으며 시간이 지남에 따라 업데이트될 수 있습니다. 그런 다음 이러한 점수를 순위별로 정렬하고 가장 높은 점수를 받은 점수나 급격한 증가를 보이는 점수에 조사 관심을 집중할 수 있습니다. 여기에 비용 문제가 포함됩니다. 모든 기록을 자세히 조사하는 데 비용이 너무 많이 들기 때문에 사기 가능성이 가장 높다고 생각되는 기록에 집중적으로 조사합니다.

사기 탐지의 어려움 중 하나는 일반적으로 각 사기 행위에 대해 합법적인 기록이 많다는 것입니다. 적법한 기록의 99%를 적법한 것으로, 부정한 기록의 99%를 사기로 정확하게 식별하는 탐지 방법은 매우 효과적인 시스템이라고 볼 수 있습니다. 그러나 1000 레코드의 1만 사기인 경우 평균적으로 시스템이 사기로 표시하는 모든 100에서 실제로는 약 9만이 사기입니다. 특히 이는 9를 식별하려면 상당한 비용을 들여 모든 100에 대한 자세한 조사가 필요함을 의미합니다. 이는 우리를 다음으로 이끈다.

<!-- 원문 3쪽 -->

## 통계적 사기 감지 237

보다 일반적인 요점: 사기는 원하는 만큼 낮은 수준으로 줄일 수 있지만 그에 상응하는 노력과 비용이 있어야만 가능합니다. 실제로는 사기 탐지 비용과 이를 탐지함으로써 얻을 수 있는 절감액 간에 어느 정도 절충(종종 상업적 절충)이 이루어져야 합니다. 때로는 사기 적발에 따른 부정적인 평판으로 인해 문제가 복잡해지는 경우도 있습니다. 비즈니스 수준에서 은행이 사기의 주요 대상임을 밝히는 것은 많은 부분이 적발되더라도 자신감을 불러일으키는 데 거의 도움이 되지 않으며, 개인적 수준에서는 무고한 고객에게 사기 혐의를 받을 수 있음을 암시하는 조치를 취하는 것은 분명히 좋은 고객 관계에 해를 끼치는 것입니다.

본 백서의 본문은 사기 탐지의 다양한 영역에 따라 구성되어 있습니다. 분명히 우리는 통계적 방법이 적용될 수 있는 모든 영역을 다룰 수는 없습니다. 대신, 우리는 그러한 방법이 사용되는 몇 가지 영역과 이를 설명하는 전문 지식 및 문헌이 있는 영역을 선택했습니다. 그러나 다양한 응용 분야의 세부 사항을 살펴보기 전에 섹션 2에서는 사기 탐지를 위한 일부 도구에 대한 간략한 개요를 제공합니다.

## 2 사기 탐지 도구

위에서 언급했듯이 사기 탐지는 감독되거나 감독되지 않을 수 있습니다. 지도 방법은 알려진 사기/합법 사례의 데이터베이스를 사용하여 새로운 사례에 대한 의심 점수를 생성하는 모델을 구성합니다. 선형 판별 분석 및 로지스틱 판별과 같은 전통적인 통계 분류 방법(Hand, 1981; McLachlan, 1992)은 많은 응용 분야에서 효과적인 도구임이 입증되었지만 보다 강력한 도구(Ripley, 1996; Hand, 1997; Webb, 1999), 특히 신경망도 광범위하게 적용되었습니다. 규칙 기반 방법은 If {특정 조건}, Then {a 결과} 형식의 규칙을 사용하여 분류기를 생성하는 지도 학습 알고리즘입니다. 이러한 알고리즘의 예로는 BAYES(Clark and Niblett, 1989), FOIL(Quinlan, 1990) 및 RIPPER(Cohen, 1995)가 있습니다. CART(Breiman, Friedman, Olshen and Stone, 1984) 및 C4.5(Quinlan, 1993)와 같은 트리 기반 알고리즘은 유사한 형식의 분류기를 생성합니다. 이러한 알고리즘 중 일부 또는 전부의 조합은 사기 탐지 예측을 향상시키기 위해 메타 학습 알고리즘을 사용하여 생성될 수 있습니다(예: Chan, Fan, Prodromedis 및 Stolfo, 1999).

사기 탐지를 위한 지도 도구를 구축할 때 고려해야 할 주요 사항에는 클래스 규모가 고르지 않고 다양한 유형의 오분류로 인해 발생하는 비용이 포함됩니다. 또한 관찰 내용을 조사하는 데 드는 비용과 사기 식별에 따른 이점도 고려해야 합니다. 더욱이, 종종 학급 구성원 자격이 불확실합니다. 예를 들어, 신용 거래에는 잘못된 라벨이 지정될 수 있습니다. 사기 거래는 관찰되지 않은 채 합법적인 라벨로 표시될 수 있으며(이 범위는 알 수 없음) 합법적인 거래가 사기로 잘못 보고될 수 있습니다. 일부 작업에서는 훈련 샘플의 잘못된 분류(예: Lachenbruch, 1966, 1974; Chhikara 및 McKeon, 1984)를 다루었지만 우리가 아는 한 사기 탐지의 맥락에서는 그렇지 않습니다. 이와 같은 문제는 Chan과 Stolfo(1998) 및 Provost와 Fawcett(2001)가 논의했습니다.

링크 분석은 기록 연결 및 소셜 네트워크 방법을 사용하여 알려진 사기꾼을 다른 개인과 연관시킵니다(Wasserman and Faust, 1994). 예를 들어, 통신 네트워크에서 보안 조사관은 사기꾼들이 서로 고립되어 활동하는 경우가 거의 없다는 사실을 발견했습니다. 또한 사기로 인해 계정 연결이 끊어진 후 사기꾼은 종종 다른 계정(Cortes, Pregibon 및 Volinsky, 2001)에서 동일한 번호로 전화를 겁니다. 따라서 계정에서 걸려온 전화 통화는 사기 계정과 연결되어 침입을 나타낼 수 있습니다. 자금세탁에서도 유사한 접근 방식이 취해졌습니다(Goldberg and Senator, 1995, 1998; Senator et al., 1995).

비지도 방법은 이전에 합법적이고 사기적인 관찰 세트가 없을 때 사용됩니다. 여기에 사용되는 기술은 일반적으로 프로파일링과 이상치 탐지 방법의 조합입니다. 본 연구에서는 정상적인 행동을 나타내는 기준 분포를 모델링한 다음 이 표준에서 가장 크게 벗어난 관찰을 탐지하려고 시도합니다. 텍스트 분석에서 저자 식별과 유사점이 있습니다. 벤포드의 법칙을 이용한 숫자 분석이 그러한 방법의 예입니다. 벤포드의 법칙(Hill, 1995)은 다양한 무작위 분포에서 추출된 숫자의 첫 번째 유효 자릿수 분포가 (점근적으로) 특정 형식을 갖게 된다고 말합니다. 최근까지 이 법칙은 명백하게 유용한 적용이 없는 단순한 수학적 호기심으로 간주되었습니다. 그러나 Nigrini와 Mittermaier(1997) 및 Nigrini(1999)는 Benford의 법칙을 사용하여 회계 데이터의 사기를 탐지할 수 있음을 보여주었습니다. Benford의 법칙과 같은 도구를 사용하여 사기를 탐지하는 전제는 Benford의 법칙을 준수하는 데이터를 조작하는 것이 어렵다는 것입니다.

사기꾼은 새로운 예방 및 탐지 조치에 적응하므로 사기 탐지는 적응력이 뛰어나고 시간이 지남에 따라 발전해야 합니다. 그러나 합법적인 계정 사용자는 장기간에 걸쳐 점차적으로 행동을 바꿀 수 있으므로 가짜 계정을 피하는 것이 중요합니다.

<!-- 원문 4쪽 -->

## 238 RJ 볼턴과 DJ 핸드

경보. 모델은 고정된 시점에 업데이트되거나 시간이 지남에 따라 지속적으로 업데이트될 수 있습니다. 예를 들어 Burge and Shawe-Taylor(1997), Fawcett and Provost(1997a), Cortes, Pregibon 및 Volinsky(2001) 및 Senator(2000)를 참조하세요.

사기 탐지를 위한 기본 통계 모델은 감독 또는 비지도로 분류될 수 있지만 사기 탐지의 적용 영역은 그렇게 편리하게 설명할 수 없습니다. 이들의 다양성은 특정 운영 특성과 사용 가능한 데이터의 다양성 및 양에 반영됩니다. 두 특성 모두 적합한 사기 탐지 도구를 선택하는 데 영향을 미칩니다.

## 3 신용카드 사기

신용카드 사기의 정도는 정량화하기 어렵습니다. 부분적으로는 회사들이 지출 대중을 놀라게 할 경우를 대비해 사기 수치를 공개하는 것을 꺼리는 경우가 많고, 부분적으로는 시간이 지남에 따라 수치가 변하기 때문입니다(아마도 증가할 것입니다). 다양한 추정치가 제시되었습니다. 예를 들어, Leonard(1993)는 캐나다에서 1989, 1990 및 1991에서 Visa/Mastercard 사기 비용이 각각 $19, 29 및 46 million(캐나다)라고 제안했습니다. Ghosh와 Reilly(1994)는 미국에서 발생하는 모든 유형의 신용 카드 사기에 대해 연간 $850 million(미국)의 수치를 제안했으며, Aleskerov, Freisleben 및 Rao(1997)는 Visa/Mastercard 및 전세계 $10 billion에 대해 매년 미국에서 $700 million의 추정치를 인용했습니다. 1996에서. Microsoft의 Expedia는 1999(환자, 2000)의 신용 카드 사기에 대해 $6 million를 따로 확보했습니다. 영국에서 신용카드 사기로 인한 총 손실은 지난 4년 [1997, £122 million; 1998, £135 million; 1999, £188 million; 2000, £293 million. 출처: Association for Payment Clearing Services, London(APACS)] 및 최근 APACS는 8월 2001로 끝나는 12개월 동안 £373.7 million의 손실을 보고했습니다. Jenkins(2000)는 "영국에서 카드에 지출하는 £100당 13p가 사기꾼에게 손실됩니다"라고 말합니다. 사기 수치에 정확히 무엇이 포함되는지에 대한 문제로 인해 문제는 복잡해집니다. 예를 들어, 파산 사기는 카드 소지자가 지불할 의사가 없는 구매를 한 후 개인 파산을 신청하고 은행이 손실을 충당하도록 하는 경우에 발생합니다. 이는 일반적으로 상각 손실로 간주되므로 사기 수치에 포함되지 않는 경우가 많습니다. 그러나 그 내용은 상당할 수 있습니다. Ghosh와 Reilly(1994)는 1992에서 파산 사기에 대한 추정액 $2.65 billion를 인용했습니다.

사기를 예방하고, 실패할 경우 가능한 한 빨리 사기를 탐지하는 것이 회사와 카드 발급사의 이익입니다. 그렇지 않으면 카드와 회사 모두에 대한 소비자의 신뢰가 감소하고 사기 판매로 인한 직접적인 손실 외에도 수익 손실이 발생합니다. 신용 상실로 인한 매출 손실 가능성 때문에 일반적으로 판매업체가 카드 발급사로부터 승인을 받은 경우에도 사기 손실에 대한 책임은 가맹점에서 집니다.

신용 카드 사기는 단순 절도, 신청 사기, 위조 카드를 포함하여 다양한 방식으로 자행될 수 있습니다(신용 카드 산업에 대한 설명과 신용 카드 산업의 작동 방식은 Blunt and Hand, 2000에 나와 있음). 이 모든 경우에 사기꾼은 실제 카드를 사용하지만 신용 카드 사기를 저지르기 위해 물리적 소지가 반드시 필요한 것은 아닙니다. 주요 사기 영역 중 하나는 카드 세부 정보만 제공되는 "카드 소지자 부재" 사기입니다(예: 전화 통화).

도난당한 카드를 사용하는 것은 아마도 가장 간단한 신용카드 사기 유형일 것입니다. 이 경우 사기꾼은 일반적으로 도난이 감지되고 카드가 중지되기 전에 가능한 한 짧은 시간 내에 최대한 많은 돈을 소비합니다. 따라서 도난을 조기에 발견하면 큰 손실을 예방할 수 있습니다.

신청 사기는 개인이 허위 개인 정보를 사용하여 발급 회사로부터 새로운 신용 카드를 발급받을 때 발생합니다. 전통적인 신용 평가표(Hand and Henley, 1997)는 채무 불이행 가능성이 있는 고객을 탐지하는 데 사용되며 그 이유에는 사기가 포함될 수 있습니다. 이러한 스코어카드는 신청서에 제공된 세부 정보와 국 정보와 같은 기타 세부 정보를 기반으로 합니다. 시간이 지남에 따라 행동을 모니터링하는 통계 모델을 사용하여 사기성 애플리케이션에서 얻은 카드를 탐지할 수 있습니다(예: 카드가 부족하고 빠르게 많은 구매를 하는 최초 카드 소지자는 의심을 불러일으킬 수 있습니다). 그러나 신청 사기의 경우 사기꾼에게는 긴급성이 그다지 중요하지 않으며 계좌가 발송되거나 상환 날짜가 지나기 전에는 사기가 의심될 수 있습니다.

카드 소지자 부재 사기는 원격으로 거래할 때 발생하므로 카드 정보만 필요하며, 구매 시 수기 서명 및 카드 각인이 필요하지 않습니다. 이러한 거래에는 전화판매, 온라인 거래가 포함되며, 이러한 유형의 사기는 손실 비율이 높습니다. 이러한 사기를 저지르려면 카드 소지자가 모르는 사이에 카드 세부 정보를 알아내야 합니다. 직원이 작은 휴대용 카드 리더기를 통해 신용카드의 자기 띠를 긁어 불법적으로 복사하는 '스키밍', 줄을 서서 구매자 뒤에 서서 휴대전화에 카드 정보를 입력하는 '숄더 서퍼', 신용카드로 가장하는 사람들 등 다양한 방법으로 이루어집니다.

<!-- 원문 5쪽 -->

## 통계적 사기 감지 239

카드사 직원이 전화로 회사의 신용카드 거래 내역을 확인하는 모습. 현재 영국에서 신용 카드 사기의 최대 원인인 위조 카드(출처: APACS)도 이 정보를 사용하여 생성될 수 있습니다. 위조 카드를 사용하고 카드 소지자가 없는 구매를 하는 사기꾼의 거래는 거래 패턴의 변화를 찾는 방법과 위조를 나타내는 것으로 알려진 특정 패턴을 확인하는 방법을 통해 탐지할 수 있습니다.

신용카드 데이터베이스에는 각 거래에 대한 정보가 포함되어 있습니다. 이 정보에는 판매자 코드, 계좌 번호, 신용 카드 유형, 구매 유형, 고객 이름, 거래 규모 및 거래 날짜 등이 포함됩니다. 이러한 데이터 중 일부는 숫자(예: 거래 규모)이고 다른 일부는 명목상 범주(예: 수십만 개의 범주를 가질 수 있는 상품 코드) 또는 기호입니다. 혼합된 데이터 유형으로 인해 다양한 통계, 기계 학습 및 데이터 마이닝 도구가 적용되었습니다.

계정이 손상되었는지 여부를 감지하기 위한 의심 점수는 개별 고객의 이전 사용 패턴, 표준 예상 사용 패턴, 종종 사기와 관련된 것으로 알려진 특정 패턴 모델 및 감독 모델을 기반으로 할 수 있습니다. 개별 고객이 나타내는 패턴의 간단한 예는 Hand and Blunt(2001)의 그림 16에 나와 있으며, 이는 시간이 지남에 따라 누적 신용 카드 지출의 기울기가 현저하게 선형임을 보여줍니다. 이러한 곡선의 갑작스러운 점프 또는 기울기의 급격한 변화(거래 또는 지출 비율이 갑자기 특정 임계값을 초과함)는 조사할 가치가 있습니다. 마찬가지로 일부 고객은 특정 유형의 구매에만 특정 카드를 제한하여(예: 휘발유 구매에만 특정 카드를 사용하고 슈퍼마켓 구매에는 다른 카드를 사용) "잼 방해"를 실행하여 카드를 사용하여 비정상적인 유형의 구매를 하는 경우 해당 고객에게 경보가 울릴 수 있습니다. 보다 일반적인 수준에서 의심 점수는 예상되는 전체 사용 프로필을 기반으로 할 수도 있습니다. 예를 들어, 신용카드를 처음 사용하는 사용자는 일반적으로 처음에는 사용에 있어 상당히 잠정적인 반면, 다른 카드에서 대출을 이체하는 사용자는 일반적으로 그렇게 과묵하지 않습니다. 마지막으로, 본질적으로 의심스러운 것으로 알려진 전반적인 거래 패턴의 예로는 소형 전자제품이나 보석류(암시장에서 쉽게 재판매할 수 있는 제품)를 갑자기 구입하는 것과 다양한 위치에서 새 카드를 즉시 사용하는 것 등이 있습니다.

위에서 우리는 명백한 이유로 사기 탐지에 관해 출판된 문헌이 부족하다고 언급했습니다. 발표된 내용의 대부분은 방법론적 데이터 분석 문헌에 나타나며, 여기서 목적은 사기 탐지 방법 자체를 설명하기보다는 사기 탐지에 적용하여 새로운 데이터 분석 도구를 설명하는 것입니다. 게다가 이상 징후 탐지 방법은 상황에 따라 크게 달라지기 때문에 해당 분야에 출판된 문헌의 대부분은 감독된 분류 방법에 집중되어 있습니다. 특히 규칙 기반 시스템과 신경망이 관심을 끌었습니다. 신용카드 사기 탐지를 위해 신경망을 사용한 연구자로는 Ghosh와 Reilly(1994), Aleskerov 등이 있습니다. (1997), Dorronsoro, Ginel, Sanchez 및 Cruz(1997) 및 Brause, Langsdorf 및 Hepp(1999)는 주로 지도 분류의 맥락에서 사용됩니다. HNC Software는 신용카드 사기를 탐지하기 위해 신경망 기술에 크게 의존하는 소프트웨어 패키지인 Falcon을 개발했습니다.

사기성/비사기성 클래스의 샘플을 기반으로 향후 사기 사례를 탐지하기 위한 분류 규칙을 구성하는 감독 방법은 위에서 언급한 불균형 클래스 크기 문제로 어려움을 겪습니다. 일반적으로 합법적인 거래가 사기성 거래보다 훨씬 많습니다. Brause, Langsdorf 및 Hepp(1999)은 신용 카드 거래 데이터베이스에서 "사기 확률은 매우 낮으며(0.2%) 기존 사기 탐지 시스템에 의해 전처리 단계에서 0.1%까지 낮아졌습니다."라고 말했습니다. Hassibi(2000)는 "연간 발생하는 일부 12 billion 거래 중 약 10 million 또는 모든 1200 거래 중 하나가 사기로 판명되었습니다. 또한 모든 월간 활성 계정의 0.04%(10,000 중 4)는 사기야." 이런 종류의 그림에서 단순 오분류율은 성능 측정으로 사용할 수 없다는 결론이 나옵니다. 0.1%의 잘못된 비율로 단순히 모든 거래를 합법적인 것으로 분류하면 0.001의 오류율만 생성됩니다. 대신 적절한 비용 가중 손실을 최소화하거나 일부 매개변수(예: 자세히 조사할 수 있는 사례 수)를 수정한 다음 제약 조건에 따라 탐지된 사기 사례 수를 최대화해야 합니다.

Stolfoet al. (1997a, b)는 서로 다른 기업 환경 내에서 서로 다른 지역 사기 탐지 도구를 사용하고 결과를 병합하여 보다 정확한 글로벌 도구를 생성한다는 아이디어를 기반으로 하는 신용 ​​카드 사기 탐지를 위한 메타 분류 시스템을 개괄적으로 설명했습니다. 이 연구는 Chan and Stolfo(1998), Chan, Fan, Prodromedis and Stolfo(1999) 및 Stolfo et al.에서 자세히 설명되었습니다. (1999)는 다양한 분류 결과에 수반되는 보다 현실적인 비용 모델을 설명했습니다. Wheeler와 Aitken(2000)도 여러 분류 규칙의 조합을 탐색했습니다.

<!-- 원문 6쪽 -->

## 240 R. J. BOLTON 및 D. J. 핸드 4. 자금세탁

자금세탁은 불법 활동으로 얻은 이익인 자금(보통 현금)의 출처, 소유권 또는 사용을 모호하게 하는 프로세스입니다. 문제의 규모는 1995 미국 기술 평가국(OTA) 보고서(U.S. Congress, 1995)에 나와 있습니다. "연방 기관에서는 전 세계적으로 매년 $300 billion만큼 세탁되는 것으로 추산합니다. 이 중 $40 billion에서 $80 billion까지 미국에서 벌어들이는 의약품 수익이 될 수 있습니다." 예방은 법적 제약과 요구 사항을 통해 시도되며 그 부담은 점차 증가하고 있으며 최근에는 암호화 사용에 대해 많은 논의가 있었습니다. 그러나 완벽한 예방 전략은 없으며 탐지가 필수적입니다. 특히, 뉴욕시와 국방부에 대한 9.11 테러 공격으로 인해 테러리스트의 자금 네트워크를 고갈시키려는 시도로 자금세탁을 적발하는 데 관심이 집중되었습니다.

전신 송금은 세탁을 위한 자연스러운 영역을 제공합니다. OTA 보고서에 따르면 매일 1995에서 $2조(미국) 이상에 달하는 약 50만 건의 전신 송금이 Fedwire 및 CHIPS 시스템을 사용하여 수행되었으며 거의 ​​25만 건은 SWIFT 시스템을 사용하여 수행되었습니다. 이러한 거래 중 약 0.05–0.1%에는 세탁이 포함된 것으로 추정됩니다. 이러한 세탁 활동을 탐지하려면 정교한 통계 및 기타 온라인 데이터 분석 절차가 필요합니다. 이제 사기를 탐지하기 위해 모든 합리적인 수단이 사용되었음을 입증하는 것이 법적 요구 사항이 되었기 때문에 이러한 도구의 적용이 더욱 확대될 것으로 예상할 수 있습니다.

전신송금에는 이체일자, 송금인 신원, 송금은행 고유번호, 수취인 신원, 수취은행 고유번호, 이체금액 등의 항목이 포함됩니다. 때로는 전송에 필요하지 않은 필드가 공백으로 남아 있고, 자유 텍스트 필드가 다른 방식으로 완성될 수 있으며, 더 나쁜 것은 불가피하지만 때로는 데이터에 오류가 있을 수 있습니다. 가능한 콘텐츠에 대한 의미론적 및 구문론적 제약을 기반으로 자동 오류 감지(및 수정) 소프트웨어가 개발되었지만 물론 이것이 완전한 솔루션이 될 수는 없습니다. 은행이 데이터를 공유하지 않는다는 사실로 인해 문제도 복잡해집니다. 물론, 은행만이 전자적으로 자금을 이체하는 기관은 아니며, 정확하게 이러한 목적을 위해 다른 사업체가 설립되었습니다[OTA 보고서(미국 의회, 1995)에서는 200,000와 같은 사업체의 수를 추정합니다].

자금세탁 적발은 예를 들어 신용카드 산업과 같은 분야에서는 발생하지 않는 어려움을 나타냅니다. 신용카드 사기는 상당히 초기에 밝혀지는 반면, 자금세탁에서는 개인 이체나 계좌가 세탁 과정의 일부로 확실하고 합법적으로 식별되기까지 몇 년이 걸릴 수 있습니다. 원칙적으로(기록이 보관되어 있다고 가정하면) 관련 거래를 다시 추적할 수 있지만 실제로는 모든 거래를 식별할 수 없으므로 지도 탐지 방법에 사용하는 것이 어렵습니다. 더욱이, 일반적으로 투자 은행의 계좌 소유자가 이용할 수 있는 정보는 소매 금융 업무에 비해 덜 광범위합니다. 보다 상세한 고객 기록 시스템을 개발하는 것이 좋은 방법이 될 수 있습니다.

다른 사기 분야와 마찬가지로 자금세탁 탐지도 예방과 함께 작동합니다. 예를 들어, 1970에서는 미국 은행 비밀법에 따라 은행이 $10,000 이상의 모든 통화 거래를 당국에 보고해야 했습니다. 그러나 다른 사기 분야와 마찬가지로 가해자는 당국의 변화하는 전술에 맞춰 자신의 작업 방식을 조정합니다. 따라서 은행이 $10,000 이상의 통화 거래를 보고해야 한다는 요구 사항에 따라 더 큰 금액을 $10,000 미만의 여러 금액으로 나누어 다른 은행에 예금하는 명백한 전략이 개발되었습니다(스머핑 또는 구조화라고 불리는 관행). 미국에서는 현재 이것이 불법이지만, 자금세탁 행위자들이 현행 적발 방식에 적응하는 방식을 보면 무능한 자금세탁 행위자만 적발된다는 비관적인 시각으로 이어질 수 있다. 이는 분명히 감독된 탐지 방법의 가치를 제한합니다. 탐지된 패턴은 과거 사기의 특징이었지만 더 이상 그렇지 않을 수 있는 패턴입니다. 감독 방법의 가치를 제한하는 자금세탁업자가 사용하는 다른 전략으로는 전신 현금 이동과 실물 현금 이동 간 전환, 위장 사업 설립, 허위 송장 발행, 단일 이체 자체가 세탁 거래로 보이지 않을 가능성이 있다는 사실 등이 있습니다. 더욱이, 관련된 금액이 크기 때문에 자금세탁 행위자는 고도로 전문적이며 적용되는 적발 전략의 세부사항을 피드백할 수 있는 은행과의 접촉을 갖고 있는 경우가 많습니다.

1980년대 중반 이후 금액이 $10,000를 초과하는 통화 거래 건수는 신고 건수가 엄청나게 많아질 정도로(1994의 10 million 이상, 총 가치가 $500 billion 정도) 그 자체로 어려움을 초래할 수 있습니다. 이에 대처하기 위해 미국 재무부의 금융 범죄 집행 네트워크(FinCEN)는 이러한 모든 보고서를 다음을 사용하여 처리합니다.

<!-- 원문 7쪽 -->

## 통계적 사기 감지 241

아래에 설명된 FinCEN 인공 지능 시스템(FAIS). 보다 일반적으로 은행은 의심 거래를 보고해야 하며, 통화 거래 보고서의 약 0.5%가 그렇게 표시됩니다.

자금세탁에는 세 단계가 포함됩니다.

1. 배치: 은행 시스템이나 합법적인 사업에 현금을 도입하는 것(예: 소매 마약 거래에서 얻은 지폐를 자기앞 수표로 이전). 이를 수행하는 한 가지 방법은 국제 국경을 넘어 수입되는 상품에 대해 엄청나게 부풀려진 금액을 지불하는 것입니다. Pak과 Zdanowicz(1994)는 수출에 대해 그램당 $0.08를 부과하는 것과 비교하여 에리스로마이신 수입에 대해 그램당 $1694를 청구하는 등 정부 무역 데이터에서 이상 징후를 탐지하기 위한 무역 데이터베이스의 통계 분석을 설명했습니다. 2. 계층화(Layering): 합법적인 금융 시스템에서 서로 다른 금융 기관의 서로 다른 소유자와 여러 계정을 통해 여러 거래를 수행합니다. 3. 통합: 합법적인 활동을 통해 얻은 자금과 자금을 병합합니다.

탐지 전략은 다양한 수준에서 목표로 삼을 수 있습니다. 일반적으로(그리고 사기가 자행되는 다른 영역과 마찬가지로) 개별 거래를 사기로 규정하는 것은 매우 어렵거나 불가능합니다. 오히려 거래 패턴이 사기성인지 의심스러운지 식별해야 합니다. $10,000 미만의 단일 입금액은 의심스럽지 않지만 이러한 예금이 여러 개 있는 경우에는 의심스럽습니다. 큰 금액이 입금된 것은 의심되지 않지만, 큰 금액이 입금되었다가 즉시 인출되는 것은 의심스럽습니다. 실제로 개인 거래 수준, 계정 수준, 비즈니스 수준(실제로 개인은 여러 계정을 가질 수 있음) 및 비즈니스 수준의 "링"과 같은 여러 수준의 (잠재적) 분석을 구분할 수 있습니다. 분석은 특정 수준을 대상으로 할 수 있지만 보다 복잡한 접근 방식은 여러 수준을 동시에 조사할 수 있습니다. (음성 인식 시스템과 유사한 점이 있습니다. 개별 음소 및 단어 수준에 초점을 맞춘 단순한 시스템은 단어가 사용될 때 결합되는 방식의 더 높은 수준의 맥락에서 이러한 요소를 인식하려는 시스템만큼 효과적이지 않습니다.) 일반적으로 거래에 관련된 참가자 그룹을 식별하는 링크 분석은 대부분의 자금세탁 탐지 전략에서 핵심 역할을 합니다. 상원의원 외. (1995)는 "자금세탁은 일반적으로 서로 다른 은행 및 기타 금융 기관의 여러 소유주가 있는 여러 계좌에 개별 개인이 다수의 거래를 포함하는 것을 의미합니다. 대규모 자금세탁 계획을 탐지하려면 잠재적으로 관련이 있는 거래를 연결한 다음 합법적인 거래 집합과 불법적인 거래 집합을 구별하여 이러한 거래 패턴을 재구성할 수 있는 능력이 필요합니다. 링크 분석이라고 하는 정보 요소 간의 관계를 찾는 이 기술은 법 집행 정보에 사용되는 기본 분석 기술입니다. (앤드류스와 피터슨, 1990)." 명백하고 단순한 예는 알려진 범죄자와의 거래가 의심을 불러일으킬 수 있다는 사실입니다. 보다 미묘한 방법은 자금세탁 활동이 거래되는 기업의 종류에 대한 인식을 기반으로 합니다. 물론, 이것들은 모두 감독된 방법이며 책임자가 전략을 발전시킬 수 있다는 약점이 있습니다. 다음 섹션에 설명된 대로 유사한 도구를 사용하여 통신 사기를 탐지합니다.

규칙 기반 시스템은 종종 경험에 기반한 규칙을 사용하여 개발되었습니다("X 및 Y 국가의 플래그 거래", "큰 예금이 발생한 후 즉시 비슷한 규모의 인출이 발생하는 플래그 계정"). 구조화는 하루와 같은 짧은 기간 동안 계정에 입력된 금액의 누적 합계를 계산하여 감지할 수 있습니다. 거래율, 의심 거래 비율과 같은 간단한 기술 통계를 기반으로 다른 방법이 개발되었습니다. Benford 분포의 사용은 이 아이디어의 확장입니다. 일반적으로 계정 행동의 변화를 탐지하는 데 관심이 없을 수도 있지만 피어 그룹 분석(Bolton and Hand, 2001) 및 브레이크 감지(Goldberg and Senator, 1997)와 같은 방법을 적용하여 자금세탁을 탐지할 수 있습니다.

가장 정교한 자금세탁 탐지 시스템 중 하나는 Senator et al.에 설명된 미국 금융 범죄 집행 네트워크 AI 시스템(FAIS)입니다. (1995) 및 골드버그와 상원의원(1998). 이 시스템을 통해 사용자는 연결된 거래의 흔적을 따라갈 수 있습니다. 이는 프로그램 모듈이 거래, 주제 및 계정의 세부 정보가 포함된 중앙 데이터베이스를 읽고 쓸 수 있는 "블랙보드" 아키텍처를 기반으로 구축되었습니다. 시스템의 핵심 구성 요소는 의심 점수입니다. 이는 1980년대 중반 미국 관세청이 개발한 초기 시스템을 기반으로 한 규칙 기반 시스템입니다. 시스템은 다양한 유형의 거래 및 활동에 대한 의심 점수를 계산합니다. 단순 베이지안 업데이트는 거래나 활동이 불법임을 암시하는 증거를 결합하여 전체 의심 점수를 산출하는 데 사용됩니다. 상원의원 외. (1995)에는 사례 기반 추론(가장 가까운 참조) 여부에 대한 조사에 대한 간단하지만 흥미로운 토론이 포함되어 있습니다.

<!-- 원문 8쪽 -->

## 242 RJ 볼턴과 DJ 핸드

이웃 방법) 및 분류 트리 기술을 시스템에 유용하게 추가할 수 있습니다.

미국 증권 딜러 협회(American National Association of Securities Dealers, Inc.)는 고급 감지 시스템(ADS; Kirkland et al., 1998; Senator, 2000)을 사용하여 "규제 문제가 있는 패턴 또는 관행"을 표시합니다. ADS는 규칙 패턴 일치자 및 시간 순서 패턴 일치자를 사용하며 (FAIS와 같이) 시각화 도구에 중점을 둡니다. 또한 FAIS와 마찬가지로 데이터 마이닝 기술을 사용하여 잠재적인 관심의 새로운 패턴을 식별합니다.

유사한 사기 행위를 탐지하기 위한 다른 접근법은 내부자 거래와 시장 조작을 탐지하기 위해 유전자 알고리즘, 퍼지 논리 및 신경망 기술을 결합한 MonITARS(내부자 거래 모니터링 및 규제 감시)라는 런던 증권 거래소용 시스템을 개발한 SearchSpace Ltd.(www.searchspace.com)에서 취합니다. Chartier와 Spillane(2000)도 자금세탁을 탐지하기 위한 신경망 애플리케이션을 설명했습니다.

## 5 통신 사기

통신 산업은 저렴한 휴대폰 기술의 개발로 지난 몇 년 동안 극적으로 성장했습니다. 휴대폰 사용자 수가 증가함에 따라 전 세계적으로 휴대폰 사기도 증가할 것으로 예상됩니다. 이 사기로 인한 비용에 대해 다양한 추정치가 제시되었습니다. 예를 들어 Cox, Eick, Wills 및 Brachman(1997)은 연간 $1 billion의 수치를 제공했습니다. 통신 및 네트워크 보안 검토[4(5) 4월 1997]에서는 사기로 인해 미국 통신 수익 손실이 4~6% 사이에 해당한다고 밝혔습니다. Cahill, Lambert, Pinheiro 및 Sun(2002)은 "여러 신규 서비스 제공업체가 20% 이상의 손실을 보고"하면서 국제 수치가 더 나쁘다고 제안했습니다. Moreauet al. (1996)는 "연간 수백만 ECU"의 가치를 부여했습니다. 아마도 이는 유럽연합 내를 의미하며, 다른 추정치의 규모를 고려할 때 이것이 수십억 달러가 되어야 하는지 궁금합니다. 최근 보고서(Neural Technologies, 2000)에 따르면 "업계에서는 이미 사기로 인해 매년 £13 billion의 손실을 보고하고 있습니다." Mobile Europe(2000)은 $13 billion(미국)의 수치를 제공했습니다. 후자의 기사에서는 또한 사기꾼이 일부 사업자 수익의 최대 5%를 훔칠 수 있는 것으로 추산되며 일부에서는 전체 통신 사기가 3년 내에 연간 $28 billion에 도달할 것으로 예상한다고 주장했습니다.

이 수치의 다양성에도 불구하고 모두 매우 크다는 것은 분명합니다. 이는 단순한 추정치이므로 이를 도출하는 데 사용된 정보에 따라 예상되는 부정확성과 변동성이 있을 수 있다는 사실 외에도 차이점이 있는 다른 이유가 있습니다. 하나는 경화와 소프트 통화의 구별입니다. 경화는 가해자가 훔친 서비스에 대해 가해자가 아닌 다른 사람이 지불하는 실제 돈입니다. Hynninen(2000)은 한 이동통신 사업자가 네트워크 사용에 대해 다른 이동통신 사업자에게 지불하는 금액의 예를 제시했습니다. 소프트 화폐는 가해자가 훔친 서비스의 가치입니다. 도둑이 비용을 지불해야 했더라도 동일한 서비스를 사용했을 것이라고 가정하면 이 중 적어도 일부는 손실일 뿐입니다. 차이가 나는 또 다른 이유는 그러한 추정치가 다른 목적으로 사용될 수 있다는 사실에서 비롯됩니다. Hynninen(2000)은 더 엄격한 사기 방지법을 기대하면서 높은 쪽에서 견적을 제공하는 운영자와 고객 신뢰를 장려하기 위해 낮은 쪽에서 견적을 제공하는 운영자의 예를 제시했습니다.

서비스 제공자를 겨냥한 사기와 서비스 제공자가 자행한 사기를 구별해야 합니다. 전자의 예로는 통화시간을 훔친 것을 재판매하는 행위가 있고, 후자의 경우에는 텔레뱅킹 지시를 방해하는 행위가 있다. (대중이 인터넷을 통해 신용 카드를 사용하는 것을 경계하게 만드는 것은 후자 종류의 사기 가능성입니다.) 또한 수익 사기와 비수익 사기를 구별할 수도 있습니다. 전자의 목적은 가해자를 위해 돈을 버는 것이지만, 후자의 목적은 단순히 무료로 서비스를 얻는 것입니다(또는 컴퓨터 해커의 경우와 마찬가지로 시스템으로 표시되는 단순한 도전).

다양한 유형의 통신 사기가 있으며(예: Shawe-Taylor et al., 2000 참조) 이러한 사기는 다양한 수준에서 발생할 수 있습니다. 가장 널리 퍼진 두 가지 유형은 구독 사기와 중첩 또는 "서핑" 사기입니다. 구독 사기는 사기꾼이 비용을 지불할 의도 없이 허위 신원 정보를 사용하여 서비스 구독을 획득할 때 발생합니다. 따라서 이는 전화번호 수준에 해당합니다. 이 번호를 통한 모든 거래는 사기가 됩니다. 중첩된 사기는 필요한 권한 없이 서비스를 사용하는 것이며 일반적으로 청구서에 유령 전화가 나타나는 것으로 감지됩니다. 휴대폰 복제, 전화 카드 인증 정보 획득 등 중첩 사기를 수행하는 방법에는 여러 가지가 있습니다. 중첩된 사기는 일반적으로 개별 전화 수준에서 발생합니다. 사기 전화는 합법적 전화와 혼합됩니다. 구독 사기는 일반적으로 청구 프로세스의 어느 시점에서 감지됩니다. 하지만 큰 비용이 빨리 소진될 수 있으므로 그 전에 감지하는 것이 목표입니다. 중첩된 사기는 오랫동안 감지되지 않은 채로 남아 있을 수 있습니다. 구별

<!-- 원문 9쪽 -->

## 통계적 사기 감지 243

이 두 가지 유형의 사기 사이에는 신용 카드 사기에서도 비슷한 차이가 있습니다.

다른 유형의 통신 사기에는 "고스팅"(무료 통화를 얻기 위해 네트워크를 속이는 기술)과 통신 회사 직원이 사기 이득을 위해 악용할 수 있는 정보를 범죄자에게 판매하는 내부 사기가 포함됩니다. 물론 이는 영역에 상관없이 사기의 보편적인 원인입니다. "텀블링(Tumbling)"은 복제된 휴대폰에 롤링 가짜 일련번호를 사용하여 연속 통화가 다른 합법적인 휴대폰으로 연결되는 일종의 중첩 사기입니다. 비정상적인 패턴을 발견하여 탐지할 확률은 낮으며, 불법 전화기는 추정된 신원이 모두 발견될 때까지 작동됩니다. "스푸핑"이라는 용어는 때때로 다른 사람인 것처럼 가장하는 사용자를 설명하는 데 사용됩니다.

통신 네트워크는 때로는 하루에 몇 기가바이트에 달하는 방대한 양의 데이터를 생성하므로 데이터 마이닝 기술이 특히 중요합니다. 예를 들어 AT&T의 1998 데이터베이스에는 350 million 프로필이 포함되어 있으며 하루에 275 million 통화 기록이 처리되었습니다(Cortes 및 Pregibon, 1998). 다른 사기 영역과 마찬가지로 일부 영역별 도구를 제외하고 탐지 방법은 규칙 기반 방법을 사용하거나 통계적으로 도출된 의심 점수를 일부 임계값과 비교하는 방식으로 이상치 탐지 및 감독 분류에 달려 있습니다. 낮은 수준에서 간단한 규칙 기반 탐지 시스템은 지리적으로 매우 먼 두 위치에서 동일한 전화를 연속해서 빠르게 사용하는 것, 시간이 겹치는 것처럼 보이는 통화, 가치가 매우 높고 매우 긴 통화와 같은 규칙을 사용합니다. 더 높은 수준에서는 통화 분포의 통계 요약(사용자 수준에서 프로필 또는 서명이라고도 함)을 전문가가 결정하거나 알려진 사기/비사기 사례에 지도 학습 방법을 적용하여 결정한 임계값과 비교합니다. Murad 및 Pinkas(1999) 및 Rosset et al. (1999)은 개별 통화 수준의 프로파일링, 일일 통화 패턴 및 전체 통화 패턴을 구분하고 이상 행위를 탐지하기 위한 효과적인 이상치 탐지 방법이 무엇인지 설명했습니다. 프로파일링 방법에 대한 특히 흥미로운 설명은 Cortes 및 Pregibon(1998)에 의해 제공되었습니다. Cortes, Fisher, Pregibon 및 Rogers(2000)는 평균 통화 시간, 가장 긴 통화 시간, 마지막 날 특정 지역에 대한 통화 수 등과 같은 수량을 기준으로 서명을 기반으로 프로필 처리용 프로그램을 작성하기 위한 Hancock 언어를 설명했습니다. 프로파일링 및 분류 기술은 Fawcett 및 Provost(1997a, b, 1999) 및 Moreau, Verrelst 및 Vandewalle(1997)에 의해 설명되었습니다. 일부 연구(예: Fawcett and Provost, 1997a 참조)는 행동 변화를 감지하는 데 중점을 두었습니다.

일반적인 문제는 서명과 임계값이 시간, 계정 유형 등에 따라 달라져야 하며 시간이 지남에 따라 업데이트되어야 한다는 것입니다. Cahillet al. (2002)는 이 영역에 더 많은 작업이 필요하지만 업데이트 프로세스에서 매우 의심스러운 점수를 제외할 것을 제안했습니다.

이번에도 신경망이 널리 사용되었습니다. Nortel Networks 사기 솔루션 유닛(Nortel, 2000)의 주요 사기 탐지 소프트웨어는 프로파일링과 신경망의 조합을 사용합니다. 마찬가지로 유럽 위원회, Vodaphone, 기타 유럽 통신 회사 및 학계의 프로젝트인 ASPeCT(Moreau 외, 1996; Shawe-Taylor 외, 2000)는 결합된 규칙 기반 프로파일링 및 신경망 접근 방식을 개발했습니다. Taniguchi, Haft, Hollmén 및 Tresp(1998)는 청구용으로 저장된 통화 기록을 기반으로 통신 사기 탐지에 사용되는 신경망, 혼합 모델 및 베이지안 네트워크를 설명했습니다.

시간이 지남에 따라 링크가 업데이트되는 링크 분석은 사기꾼 네트워크를 나타낼 수 있는 "관심 커뮤니티"(Cortes, Pregibon 및 Volinsky, 2001)를 설정합니다. 이러한 방법은 사기꾼이 통화 습관을 거의 바꾸지 않지만 종종 다른 사기꾼과 밀접하게 연관되어 있다는 관찰에 기초합니다. 유사한 거래 패턴을 사용하여 특정 사기꾼의 존재를 추론하는 것은 경이로운 데이터 마이닝의 정신입니다(McCarthy, 2000).

매우 큰 데이터셋를 마이닝하기 위해 개발된 시각화 방법(Cox et al., 1997)도 통신 사기 탐지에 사용하기 위해 개발되었습니다. 여기서 인간의 패턴 인식 기술은 다양한 지리적 위치에 있는 서로 다른 가입자 간의 통화량을 그래픽 컴퓨터로 표시하는 것과 상호 작용합니다. 가능한 미래 시나리오는 인간이 감지하는 패턴을 소프트웨어에 코딩하는 것입니다.

통신 시장은 시간이 지남에 따라 사기 가능성이 높아져 더욱 복잡해질 것입니다. 현재 사기의 정도는 통화 시간, 요금 등의 요소를 고려하여 측정됩니다. 3세대 휴대폰 기술에서는 통화 내용(사용된 패킷 교환 기술로 인해 동일하게 긴 데이터 전송에 매우 다른 수의 데이터 패킷이 포함될 수 있음) 및 통화 우선순위 등을 고려해야 합니다.

<!-- 원문 10쪽 -->

## 244 R. J. BOLTON 및 D. J. 핸드 6. 컴퓨터 침입

9월 목요일, 21, 2000, 16세 소년이 국방부와 NASA 컴퓨터 시스템을 해킹한 혐의로 투옥되었습니다. 10월 14일부터 25일까지 2000 Microsoft 보안 팀은 Microsoft 기업 네트워크에서 해커의 불법 활동을 추적했습니다. 이러한 예는 예외적으로 잘 보호되는 도메인이라도 컴퓨터 보안이 손상될 수 있음을 보여줍니다.

컴퓨터 침입 사기는 큰 사업이며 컴퓨터 침입 탐지는 매우 집중적인 연구 분야입니다. 해커는 비밀번호 찾기, 파일 읽기 및 변경, 소스 코드 변경, 이메일 읽기 등을 할 수 있습니다. Denning(1997)은 8가지 종류의 컴퓨터 침입을 나열했습니다. 해커가 컴퓨터 시스템에 침투하는 것을 방지하거나 조기에 탐지할 수 있다면 그러한 범죄는 사실상 제거될 수 있습니다. 그러나 상금이 높은 모든 사기와 마찬가지로 공격은 적응형이며 일단 한 종류의 침입이 인식되면 해커는 다른 경로를 시도합니다. 그 중요성 때문에 침입 탐지 방법 개발에 많은 노력을 기울였으며 Cisco 보안 침입 탐지 시스템(CSIDS, 1999) 및 차세대 침입 탐지 전문가 시스템(NIDES, Anderson, Frivold and Valdes, 1995)을 비롯한 여러 상용 제품이 있습니다.

해커의 활동에 대한 유일한 기록은 시스템을 침해할 때 사용되는 일련의 명령이기 때문에 컴퓨터 침입 데이터 분석가는 주로 시퀀스 분석 기술을 사용합니다. 다른 사기 상황과 마찬가지로 감독 방법과 비감독 방법이 모두 사용됩니다. 침입 탐지의 맥락에서 감독된 방법은 오용 탐지라고도 하는 반면, 감독되지 않은 방법은 일반적으로 각 합법적인 사용자의 사용 패턴 프로필을 기반으로 하는 이상 탐지 방법입니다. 감독 방법에는 이미 발생한(또는 부분적으로 일치하는) 침입 패턴에 대해서만 작동할 수 있다는 다른 맥락에서 설명된 문제가 있습니다. Lee와 Stolfo(1998)는 정상 또는 비정상으로 식별된 사용자 또는 프로그램의 데이터에 분류 기술을 적용했습니다. Lippmannet al. (2000)는 기존 패턴보다는 새로운 침입 패턴을 탐지하는 방법을 개발하는 데 중점을 두어야 한다고 결론지었지만 Kumar와 Spafford(1994)는 "대부분의 침입은... 대응 팀(예: CERT)의 보고에 의해 입증된 바와 같이 소수의 알려진 공격의 결과입니다. 따라서 이러한 공격 탐지를 자동화하면 상당수의 침입 시도가 탐지되어야 합니다."라고 말했습니다. Shieh 및 Gligor(1991, 1997)는 패턴 일치 방법을 설명하고 이 방법이 알려진 유형의 침입을 탐지하는 데 통계적 방법보다 더 효과적이지만 통계적 방법으로 탐지할 수 있는 새로운 종류의 침입 패턴을 탐지할 수 없다고 주장했습니다.

침입은 행동을 나타내며 침입 행동과 시퀀스의 일반적인 행동을 구별하는 것이 목표이므로 Markov 모델이 자연스럽게 적용되었습니다(예: Ju 및 Vardi, 2001). Quet al. (1998)도 이벤트 확률을 사용하여 프로필을 정의했습니다. Forrest, Hofmeyr, Somayaji 및 Longstaff(1996)는 자연 면역 체계가 자기 패턴과 외계인 패턴을 구별하는 방법을 기반으로 한 방법을 설명했습니다. 통신 데이터와 마찬가지로 개별 사용자 패턴과 전반적인 네트워크 동작은 시간이 지남에 따라 변하므로 탐지 시스템은 변화에 적응할 수 있어야 하지만 침입을 합법적인 변화로 받아들일 정도로 빠르게 적응해서는 안 됩니다. Lane 및 Brodley(1998)와 Kosoresow 및 Hofmeyr(1997)도 확률적 프레임워크에서 해석할 수 있는 시퀀스의 유사성을 사용했습니다.

필연적으로 신경망이 사용되었습니다. Ryan, Lin 및 Miikkulainen(1997)은 프로세스 데이터에 대한 신경망을 훈련하여 프로파일링을 수행하고 다른 신경 접근 방식도 참조했습니다. 이 분야의 보다 신중한 연구 중 하나인 Schonlau et al. (2001)는 다른 사용자의 사칭(가장)을 탐지하기 위한 6가지 통계적 접근 방식에 대한 비교 연구를 설명합니다. 여기서는 50 사용자로부터 실제 사용 데이터를 가져와 탐지할 가장 무도회 대상으로 사용하기 위해 다른 사용자로부터 오염 데이터를 심었습니다. 컴퓨터 침입 탐지의 통계 문제에 대한 훌륭한 개요는 Marchette(2001)에 의해 제공되었으며 Computer Networks의 10월 2000 판[34(4)]은 컴퓨터 침입 탐지에 대한 새로운 접근 방식의 몇 가지 예를 포함하여 (상대적으로) 최근 침입 탐지 시스템의 발전에 대한 특별 호입니다.

## 7 의료 및 과학 사기

의료 사기는 다양한 수준에서 발생할 수 있습니다. 이는 임상 시험에서 발생할 수 있습니다(예: Buyse et al., 1999 참조). 예를 들어, 처방 사기, 사망했거나 존재하지 않는 환자에 대한 보험금 청구, 의사가 의료 절차를 수행하지만 더 비싼 의료 절차에 대해 보험사에 비용을 청구하거나 전혀 수행하지 않는 업코딩 등 보다 상업적인 맥락에서도 발생할 수 있습니다. Allen(2000)은 근무일에 24시간 이상 제출된 청구서의 예를 제시했습니다. 그, 왕, 그레이코, 호킨스(1997)

<!-- 원문 11쪽 -->

## 통계적 사기 감지 245

He, Graco 및 Yao(1999)는 신경망, 유전자 알고리즘 및 최근접 방법을 사용하여 호주 일반의의 진료 프로필을 정상에서 비정상까지 분류하는 방법을 설명했습니다.

의료 사기는 종종 보험 사기와 연관되어 있습니다. 유타 메디케이드 사기국의 통계학자인 Terry Allen은 연간 청구액 $800 million 중 최대 10%가 도난당할 수 있다고 추정했습니다(Allen, 2000). Major와 Riedinger(1992)는 관찰 내용을 가장 유사해야 하는 관찰 내용(예: 유사한 지리 인구통계학적 특성)과 비교하여 의료 사기를 탐지하는 지식/통계 기반 시스템을 만들었습니다. Brockett, Xia 및 Derrig(1998)는 신경망을 사용하여 의료 보험 청구에서 자동차 신체 상해에 대한 사기성 및 비사기성 청구를 분류했습니다. Glasgow(1997)는 보험 업계의 위험과 사기에 대해 간략하게 논의했습니다. 다양한 유형의 의료 사기에 대한 용어집은 http://www.motherjones. com/mother_jones/MA95/davis2.html에서 확인할 수 있습니다.

물론, 애완동물 이론을 뒷받침하기 위해 데이터가 때때로 조작되거나 위조되거나 신중하게 선택되는 과학 분야는 의학만이 아닙니다. 과학 분야의 사기 문제는 점점 더 많은 관심을 받고 있지만 항상 우리와 함께 있었습니다. 잘못된 과학자들은 제품 개발을 추진하거나 출판물에 대한 마술적 중요성 수준에 도달하기 위해 실험에서 수치를 조작하는 것으로 알려져 있습니다. Dmitriy Yuryev는 http://www.orc.ru/∼yur77/statfr.htm.의 자신의 웹페이지에서 이러한 사례를 설명했습니다. 또한 데이터가 조작된 것으로 의심되는 고전적인 사례가 많이 있습니다(Galileo, Newton, Babbage, Kepler, Mendel, Millikan 및 Burt의 작업 포함). Press와 Tanur(2001)는 많은 사례를 통해 과학적 과정에서 주관성의 역할에 대한 흥미로운 토론을 제시했습니다. 무의식적으로 데이터를 선택하는 것과 전면적인 왜곡 사이의 경계선은 아주 좋습니다.

## 8 결론

우리가 설명한 영역은 아마도 통계 및 기타 데이터 분석 도구가 사기 탐지에 가장 큰 영향을 미친 영역일 것입니다. 이는 일반적으로 정보의 양이 많고 이 정보가 숫자이거나 개수 및 비율의 형태로 숫자로 쉽게 변환될 수 있기 때문입니다. 그러나 위에서 언급되지 않은 다른 영역에서도 사기 탐지를 위해 통계 도구를 사용했습니다. 재무제표의 부정행위는 자금세탁보다 더 넓은 맥락에서 회계 및 관리 사기를 적발하는 데 사용될 수 있습니다. 숫자 분석 도구는 회계학에서 선호됩니다(예: Nigrini 및 Mittermaier, 1997; Nigrini, 1999). 재무 감사에서는 통계적 샘플링 방법이 중요하며, 세부 조사가 필요한 세금 신고서를 결정하기 위해 선별 도구가 적용됩니다. 본 연구에서는 의학의 맥락에서 보험 사기를 언급했지만 분명히 더 광범위하게 발생합니다. Artís, Ayuso 및 Guillén(1999)은 자동차 보험의 사기 행동 모델링에 대한 접근 방식을 설명했으며 Fanning, Cogger 및 Srivastava(1995)와 Green 및 Choi(1997)는 관리 사기를 탐지하기 위한 신경망 분류 방법을 조사했습니다. 사기 탐지를 위한 통계 도구는 스포츠 이벤트에도 적용되었습니다. 예를 들어 Robinson and Tawn(1995), Smith(1997) 및 Barao and Tawn(1999)은 실행 중인 이벤트의 결과를 조사하여 일부 예외 시간이 예상한 것과 일치하지 않는지 확인했습니다.

표절도 사기의 일종이다. 저자 검증을 위한 통계 도구의 사용에 대해 간략하게 언급했으며 이러한 방법이 여기에 적용될 수 있습니다. 그러나 통계 도구는 더 광범위하게 적용될 수도 있습니다. 예를 들어, 인터넷의 발전으로 학생들이 기사를 표절하고 학교나 대학 교과 과정에서 자신의 기사인 것처럼 전달하는 것이 매우 쉽습니다. 웹사이트 http://www.plagiarism.org는 원고를 가져와 웹에 있는 기사의 "실질적인 데이터베이스"와 비교할 수 있는 시스템을 설명합니다. 원고의 독창성에 대한 통계적 척도가 반환됩니다.

서론에서 언급했듯이 사기 탐지는 사기 예방이 실패한 후에 적용되는 사후 전략입니다. 일부 사기 예방 방법에는 통계 도구도 적용됩니다. 예를 들어, 사기 탐지를 위한 소위 생체인식 방법이 점점 더 널리 보급되고 있습니다. 여기에는 컴퓨터 지문 및 망막 식별, 얼굴 인식(미식축구 훌리건을 인식하는 측면에서 가장 널리 알려졌음에도 불구하고)이 포함됩니다.

우리가 논의한 많은 응용 프로그램에서는 처리 속도가 핵심입니다. 특히 거래 처리, 특히 통신 및 침입 데이터의 경우 매일 엄청난 양의 기록이 처리되지만 신용 카드, 은행 및 소매 부문에도 적용됩니다.

이 모든 작업의 ​​핵심 문제는 통계 도구가 사기를 탐지하는 데 얼마나 효과적인지이며 근본적인 문제는 일반적으로 얼마나 많은 사기 사례가 인터넷을 통과하는지 알 수 없다는 것입니다. 은행 사기, 통신 사기 등의 애플리케이션에서

<!-- 원문 12쪽 -->

## 246 RJ 볼턴과 DJ 핸드

탐지 속도가 중요하므로 사기 시작 후 탐지까지의 평균 시간(분 단위, 거래 횟수 등)과 같은 측정값도 보고해야 합니다. 이러한 측면의 측정은 최종 탐지율 측정과 상호 작용합니다. 많은 상황에서 계좌, 전화 등은 사기로 탐지되기 전에 여러 사기 거래에 사용되어야 하므로 여러 가지 위음성 분류가 반드시 이루어져야 합니다.

적절한 전체 전략은 등급 조사 시스템을 사용하는 것입니다. 의심 점수가 매우 높은 계정은 즉각적이고 집중적인(그리고 비용이 많이 드는) 조사가 필요한 반면, 높지만 덜 극적인 점수를 가진 계정은 면밀한(그러나 비용이 많이 들지 않는) 관찰이 필요합니다. 다시 한번, 적절한 타협점을 선택하는 문제입니다.

마지막으로 Schonlau et al.이 도달한 결론을 반복할 가치가 있습니다. (2001)는 컴퓨터 침입 탐지를 위한 통계 도구의 맥락에서 "통계 방법은 어려운 상황에서도 침입을 탐지할 수 있지만" "통계 및 통계학자에게는 많은 과제와 기회가 남아 있습니다."라고 말합니다. 본 연구에서는 이 긍정적인 결론이 더 일반적으로 적용된다고 믿습니다. 사기 탐지는 여러 면에서 통계 및 데이터 분석 도구를 적용하는 데 이상적인 중요한 영역이며, 통계학자가 매우 실질적이고 중요한 기여를 할 수 있는 영역입니다.

## 승인

Richard Bolton의 작업은 영국 공학 및 물리 과학 연구 위원회의 ROPA 상으로 지원되었습니다.

## 참고문헌

ALESKEROV, E., FREISLEBEN, B. and RAO, B. (1997). CARD-

WATCH: A neural network based database mining system for credit card fraud detection. In Computational Intelligence for Financial Engineering. Proceedings of the IEEE/IAFE 220– 226. IEEE, Piscataway, NJ. ALLEN, T. (2000). A day in the life of a Medicaid fraud statistician.

Stats 29 20–22. ANDERSON, D., FRIVOLD, T. and VALDES, A. (1995). Next-

generation intrusion detection expert system (NIDES): A summary. Technical Report SRI-CSL-95-07, Computer Science Laboratory, SRI International, Menlo Park, CA. ANDREWS, P. P. and PETERSON, M. B., eds. (1990). Criminal

Intelligence Analysis. Palmer Enterprises, Loomis, CA. ARTÍS, M., AYUSO, M. and GUILLÉN, M. (1999). Modelling

different types of automobile insurance fraud behaviour in the Spanish market. Insurance Mathematics and Economics 24 67–81.

BARAO, M. I. and TAWN, J. A. (1999). Extremal analysis of short

series with outliers: Sea-levels and athletics records. Appl. Statist. 48 469–487. BLUNT, G. and HAND, D. J. (2000). The UK credit card market.

Technical report, Dept. Mathematics, Imperial College, London. BOLTON, R. J. and HAND, D. J. (2001). Unsupervised profiling

methods for fraud detection. In Conference on Credit Scoring and Credit Control 7, Edinburgh, UK, 5–7 Sept. BRAUSE, R., LANGSDORF, T. and HEPP, M. (1999). Neural data

mining for credit card fraud detection. In Proceedings of the 11th IEEE International Conference on Tools with Artificial Intelligence 103–106. IEEE Computer Society Press, Silver Spring, MD. BREIMAN, L., FRIEDMAN, J. H., OLSHEN, R. A. and STONE, C. J. (1984). Classification and Regression Trees. Wadsworth, Belmont, CA. BROCKETT, P. L., XIA, X. and DERRIG, R. A. (1998). Using

Kohonen's self-organising feature map to uncover automobile bodily injury claims fraud. The Journal of Risk and Insurance 65 245–274. BURGE, P. and SHAWE-TAYLOR, J. (1997). Detecting cellular

fraud using adaptive prototypes. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 9–13. AAAI Press, Menlo Park, CA. BUYSE, M., GEORGE, S. L., EVANS, S., GELLER, N. L.,

RANSTAM, J., SCHERRER, B., LESAFFRE, E., MURRAY, G., EDLER, L., HUTTON, J., COLTON, T., LACHENBRUCH, P. and VERMA, B. L. (1999). The role of biostatistics in the prevention, detection and treatment of fraud in clinical trials. Statistics in Medicine 18 3435–3451. CAHILL, M. H., LAMBERT, D., PINHEIRO, J. C. and SUN, D. X.

(2002). Detecting fraud in the real world. In Handbook of Massive Datasets (J. Abello, P. M. Pardalos and M. G. C. Resende, eds.). Kluwer, Dordrecht. CHAN, P. K., FAN, W., PRODROMIDIS, A. L. and STOLFO, S. J.

(1999). Distributed data mining in credit card fraud detection. IEEE Intelligent Systems 14(6) 67–74. CHAN, P. and STOLFO, S. (1998). Toward scalable learning

with non-uniform class and cost distributions: A case study in credit card fraud detection. In Proceedings of the Fourth International Conference on Knowledge Discovery and Data Mining 164–168. AAAI Press, Menlo Park, CA. CHARTIER, B. and SPILLANE, T. (2000). Money laundering

detection with a neural network. In Business Applications of Neural Networks (P. J. G. Lisboa, A. Vellido and B. Edisbury, eds.) 159–172. World Scientific, Singapore. CHHIKARA, R. S. and MCKEON, J. (1984). Linear discriminant

analysis with misallocation in training samples. J. Amer. Statist. Assoc. 79 899–906. CLARK, P. and NIBLETT, T. (1989). The CN2 induction algorithm.

Machine Learning 3 261–285. COHEN, W. (1995). Fast effective rule induction. In Proceedings of

the 12th International Conference on Machine Learning 115– 123. Morgan Kaufmann, Palo Alto, CA. CORTES, C., FISHER, K., PREGIBON, D. and ROGERS, A.

(2000). Hancock: A language for extracting signatures from data streams. In Proceedings of the Sixth ACM SIGKDD International Conference on Knowledge Discovery and Data Mining 9–17. ACM Press, New York.

<!-- 원문 13쪽 -->

STATISTICAL FRAUD DETECTION 247

CORTES, C. and PREGIBON, D. (1998). Giga-mining. In Proceed-

ings of the Fourth International Conference on Knowledge Discovery and Data Mining 174–178. AAAI Press, Menlo Park, CA.

CORTES, C, PREGIBON, D. and VOLINSKY, C. (2001). Commu-

nities of interest. Lecture Notes in Comput. Sci. 2189 105–114.

COX, K. C., EICK, S. G. and WILLS, G. J. (1997). Visual data

mining: Recognizing telephone calling fraud. Data Mining and Knowledge Discovery 1 225–231.

CSIDS (1999). Cisco secure intrusion detection system tech-

nical overview. Available at http://www.wheelgroup.com/ warp/public/cc/cisco/mkt/security/nranger/tech/ntran_tc.htm.

DENNING, D. E. (1997). Cyberspace attacks and countermeasures.

In Internet Besieged (D. E. Denning and P. J. Denning, eds.) 29–55. ACM Press, New York.

DORRONSORO, J. R., GINEL, F., SANCHEZ, C. and CRUZ, C. S.

(1997). Neural fraud detection in credit card operations. IEEE Transactions on Neural Networks 8 827–834.

FANNING, K., COGGER, K. O. and SRIVASTAVA, R. (1995).

Detection of management fraud: A neural network approach. International Journal of Intelligent Systems in Accounting, Finance and Management 4 113–126.

FAWCETT, T. and PROVOST, F. (1997a). Adaptive fraud detection.

Data Mining and Knowledge Discovery 1 291–316.

FAWCETT, T. and PROVOST, F. (1997b). Combining data mining

and machine learning for effective fraud detection. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 14–19. AAAI Press, Menlo Park, CA.

FAWCETT, T. and PROVOST, F. (1999). Activity monitoring:

Noticing interesting changes in behavior. In Proceedings of the Fifth ACM SIGKDD International Conference on Knowledge Discovery and Data Mining 53–62. ACM Press, New York.

FORREST, S., HOFMEYR, S., SOMAYAJI, A. and LONGSTAFF, T.

(1996). A sense of self for UNIX processes. In Proceedings of the 1996 IEEE Symposium on Security and Privacy 120–128. IEEE Computer Society Press, Silver Spring, MD.

GHOSH, S. and REILLY, D. L. (1994). Credit card fraud detection

with a neural network. In Proceedings of the 27th Hawaii International Conference on System Sciences (J. F. Nunamaker and R. H. Sprague, eds.) 3 621–630. IEEE Computer Society Press, Los Alamitos, CA.

GLASGOW, B. (1997). Risk and fraud in the insurance industry.

In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 20–21. AAAI Press, Menlo Park, CA.

GOLDBERG, H. and SENATOR, T. E. (1995). Restructuring data-

bases for knowledge discovery by consolidation and link formation. In Proceedings of the First International Conference on Knowledge Discovery and Data Mining 136–141. AAAI Press, Menlo Park, CA.

GOLDBERG, H. and SENATOR, T. E. (1997). Break detection

systems. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 22–28. AAAI Press, Menlo Park, CA.

GOLDBERG, H. and SENATOR, T. E. (1998). The FinCEN AI

system: Finding financial crimes in a large database of cash transactions. In Agent Technology: Foundations, Applications, and Markets (N. Jennings and M. Wooldridge, eds.) 283–302. Springer, Berlin. GREEN, B. P. and CHOI, J. H. (1997). Assessing the risk

of management fraud through neural network technology. Auditing 16 14–28. HAND, D. J. (1981). Discrimination and Classification. Wiley,

Chichester. HAND, D. J. (1997). Construction and Assessment of Classifica-

tion Rules. Wiley, Chichester. HAND, D. J. and BLUNT, G. (2001). Prospecting for gems in credit

card data. IMA Journal of Management Mathematics 12 173– 200. HAND, D. J., BLUNT, G., KELLY, M. G. and ADAMS, N. M.

(2000). Data mining for fun and profit (with discussion). Statist. Sci. 15 111–131. HAND, D. J. and HENLEY, W. E. (1997). Statistical classification

methods in consumer credit scoring: A review. J. Roy. Statist. Soc. Ser. A 160 523–541. HASSIBI, K. (2000). Detecting payment card fraud with neural

networks. In Business Applications of Neural Networks (P. J. G. Lisboa, A. Vellido and B. Edisbury, eds.). World Scientific, Singapore. HE, H., GRACO, W. and YAO, X. (1999). Application of genetic

algorithm and k-nearest neighbour method in medical fraud detection. Lecture Notes in Comput. Sci. 1585 74–81. Springer, Berlin. HE, H. X., WANG, J. C., GRACO, W. and HAWKINS, S. (1997).

Application of neural networks to detection of medical fraud. Expert Systems with Applications 13 329–336. HILL, T. P. (1995). A statistical derivation of the significant-digit

law. Statist. Sci. 10 354–363. HYNNINEN, J. (2000). Experiences in mobile phone fraud. Semi-

nar on Network Security. Report Tik-110.501, Helsinki Univ. Technology. JENKINS, P. (2000). Getting smart with fraudsters. Financial

Times, September 23. JENSEN, D. (1997). Prospective assessment of AI technologies

for fraud detection: a case study. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 34–38. AAAI Press, Menlo Park, CA. JU, W.-H. and VARDI, Y. (2001). A hybrid high-order Markov

chain model for computer intrusion detection. J. Comput. Graph. Statist. 10 277–295. KIRKLAND, J. D., SENATOR, T. E., HAYDEN, J. J., DYBALA, T.,

GOLDBERG, H. G. and SHYR, P. (1998). The NASD regulation advanced detection system (ADS). In Proceedings of the 15th National Conference on Artificial Intelligence (AAAI-98) and of the 10th Conference on Innovative Applications of Artificial Intelligence (IAAI-98) 1055–1062. AAAI Press, Menlo Park, CA. KOSORESOW, A. P. and HOFMEYR, S. A. (1997). Intrusion

detection via system call traces. IEEE Software 14 35–42. KUMAR, S. and SPAFFORD, E. (1994). A pattern matching model

for misuse intrusion detection. In Proceedings of the 17th National Computer Security Conference 11–21. LACHENBRUCH, P. A. (1966). Discriminant analysis when the

initial samples are misclassified. Technometrics 8 657–662.

<!-- 원문 14쪽 -->

248 R. J. BOLTON AND D. J. HAND

LACHENBRUCH, P. A. (1974). Discriminant analysis when the ini-

tial samples are misclassified. II: Non-random misclassification models. Technometrics 16 419–424. LANE, T. and BRODLEY, C. E. (1998). Temporal sequence learn-

ing and data reduction for anomaly detection. In Proceedings of the 5th ACM Conference on Computer and Communications Security (CCS-98) 150–158. ACM Press, New York. LEE, W. and STOLFO, S. (1998). Data mining approaches for

intrusion detection. In Proceedings of the 7th USENIX Security Symposium, San Antonio, TX 79–93. USENIX Association, Berkeley, CA. LEONARD, K. J. (1993). Detecting credit card fraud using expert

systems. Computers and Industrial Engineering 25 103–106. LIPPMANN, R., FRIED, D., GRAF, I., HAINES, J., KENDALL, K., MCCLUNG, D., WEBER, D., WEBSTER, S., WYSCHOGROD, D., CUNNINGHAM, R. and ZISSMAN, M. (2000). Evaluating intrusion detection systems: The 1998 DARPA off-line intrusion-detection evaluation. Unpublished manuscript, MIT Lincoln Laboratory. MAJOR, J. A. and RIEDINGER, D. R. (1992). EFD: A hybrid

knowledge/statistical-based system for the detection of fraud. International Journal of Intelligent Systems 7 687–703. MARCHETTE, D. J. (2001). Computer Intrusion Detection and

Network Monitoring: A Statistical Viewpoint. Springer, New York. MCCARTHY, J. (2000). Phenomenal data mining. Comm. ACM 43

75–79. MCLACHLAN, G. J. (1992). Discriminant Analysis and Statistical

Pattern Recognition. Wiley, New York. MOBILE EUROPE (2000). New IP world, new dangers. Mobile

Europe, March. MOREAU, Y., PRENEEL, B., BURGE, P., SHAWE-TAYLOR, J.,

STOERMANN, C. and COOKE, C. (1996). Novel techniques for fraud detection in mobile communications. In ACTS Mobile Summit, Grenada. MOREAU, Y., VERRELST, H. and VANDEWALLE, J. (1997). De-

tection of mobile phone fraud using supervised neural networks: A first prototype. In Proceedings of 7th International Conference on Artificial Neural Networks (ICANN'97) 1065– 1070. Springer, Berlin. MURAD, U. and PINKAS, G. (1999). Unsupervised profiling for

identifying superimposed fraud. Principles of Data Mining and Knowledge Discovery. Lecture Notes in Artificial Intelligence 1704 251–261. Springer, Berlin. NEURAL TECHNOLOGIES (2000). Reducing telecoms fraud and

churn. Report, Neural Technologies, Ltd., Petersfield, U.K. NIGRINI, M. J. (1999). I've got your number. Journal of Accoun-

tancy May 79–83. NIGRINI, M. J. and MITTERMAIER, L. J. (1997). The use of

Benford's law as an aid in analytical procedures. Auditing: A Journal of Practice and Theory 16 52–67. NORTEL (2000). Nortel networks fraud solutions. Fraud Primer,

Issue 2.0. Nortel Networks Corporation. PAK, S. J. and ZDANOWICZ, J. S. (1994). A statistical analysis of

the U.S. Merchandise Trade Database and its uses in transfer pricing compliance and enforcement. Tax Management, May 11.

PATIENT, S. (2000). Reducing online credit card fraud. Web Developer's Journal. Available at http://www. webdevelopersjournal.com/articles/card_fraud.html PRESS, S. J. and TANUR, J. M. (2001). The Subjectivity of

Scientists and the Bayesian Approach. Wiley, New York. PROVOST, F. and FAWCETT, T. (2001). Robust classification for

imprecise environments. Machine Learning 42 203–210. QU, D., VETTER, B. M., WANG, F., NARAYAN, R., WU, S. F.,

HOU, Y. F., GONG, F. and SARGOR, C. (1998). Statistical anomaly detection for link-state routing protocols. In Proceedings of the Sixth International Conference on Network Protocols 62–70. IEEE Computer Society Press, Los Alamitos, CA. QUINLAN, J. R. (1990). Learning logical definitions from rela-

tions. Machine Learning 5 239–266. QUINLAN, J. R. (1993). C4.5: Programs for Machine Learning.

Morgan Kaufmann, San Mateo, CA. RIPLEY, B. D. (1996). Pattern Recognition and Neural Networks.

Cambridge Univ. Press. ROBINSON, M. E. and TAWN, J. A. (1995). Statistics for excep-

tional athletics records. Appl. Statist. 44 499–511. ROSSET, S., MURAD, U., NEUMANN, E., IDAN, Y. and

PINKAS, G. (1999). Discovery of fraud rules for telecommunications—challenges and solutions. In Proceedings of the Fifth ACM SIGKDD International Conference on Knowledge Discovery and Data Mining 409–413. ACM Press, New York. RYAN, J., LIN, M. and MIIKKULAINEN, R. (1997). Intrusion

detection with neural networks. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 72–79. AAAI Press, Menlo Park, CA. SCHONLAU, M., DUMOUCHEL, W., JU, W.-H., KARR, A. F.,

THEUS, M. and VARDI, Y. (2001). Computer intrusion: Detecting masquerades. Statist. Sci. 16 58–74. SENATOR, T. E. (2000). Ongoing management and application

of discovered knowledge in a large regulatory organization: A case study of the use and impact of NASD regulation's advanced detection system (ADS). In Proceedings of the Sixth ACM SIGKDD International Conference on Knowledge Discovery and Data Mining 44–53. ACM Press, New York. SENATOR, T. E., GOLDBERG, H. G., WOOTON, J., COT-

TINI, M. A., UMAR KHAN, A. F., KLINGER, C. D., LLA-

MAS, W. M., MARRONE, M. P. and WONG, R. W. H. (1995). The financial crimes enforcement network AI system (FAIS)— Identifying potential money laundering from reports of large cash transactions. AI Magazine 16 21–39. SHAWE-TAYLOR, J., HOWKER, K., GOSSET, P., HYLAND,

M., VERRELST, H., MOREAU, Y., STOERMANN, C. and BURGE, P. (2000). Novel techniques for profiling and fraud detection in mobile telecommunications. In Business Applications of Neural Networks (P. J. G. Lisboa, A. Vellido and B.Edisbury, eds.) 113–139. World Scientific, Singapore. SHIEH, S.-P. W. and GLIGOR, V. D. (1991). A pattern-oriented

intrusion-detection model and its applications. In Proceedings of the 1991 IEEE Computer Society Symposium on Research in Security and Privacy 327–342. IEEE Computer Society Press, Silver Spring, MD. SHIEH, S.-P. W. and GLIGOR, V. D. (1997). On a pattern-

oriented model for intrusion detection. IEEE Transactions on Knowledge and Data Engineering 9 661–667.

<!-- 원문 15쪽 -->

STATISTICAL FRAUD DETECTION 249

SMITH, R. L. (1997). Comment on "Statistics for exceptional

athletics records," by M. E. Robinson and J. A. Tawn. Appl. Statist. 46 123–128. STOLFO, S. J., FAN, D. W., LEE, W., PRODROMIDIS, A. L. and

CHAN, P. K. (1997a). Credit card fraud detection using metalearning: Issues and initial results. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 83–90. AAAI Press, Menlo Park, CA. STOLFO, S., FAN, W., LEE, W., PRODROMIDIS, A. L. and

CHAN, P. (1999). Cost-based modeling for fraud and intrusion detection: Results from the JAM Project. In Proceedings of the DARPA Information Survivability Conference and Exposition 2 130–144. IEEE Computer Press, New York. STOLFO, S. J., PRODROMIDIS, A. L., TSELEPIS, S., LEE, W.,

FAN, D. W. and CHAN, P. K. (1997b). JAM: Java agents for meta-learning over distributed databases. In AAAI Workshop on AI Approaches to Fraud Detection and Risk Management 91–98. AAAI Press, Menlo Park, CA.

TANIGUCHI, M., HAFT, M., HOLLMÉN, J. and TRESP, V.

(1998). Fraud detection in communication networks using neural and probabilistic methods. In Proceedings of the 1998 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP'98) 2 1241–1244. IEEE Computer Society Press, Silver Spring, MD. U.S. CONGRESS (1995). Information technologies for the control

of money laundering. Office of Technology Assessment, Report OTA-ITC-630, U.S. Government Printing Office, Washington, DC. WASSERMAN, S. and FAUST, K. (1994). Social Network Analysis:

Methods and Applications. Cambridge Univ. Press. WEBB, A. R. (1999). Statistical Pattern Recognition. Arnold,

London. WHEELER, R. and AITKEN, S. (2000). Multiple algorithms

for fraud detection. Knowledge-Based Systems 13(2/3) 93–99.

Comment

Foster Provost

The state of research on fraud detection recalls John Godfrey Saxe's 19th-century poem "The Blind Men and the Elephant" (Felleman, 1936, page 521). Based on a Hindu fable, each blind man experiences only a part of the elephant, which shapes his opinion of the nature of the elephant: the leg makes it seem like a tree, the tail a rope, the trunk a snake and so on. In fact, ". . . though each was partly in the right . . . all were in the wrong." Saxe's poem was a criticism of theological debates, and I do not intend such a harsh criticism of research on fraud detection. However, because the problem is so complex, each research project takes a particular angle of attack, which often obscures the view of other parts of the problem. So, some researchers see the problem as one of classification, others of temporal pattern discovery; to some it is a problem perfect for a hidden Markov model and so on.

So why is fraud detection not simply classification or a member of some other already well-understood problem class? Bolton and Hand outline several characteristics of fraud detection problems that differentiate them [as did Tom Fawcett and I in our review of the problems and techniques of fraud detection (Faw-

Foster Provost is Associate Professor, Leonard N. Stern School of Business, New York University, New York, New York 10012 (e-mail: provost@acm.org).

cett and Provost, 2002)]. Consider fraud detection as a classification problem. Fraud detection certainly must be "cost-sensitive"—rather than minimizing error rate, some other loss function must be minimized. In addition, usually the marginal class distribution is skewed strongly toward one class (legitimate behavior). Therefore, modeling for fraud detection at least is a difficult problem of estimating class membership probability, rather than simple classification. However, this still is an unsatisfying attempt to transform the true problem into one for which we have existing tools (practical and conceptual). The objective function for fraud detection systems actually is much more complicated. For example, the value of detection is a function of time. Immediate detection is much more valuable than delayed detection. Unfortunately, evidence builds up over time, so detection is easier the longer it is delayed. In cases of self-revealing fraud, eventually, detection is trivial (e.g., a defrauded customer calls to complain about fraudulent transactions on his or her bill).

In most research on modeling for fraud detection, a subproblem is extracted (e.g., classifying transactions or accounts as being fraudulent) and techniques are compared for solving this subproblem—without moving on to compare the techniques for the greater problem of detecting fraud. Each particular subproblem naturally will abstract away those parts that are

<!-- 원문 16쪽 -->

250 R. J. BOLTON AND D. J. HAND

problematic for the technique at hand (e.g., temporal aspects are ignored for research on applying standard classification approaches). However, fraud detection can benefit from classification, regression, time-series analysis, temporal pattern discovery, techniques for combining evidence and others. For example, temporal sequences of particular actions can provide strong clues to the existence of fraud. A common example of such a temporal sequence is a triggering event followed in a day or two by an acceleration of usage. In credit card fraud, bandits purchase small amounts of gasoline (at a safe, automatic pump) to verify that a card is active before selling it. In wireless telephone fraud, bandits call a movie theater information number for verification. In a standard classification framework, temporal patterns must be engineered carefully into the representation. On the other hand, in a framework designed to focus on the discovery of temporal sequences, many facets of advanced classification may be ignored; for example, classifier learners can take advantage (automatically) of mixed-type variables, including numeric, categorical, set-valued and text, and hierarchical background knowledge (Aronis and Provost, 1997) such as geographic hierarchies.

This is just one example of a pair of different views of the problem, each with its advantages and disadvantages. Another is, as Bolton and Hand point out, the supervised/unsupervised duality to modeling for fraud detection: some fraudulent activity can be detected by applying knowledge generalized from past, labeled cases; other activity is better detected by noticing behavior that differs significantly from the norm.

Fraud detection and intervention can have two modes: automatic and mixed initiative (human/computer). Automatic intervention only occurs when there is very strong evidence that fraud exists; otherwise, false alarms would be disastrous. Remember that fraud detection systems consider millions (sometimes tens or hundreds of millions) of accounts. On a customer base of only 1 million accounts, a daily false-alarm rate of even 1% would yield 10,000 false alarms a day; the cost of dealing with these (e.g., if accounts were incorrectly shut down) could be enormous.

Mixed-initiative detection and intervention deals with cases that do not have enough evidence for automatic intervention (or with applications for which automatic intervention does not make sense). Fraud

detection systems create "cases" comprising the evidence collected so far that indicates fraud. Fraud analysts process these cases, often going to auxiliary sources of data to augment their analyses. At any time, a case list can be sorted by some score: a probability of fraud, computed from all the evidence collected so far, an expected loss or simply an ad hoc score. The unit of analysis for the production of the score is complicated: it is composed of a series of transactions, which comprises the potentially fraudulent activity and possibly legitimate activity as well. The unit of analysis also could include other information, such as that taken from account applications, background databases, behavior profiles (which may have been compiled from previous transaction activity) and possibly account annotations made by prior analysts (e.g., "this customer often triggers rule X").

A part of the fraud detection elephant that has not received much attention is the peculiar nonstationary nature of the problem. Not only does the phenomenon being modeled change over time—sometimes dramatically—it changes in direct response to the modeling of it. As soon as a model is put into place, it begins to lose effectiveness. For example, after realizing that the appearance of a large volume of transactions on a brand new account is used as an indicator of application/subscription fraud, criminals begin to lie low and even pay initial bills before ramping up spending. After realizing that "calling dens" in certain locations had led to models that detect wireless fraud based on those locations, criminals constructed roving calling dens (where fraudulent wireless service was provided in the back of a van that drove around the city). This adaptation is problematic for the typical information systems development life cycle (analysis →design →programming →deployment →maintenance). At the very least it is necessary for models to be able to be changed quickly and frequently. A more satisfying (but perhaps not yet practicable) solution would be to have a learning system, which can modify its own models in the ongoing arms race.

A practical view of the fraud detection elephant shows other issues that make fraud detection problems difficult. They must be kept in mind if one intends results actually to apply to real fraud detection. Systems for fraud detection, in many applications, face tremendous computational demands. Transactions arrive in real time; often only milliseconds (or less) can

<!-- 원문 17쪽 -->

STATISTICAL FRAUD DETECTION 251

be allocated to process each. In this short time, the system must record the transaction in its database, access relevant account-specific data, process the transaction and historical data through the fraud detection model and create a case, update a case or issue an alarm if warranted (and if not, possibly update a customer's profile). Fraud models must be very efficient to apply. Furthermore, the models must be very space efficient. Storing a neural network or a decision tree for each customer is not feasible for millions of customers; it may be possible only to store for each customer a few parameters to a general model. Thus, both time and space constraints argue for simple fraud detection models.

A user perspective of fraud detection (as a mixedinitiative process) argues for the use of models that are comprehensible to the analysts. For example, for many analysts, rule-based models are easier to interpret than are neural network models. The set of rules that apply to a particular case may guide the subsequent (human) investigation. On the other hand, the most commercially successful vendor of fraud detection systems (to my knowledge) uses neural networks extensively for detecting fraud. Of course, commercial success is a dubious measure of technical quality; however, one can get an interesting view into real world fraud detection systems by studying HNC Software's patent (Gopinathan et al., 1998). (As of this writing, a patent search on keywords "fraud detection" yields 80 patents.) In particular, their extensive list of variables, created to summarize past activity so that a neural network can be applied, illustrates the problem engineering necessary to transform the fraud detection problem into one that is amenable to standard modeling techniques.

It would be useful to have a precise definition of a class (or of several classes) of fraud detection problems, which takes into account the variety of characteristics that make statistical fraud detection difficult. If such a characterization exists already in statistics, the machine learning and data mining communities would benefit from its introduction. Not knowing of one, Tom Fawcett and I attempted to define one class of "activity monitoring" problems and illustrate several instances (Fawcett and Provost, 1999). Earlier we defined "superimposition fraud" (Fawcett and Provost, 1997a) to try to unify similar forms of wireless telephone fraud, calling card fraud, credit card fraud, certain computer intrusions and so on, where fraudulent usage is superimposed upon legitimate usage and for which similar solution methods may apply. However,

neither of these captures all of the important characteristics.

The characterization of such a class of problems is important for several reasons. First of all, different fraud detection problems are considerably similar—it is important to understand how well success of different techniques generalizes. Is the similarity superficial? Are there deeper characteristics of the problem or data that must be considered? [This seems to be the case, e.g., with classification problems (Perlich, Provost and Simonoff, 2001).] Also, to succeed at detecting fraud, different sorts of modeling techniques must be composed, for example, temporal patterns may become features for a system for estimating class membership probabilities, and estimators of class membership probability could be used in temporal evidence gathering. Furthermore, systems using different solution methods should be on equal footing for comparison. Seeming success on any subproblem does not necessarily imply success on the greater problem. Finally, it would be beneficial to focus researchers from many disciplines, with many complementary techniques, on a common, very important set of problems. The juxtaposition of knowledge and ideas from multiple disciplines will benefit them all and will be facilitated by the precise formulation of a problem of common interest.

Of course I am not arguing that research must address all of these criteria simultaneously (immediately), and I am not being strongly critical of prior work on fraud detection: we all must abstract away parts of such a complicated problem to make progress on others. Nevertheless, it is important that researchers take as an ultimate goal the solution to the full problem. We all should consider carefully whether partial solutions will or will not be extensible. Fraud detection is a real, important problem with many real, interesting subproblems. Bolton and Hand's review of the state of the art shows that there is a lot of room for useful research. However, the research community should make sure that work is progressing toward the solution to the larger problem, whether by the development of techniques that solve larger portions or by facilitating the composition of techniques in a principled manner.

ACKNOWLEDGMENT

Tom Fawcett and I worked very closely on problems of fraud detection, and my views have been influenced considerably by our discussions and collaborative work.

<!-- 원문 18쪽 -->

252 R. J. BOLTON AND D. J. HAND Comment

Leo Breiman

This is an enjoyable and illuminating article. It deals with an area that few statisticians are aware of, but that is of critical importance economically and in terms of security. I am appreciative to the authors for the education in fraud detection this article gave me and to Statistical Science for publishing it. There are some interesting aspects that make this class of problems unique and that I comment on, running the risk of repeating points made in the article.

The analysis has to deal with a large number of problems simultaneously. For instance, in credit card fraud, the records of millions of customers have to be analyzed one by one to set up individual alarm settings. It is not a single unsupervised or supervised problem— a multitude of such problems have to be simultaneously addressed and "solved" for diverse data records. Yet the algorithm selected, modulo a few tunable parameters, has to be "one size fits all." Otherwise the on-line computations are not feasible. The alarm bell settings have to be constantly updated. For instance, as customers age and change their economic level and life styles, usage characteristics change. There are also serious database issues—how to structure the large databases so that the incoming streams of data are accessible for the kind of analysis necessary. Collaboration with database experts is essential.

Most of all, these problems require an uninhibited sense of exploration and can be enjoyable adventures in living with data. The goal is predictive accuracy and the tools are algorithmic models (see Breiman, 2001). The class of problems is novel, even in machine learning. No one tool (neural nets, etc.) is instantly applicable to all of these problems. The algorithms have to be designed to fit the data. This means that an essential part of the venture is immersion in and exploration of the data. My experience is that good predictive algorithms do not appear by a selection, unguided by the data, from what algorithms are available. Furthermore, the process is one of successive informed revision. If an algorithm, for instance, has too high a false alarm rate, then one has to

Leo Breiman is Professor, Department of Statistics, University of California, Berkeley, California 94720- 3860 (e-mail: leo@stat.berkeley.edu)

go back to the data and try to understand why the false alarm rate is high. Understanding will help to lower the false alarm rate.

The process is an alternation between algorithm and data. Personally, if a user reports that an algorithm I have devised gives anomalous results on his data set, the first thing I do is to request that he ship me the data. By running the data myself and trying to understand what it is about the data that causes the poor performance, I can learn a lot about the deficiencies of the algorithm and, possibly, improve it. Granted that with a changing database running to gigabytes and terrabytes, it may be difficult to look at and understand the data. However, this should not deter analysts—in fact, looking for good ways to display and understand the data is an essential foundation for the construction of good algorithms.

There are other difficult boundary conditions in the instances of fraud detection I have looked at. If one tries to design algorithms that use multidimensional information, the problem is that the algorithm may become too wrapped in the individual data and the false alarm rate rises. However, simple and robust algorithms may not utilize enough information to give a satisfactory detection rate.

The choice between supervised and unsupervised learning may be difficult and interesting. Assume that in the database, examples are available of verified fraud and uncontaminated data. As the authors mention, the cases of verified fraud in the data are a tiny fraction of all of the data.

In detecting credit card fraud, for instance, there are two ways to go. The first is to consider one user (G.B.S.) and let his weekly purchases be instances of class 1. Take all records of a week of fraudulent use and assign them to class 2. Then run a classification algorithm on the two class data constructing a method that discriminates between the two classes. Weight the probabilities of class 1 and class 2 assignment so as to keep the false alarm rate down to a preassigned level. Then run the discrimination method on all future weeks of G.B.S.'s purchases.

This, in machine learning, is called supervised learning. It relies on having two labeled classes of instances to discriminate between. Unsupervised learning occurs where there are no class labels or responses attached

<!-- 원문 19쪽 -->

STATISTICAL FRAUD DETECTION 253

to the data vectors. Applied to fraud detection, it takes all weekly purchases by G.B.S. in the recent past and summarizes them in a few descriptive statistics. For instance, one could be total average weekly purchases and their standard deviation. If, in the current week, the total purchases exceed the average by many standard deviations, then an alarm bell goes off—that is, a high suspicion score is recorded.

My impression is that, where applicable, supervised learning will give lower false alarm rates. Think of the uncontaminated weekly data for G.B.S. as forming a fuzzy ball in high dimensions. Unsupervised learning puts a boundary around this ball and assigns a high suspicion score to anything outside of the boundary. Supervised learning creates a second fuzzy ball consisting of fraudulent weekly data and assigns a high suspicion score only if the probability of being in class 2 (fraud) is sufficiently higher than being in class 1. Data that are outside of the unsupervised boundary may not be in the direction of class 2. However, the supervised approach makes the assumption that future fraudulent data will have the same characteristics as past fraudulent data and further assumes that fraudulent use of the G.B.S. account will result in characteristics similar to those in the fraudulent use of other accounts.

Fraud detection has some echoes in other areas. For instance, in the 1970s, Los Angeles had metal detectors buried every 1

4 mile in every lane in a 17 mile triangular section of heavily traveled freeways. Each detector produced a signal as a car passed over it, resulting in estimates of traffic density and average speed. One goal was to use the data from these detectors, channeled into a central computer, to give early warning of accidents that were blocking the traffic flow. However, at the most critical times, when these freeways were operating at near capacity traffic, stoppages in traffic flow could develop spontaneously. Some sections of freeway were more likely to develop stoppages, for example, a slight upgrade or a curve. A false alarm could generate a dispatch of a tow truck, patrol car or helicopter. My mission, as a consultant, was to develop an algorithm, specific to each section of freeway, to detect accident blockages with high accuracy and low false alarm rate.

In astronomy, an important problem is to develop algorithms that can be applied to the finely detailed pictures of millions of stellar objects and locate those that "are unlike anything we're familiar with to date." Here "unlike" does not mean bigger or smaller, but having different physical characteristics than anything

seen to date. I have thought about this problem from time to time, but see no satisfactory solution.

In a number of fields a common problem, in both supervised and unsupervised learning, is that the number of data vectors is large, but the number of class 2 cases (i.e., fraudulent data vectors) is an extremely small fraction of the total. Using human judgment to go over a large database and recognize all class 2 data is not feasible. For example, in astronomy, an interesting class of objects are butterfly stars—stars that have a visual picture that resembles a butterfly. A project at the Lawrence Livermore National Laboratory hoped to identify all butterfly stars in a gigabyte database resulting from a sky survey. Working on a small fraction of the data, a team of astronomers identified about 300 butterfly stars. The goal of the machine learning group working on this project was to identify almost all of the butterfly stars in the survey while requiring minimal further identification work by the astronomers. This required the construction of an optimal incremental strategy. Use the first 300 identifications to find further objects with high probability of being butterflies, ask the astronomers to say "yes" or "no" on these and then repeat using the larger sample.

The challenges in fraud detection are both formidable and intriguing. Many of the problems are nowhere near solution in terms of satisfactory false alarm and detection rates. It is an open field for the exercise of ingenuity, algorithm creation and data snooping. It is also a field worth billions.

The authors titled their paper "Statistical Fraud Detection," implying that this area is within the realm of statistics—would that it were—but the number of statisticians involved is small. The authors write that they are covering a few areas "in which statistical methods can be applied." The list of statistical methods that I extracted from the article are

Neural nets Rule-based methods Tree-based algorithms Genetic algorithms Fuzzy logic Mixture models Bayesian networks Meta-learning

These were developed in machine learning, not statistics (with the exception of mixture models), and lead to algorithmic modeling. Because of the emphasis on stochastic data modeling in statistics, very few

<!-- 원문 20쪽 -->

254 R. J. BOLTON AND D. J. HAND

statisticians are familiar with algorithm modeling, which is sometimes referred to (with a touch of prudishness) as "ad hoc."

We are ceding some of the most interesting of current statistical problems to computer scientists and engineers allied to the machine learning area. Detection of fraud is an example. Young statisticians need to

learn about algorithmic modeling and how it applies to a large variety of statistical problems. The Berkeley Statistics Department made a move in this direction a few years ago by making a joint appointment with the Computer Science Department of an excellent scientist in the machine learning area. We will be doing more.

Rejoinder

Richard J. Bolton and David J. Hand

We would like to thank the discussants for their valuable contributions. They have reinforced some of our points and also drawn attention to points which we glossed over or failed to make. Their contributions have significantly enhanced the value of the paper.

We emphasized that many and varied tools would be required to attack the fraud detection problem and this has been echoed by the discussants, who make the additional important point that, whatever subproblems are identified, the tools that are adapted or developed to attack them should do so in combination and to the benefit of the fraud detection process as a whole. The message is that fraud detection is greater than the sum of its parts and that it can be easy to lose sight of this when dissecting the problem. In a similar vein, Provost also rightly draws attention to the fact that there are additional subtleties in applying even standard tools to fraud detection that may not at first be apparent. For example, his observation that the value of detection is greater the sooner it is made, but that detection becomes easier the more time that has passed. In fact, Hand (1996, 1997) suggested that many, if not most, classification problems have such concealed subtleties, and that researchers in statistics and machine learning have typically extracted only the basic form of the problem. So, as tools for classification bump against the ceiling of the greatest classification accuracy that can be achieved in practice, so it becomes more and more important to take note of these other aspects of the problems.

Both discussants comment on the importance of the temporal aspect of fraud. We agree that the incorporation of temporal information into the (commonly) static classification structure is essential in most cases of fraud detection and that further research on tools for tackling this would be of great benefit. Populations evolve as people enter and exit them, but the behav-

ior of individuals who remain in a population can also change. Breiman describes some interesting examples from outside the fraud detection domain which illustrate that there are other applications where statistical research may offer solutions similar to those required for fraud detection. One such domain, which is affected by changing populations, is credit scoring (Kelly, Hand and Adams, 1999). Still on a temporal theme, the adaptability of fraud detection tools to the changing behavior of fraudsters must be addressed so as to ensure the continued effectiveness of a fraud detection system: as new detection strategies are introduced, so fraudsters will change their behavior accordingly. Models of behavior can help with this, although the indicators of fraud that are independent of a particular account may require a different strategy.

We take Breiman's point that many of the methods we described were developed outside the narrow statistical community. However, we had not intended the word "statistical" to refer merely to the stochastic data model-based statistics of his recent article (Breiman, 2001). Rather, we had intended it in the sense of Chambers' "greater statistics" (Chambers, 1993), "everything related to learning from data." Of course, the point that Breiman makes, that the tools we have described have not been developed by conventional statisticians, is something of an indictment of statisticians (Hand, 1998).

We endorse Provost's conclusion about the importance of looking at the full problem. It is all too easy to abstract a component problem and then overrefine the solution to this, way beyond a level which can be useful or relevant in the context of the overall problem. Conversely, it is all too easy to be misled to a focus on a peripheral or irrelevant aspect of the subproblem. Academic researchers have often been criticized for this in other contexts. Of course, the fact is that many of the

<!-- 원문 21쪽 -->

STATISTICAL FRAUD DETECTION 255

subproblems require specialist expertise and specialists in a narrow area may find it difficult to see the broader picture. Moreover, naturally, such specialists will want to apply their specialist tool: to those who have a hammer, everything looks like a nail.

The discussion contributions have emphasized the fact that fraud detection is an important and challenging area for statisticians; indeed, for data analysts in general. Challenging aspects include the large data sets, the fact that one class is typically very small, that the data are dynamic and that speedy decisions may be very important, that the nature of the frauds changes over time, often in response to the very detection strategies that may be put in place, that there may be no training instances and that detecting fraud involves multiple interconnected approaches. All of these and other aspects mean that collaboration with data experts, who can provide human insight into the underlying processes, is essential.

ADDITIONAL REFERENCES

ARONIS, J. and PROVOST, F. (1997). Increasing the efficiency

of data mining algorithms with breadth-first marker propagation. In Proceedings of the Third International Conference on Knowledge Discovery and Data Mining 119–122. AAAI Press, Menlo Park, CA.

BREIMAN, L. (2001). Statistical modeling: The two cultures (with

discussion). Statist. Sci. 16 199–231. CHAMBERS, J. M. (1993). Greater or lesser statistics: A choice for

future research. Statist. Comput. 3 182–184. FAWCETT, T. and PROVOST, F. (2002). Fraud detection. In Hand-

book of Knowledge Discovery and Data Mining (W. Kloesgen and J. Zytkow, eds.). Oxford Univ. Press. FELLEMAN, H., ed. (1936). The Best Loved Poems of the American

People. Doubleday, New York. GOPINATHAN, K. M., BIAFORE, L. S., FERGUSON, W. M.,

LAZARUS, M. A., PATHRIA, A. K. and JOST, A. (1998). Fraud detection using predictive modeling. U.S. Patent 5819226, October 6. HAND, D. J. (1996). Classification and computers: Shifting the fo-

cus. In COMPSTAT-96: Proceedings in Computational Statistics (A. Prat, ed.) 77–88. Physica, Heidelberg. HAND, D. J. (1998). Breaking misconceptions—statistics and its

relationship to mathematics (with discussion). The Statistician 47 245–250, 284–286. KELLY, M. G., HAND, D. J. and ADAMS, N. M. (1999). The

impact of changing populations on classifier performance. In Proceedings of the Fifth ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (S. Chaudhuri and D. Madigan, eds.) 367–371. ACM Press, New York. PERLICH, C., PROVOST, F. and SIMONOFF, J. S. (2001). Tree

induction vs. logistic regression: A learning-curve analysis. Journal of Machine Learning Research. To appear.
