# Documentation of actual model inputs, not a new preprocessing implementation.
from audit_common import *
DESCRIPTIONS={
 'log_out_count':'계좌 누적 송금 건수의 log1p',
 'log_in_count':'계좌 누적 수취 건수의 log1p',
 'log_out_neighbors':'계좌의 누적 서로 다른 수신 계좌 수 log1p',
 'log_in_neighbors':'계좌의 누적 서로 다른 송신 계좌 수 log1p',
 'log_self_count':'계좌 누적 자기 계좌 송금 수 log1p',
 'log_reciprocal_neighbors':'양방향 거래가 관측된 서로 다른 상대 계좌 수 log1p; 자기 계좌 제외',
 'mean_paid_currency_z':'계좌의 누적 송금 금액 robust z 평균',
 'paid_outlier_fraction':'계좌의 누적 송금 중 abs(robust z)>=3 비율',
 'log_currency_count':'송금 지급통화·수취 수취통화를 합친 누적 통화 종류 수 log1p',
 'log_active_days':'송금 또는 수취가 있었던 누적 날짜 수 log1p',
 'log_entity_observed_accounts':'같은 소유주로 매핑되고 실제 거래에서 관측된 누적 계좌 수 log1p; 전체 등록 계좌 수 아님',
 'log_entity_out_diversity':'소유주 단위 누적 서로 다른 상대 수신 소유주 수 log1p',
 'log_entity_in_diversity':'소유주 단위 누적 서로 다른 상대 송신 소유주 수 log1p',
 'pair_prior_count':'같은 src,dst의 대상 분 이전 누적 거래 수 log1p',
 'pair_gap_minutes':'같은 src,dst의 마지막 이전 분 거래와 간격: log(2+분); 이력 없으면0',
 'pair_count_1h':'같은 src,dst의 직전60분부터 직전1분까지 거래 수 log1p',
 'sender_gap_minutes':'같은 송신 계좌의 마지막 이전 분 송금과 간격: log(2+분); 없으면0',
 'sender_count_1h':'같은 송신 계좌의 직전60분부터 직전1분까지 송금 수 log1p',
 'receiver_gap_minutes':'같은 수신 계좌의 마지막 이전 분 수취와 간격: log(2+분); 없으면0',
 'receiver_count_1h':'같은 수신 계좌의 직전60분부터 직전1분까지 수취 수 log1p',
 'paid_currency_z':'log1p(paid/통화 scale)를 통화별 중앙값·IQR로 정규화, [-8,8] 절단; 지급·수취 금액을 합쳐 보정',
 'amt_z_pay_ccy':'log1p(paid)를 지급통화별 평균·표준편차로 정규화, [-10,10] 절단; 지급 금액만 보정',
 'pair_history_count':'대상일 시작 이전 같은 src,dst의 누적 거래 수 log1p',
 'reverse_history_count':'대상일 시작 이전 반대 dst,src의 누적 거래 수 log1p',
 'pair_age_at_day_start':'대상일 0시와 마지막 이전 날짜의 같은 거래쌍 거래 사이 log(2+분); 최초 거래 이후 수명이 아님',
 'same_entity':'정적 계좌 레지스트리상 송·수신 계좌 소유주 ID가 같은지',
 'same_known_country':'은행 이름에서 추출한 양측 국가가 모두 알려져 있고 같은지; 고객 거주국이 아님',
 'both_countries_known':'양측 은행 이름에서 국가를 추출할 수 있는지; 고객 국가 보유 여부가 아님',
 'same_currency':'지급통화와 수취통화가 같은지',
 'is_self_transfer':'src와 dst가 동일 계좌인지',
 'payment_format':'원거래 결제 방식. HGB에서 명시적 범주형 처리; 정수 코드 순서로 학습하는 피처가 아님',
 'minute_sender_vs_prior_hour':'log1p(60*동일 분 비자기 송금 건수) - log1p(이전60분 송금 건수)',
 'minute_receiver_vs_prior_hour':'log1p(60*동일 분 비자기 수취 건수) - log1p(이전60분 수취 건수)',
 'day_ccy_flow_balance':'계좌·통화별 당일 수취액과 송금액의 min/max; 양쪽0이면0',
 'day_ccy_log_matching_in_amount':'계좌·통화별 당일 수취 중 대상 금액과 정확히 같은 건수 log1p; dst는 대상 거래 자체 포함',
 'prior_ccy_amount_seen':'계좌·통화·방향별 대상일 이전 동일 금액 관측 여부; 실제 first_day<대상일 조건',
 'prior_ccy_amount_vs_mean':'log1p(대상 금액/같은 계좌·통화·방향의 이전 날짜 평균 금액); 이력/평균 없으면0',
 'day_ccy_rate_vs_prior':'log1p(당일 방향·통화 건수) - log1p(이전 건수/최초 과거 활동일부터의 달력 일수)',
 'pair_amount_seen_before_day':'같은 src,dst,지급통화,지급금액이 대상일 이전에 관측됐는지',
}
for name in MAN['union_raw_types']:
    if name.startswith('type_'):DESCRIPTIONS[name]='entity_name의 접두어가 '+name[5:]+'인지 나타내는 원핫; 실제 관측 계좌만 활성화'
assert set(DESCRIPTIONS)==set(MAN['union_raw_types'])
KYC={n for n in DESCRIPTIONS if n.startswith('type_') or n.startswith('log_entity_') or n in ['same_entity','same_known_country','both_countries_known']}
CALIB={'paid_currency_z','amt_z_pay_ccy','mean_paid_currency_z','paid_outlier_fraction'}
MINUTE={'pair_prior_count','pair_gap_minutes','pair_count_1h','sender_gap_minutes','sender_count_1h','receiver_gap_minutes','receiver_count_1h'}
PRIOR={'pair_history_count','reverse_history_count','pair_age_at_day_start','prior_ccy_amount_seen','prior_ccy_amount_vs_mean','pair_amount_seen_before_day'}
REDUNDANCY={
 'amt_z_pay_ccy':'paid_currency_z와 같은 지급금액의 다른 단조 변환; ACH 정상 표본 Spearman 0.999673. 서로 다른 보정·절단 때문에 완전중복 아님',
 'paid_currency_z':'amt_z_pay_ccy와 높은 중복. robust 값은 노드 평균·이상치 비율에도 쓰이므로 계열 단위 비교 필요',
 'pair_prior_count':'pair_history_count와 ACH 정상 Spearman 0.999625. 당일 이전 분 이력을 포함하므로 정의는 다름',
 'pair_history_count':'pair_prior_count와 높은 중복. 일중 변화를 잃지 않도록 우선 제거 후보는 본 피처로 제안',
 'prior_ccy_amount_seen':'src/dst 반복 여부와 pair_amount_seen_before_day의 거의 같은 값 여부를 전수 확인. 계좌와 거래쌍 의미는 다름',
 'pair_amount_seen_before_day':'prior_ccy_amount_seen과 거의 같은 신호. 정상 반복 금액 규칙에 대한 의존도도 함께 검증 필요',
 'same_entity':'is_self_transfer와 정상에서 대부분 일치하나 다른 계좌·같은 소유주 거래를 추가로 표현',
 'is_self_transfer':'same_entity에 대부분 포함되지만 KYC 없이 확인할 수 있는 계좌 동일성',
 'day_ccy_log_matching_in_amount':'dst는 자기 거래가 항상 포함되어 대부분 log2; src는 별도의 입금→송금 연결 신호이므로 함께 삭제하면 안 됨',
}
for n in ['log_out_count','log_in_count','log_out_neighbors','log_in_neighbors','log_reciprocal_neighbors']:REDUNDANCY[n]='계좌 건수·이웃 수 계열의 상관 후보. 반복 빈도·상대 다양성·상호성은 의미가 달라 개별 또는 묶음 비교 필요'
for n in ['log_entity_observed_accounts','log_entity_out_diversity','log_entity_in_diversity']:REDUNDANCY[n]='소유주 규모·거래 다양성 계열 상관. 묶음 교란 영향이 개별보다 커 개별 중요도만으로 삭제 불가'

def timeframe(n):
    if n in MINUTE:return '대상 거래의 분 미만; 1시간 건수는 [t-60분,t-1분]'
    if n in PRIOR:return '대상 날짜 0시 미만'
    if n.startswith('type_') or n in ['same_entity','same_known_country','both_countries_known']:return '정적 레지스트리; 과거 가용 시점 미확인'
    if n in ['paid_currency_z','amt_z_pay_ccy']:return '대상 거래 금액 + 8/1~8/7 고정 보정통계'
    if n in ['payment_format','same_currency','is_self_transfer']:return '대상 거래에서 관측 가능'
    if n.startswith('minute_'):return '대상 분 전체 + 그 이전60분'
    if n.startswith('day_ccy_'):return '대상 날짜 마감까지; rate는 이전 날짜 이력도 사용'
    return '원자료 시작부터 대상 날짜 마감까지 누적'

def recommendation(n):
    if n=='payment_format':return '최우선 제거 비교 후보; 강제 유지 규칙 해제. 직접 정답누수는 아니지만 지름길 의존 확인'
    if n in ['same_known_country','both_countries_known']:return '의미 수정 및 KYC 가용시점 확인 전 운영 승인 보류; GNN 제거 비교 후보'
    if n=='type_Direct':return '희소 원핫 제거 우선 후보; KYC 시점도 확인 필요'
    if n in ['amt_z_pay_ccy','pair_history_count','pair_amount_seen_before_day','same_entity']:return '중복/추가효용 축소 비교 우선 후보. 현재 모델의 교란 성능을 삭제 재학습 성능으로 해석하지 말 것'
    if n=='day_ccy_log_matching_in_amount':return 'dst 스칼라만 우선 제거 후보; src는 유지 비교. 피처 종류 수와 스칼라 열 수를 구별'
    if n in KYC:return 'KYC 시점 검증 보류. 직접 정답누수 증거 없음; 합성 데이터 대리지표 및 무KYC 묶음 비교'
    if n in ['prior_ccy_amount_seen','pair_prior_count']:return '유용한 행동 신호이나 데이터 반복성 편향과 강한 의존 확인; 대응 정상 집단·외부 데이터로 추가 검증'
    if n=='pair_age_at_day_start':return '관계 나이 대신 이전 거래의 최근성으로 설명/이름 수정; 이전 날짜 조건 유지'
    if n=='same_currency':return '양성100%만으로 지름길 판정 금지; 정상도 대부분 동일. 개별 영향이 아니라 추가효용으로 결정'
    return '유지 후보. 중요도가 높다는 이유로 제거하지 않음; 축소 재학습 전까지 필요/불필요 확정 안 함'

def shortcut_risk(n):
    if n=='payment_format':return '높음: 강제 포함 이력 + 패턴100% ACH + 고정모델 입력 변경에 큰 반응; 직접 정답누수와 구분'
    if n in ['prior_ccy_amount_seen','pair_amount_seen_before_day']:return '높음: 반복금액에 강한 의존; HI 정상93.97% 대 SAML 정상약0.017%로 src 반복 여부 분포 이동. 두 피처 모두 SAML 원자료 전수 재계산 일치'
    if n=='day_ccy_log_matching_in_amount':return 'src는 패턴 특화(약51.87%)·무패턴 약0.59%; dst는 거의 상수. SAML에서는 수취금액 부재로0대치하므로 분포 해석 금지'
    if n=='same_currency':return 'HI 양성100%지만 정상98.35%로 양성 구분력은 약함. SAML 양성은 약63%로 규칙 이동 존재'
    if n in ['same_known_country','both_countries_known']:return '은행명 기반 가용성/국가 대리지표. ACH급 지배성은 관찰하지 못함; 고객 국가로 해석 금지'
    if n.startswith('type_'):return '합성 entity_name 접두어 원핫. ACH급 분리도는 확인 못함; 희소성·시점·외부 제공 여부 점검'
    if n in KYC:return '정적 소유주 매핑과 관측 행동의 혼합. 무패턴 민감도 존재하나 과거 KYC 가용성 미확인'
    if n in ['pair_prior_count','pair_history_count','pair_age_at_day_start']:return '거래쌍 신규성/최근성에 강한 의존. 유효 행동 신호일 수 있어 중요도만으로 지름길이나 누수로 단정 금지'
    return '검사 범위에서 ACH급 범주 지름길로 확정하지 않음; 유효 행동 신호와 생성 규칙 대리 신호를 혼동하지 말 것'
