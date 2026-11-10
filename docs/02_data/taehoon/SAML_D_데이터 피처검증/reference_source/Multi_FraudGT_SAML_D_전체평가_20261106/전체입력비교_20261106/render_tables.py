"""Insert exhaustive full-population input comparison into the cause report."""
from pathlib import Path
import csv, json, re

ROOT = Path(__file__).resolve().parent
REPORT = ROOT.parent / '성능하락_원인보고서_20261106.md'
PREFIX = '전체입력비교_20261106/'
MARKER = '## 10. HI-Large·SAML-D 전체 입력값 비교'

def read(name):
    with (ROOT/name).open() as f:
        return list(csv.DictReader(f))

def table(headers, rows):
    return '\n'.join(['| '+' | '.join(headers)+' |',
                      '| '+' | '.join(['---']*len(headers))+' |'] +
                     ['| '+' | '.join(map(str,row))+' |' for row in rows])

def number(v):
    v = float(v)
    if v == 0: return '0'
    if abs(v) >= 10000: return f'{v:,.2f}'
    if abs(v) < .0001: return f'{v:.3e}'
    return f'{v:.4f}'

def percent(v): return f'{float(v)*100:.4f}%'

NODE = {
 'log_out_count':'송신 거래 수(log1p)',
 'log_in_count':'수신 거래 수(log1p)',
 'log_out_neighbors':'송신 상대계좌 수(log1p)',
 'log_in_neighbors':'수신 상대계좌 수(log1p)',
 'log_self_count':'자기거래 수(log1p)',
 'log_reciprocal_neighbors':'쌍방향 거래 상대계좌 수(log1p)',
 'mean_paid_currency_z':'송금액 통화별 z-score 평균',
 'paid_outlier_fraction':'송금액 이상치 비율',
 'log_currency_count':'사용 통화 수(log1p)',
 'log_active_days':'활동일 수(log1p)',
 'type_Corporation':'법인 유형 표시',
 'type_Partnership':'파트너십 유형 표시',
 'type_Sole Proprietorship':'개인사업 유형 표시',
 'type_Individual':'개인 유형 표시',
 'type_Country':'Country 유형 표시',
 'type_Direct':'Direct 유형 표시',
 'log_entity_observed_accounts':'동일 소유 엔터티 관측 계좌 수(log1p)',
 'log_entity_out_diversity':'소유 엔터티 송신 다양성(log1p)',
 'log_entity_in_diversity':'소유 엔터티 수신 다양성(log1p)',
}
EDGE = {
 'pair_prior_count':'계좌 쌍의 과거 거래 수',
 'pair_gap_minutes':'계좌 쌍의 직전 거래 이후 간격',
 'pair_count_1h':'계좌 쌍의 최근 1시간 거래 수',
 'sender_gap_minutes':'송신 계좌의 직전 거래 이후 간격',
 'sender_count_1h':'송신 계좌의 최근 1시간 거래 수',
 'receiver_gap_minutes':'수신 계좌의 직전 거래 이후 간격',
 'receiver_count_1h':'수신 계좌의 최근 1시간 거래 수',
 'paid_currency_z':'송금액의 HI 통화별 z-score',
 'reverse_history_count':'역방향 거래 이력 수',
 'pair_age_at_day_start':'일 시작 시 계좌 쌍의 이력 기간',
 'same_known_country':'같은 알려진 소유국가 여부',
 'both_countries_known':'양쪽 소유국가를 모두 아는지',
 'same_currency':'지급·수취 통화가 같은지',
 'is_self_transfer':'송신·수신 계좌가 같은지',
}

def main():
    verify=json.loads((ROOT/'verification.json').read_text())
    assert verify['all_passed']
    e={(r['domain'],r['feature']):r for r in read('edge_full_statistics.csv')}
    n={(r['domain'],r['kind'],r['feature']):r for r in read('node_query_full_statistics.csv')}
    p={(r['domain'],r['format']):r for r in read('payment_full_distribution.csv')}
    cov={r['domain']:r for r in json.loads((ROOT/'coverage.json').read_text())}
    node_names=[r['feature'] for r in read('node_query_full_statistics.csv') if r['domain']=='SAML_all' and r['kind']=='src']
    edge_names=[r['feature'] for r in read('edge_full_statistics.csv') if r['domain']=='SAML_all' and r['feature'] not in ['in_port','out_port']]
    assert set(node_names)==set(NODE) and set(edge_names)==set(EDGE)
    out=[MARKER, '''추가 집계일: 2026-11-06 (UTC). **모델에 들어가는 기본 피처 34종과 추가 구조 입력을 모두 비교했다.** 아래 수치는 표본이 아니라 각 데이터의 전체 대상 거래를 집계한 값이다. 위 5절의 정상 거래 표본·중앙값·KS 표와 집계 범위 및 통계량이 다르다.

#### 비교 범위와 읽는 방법

- **HI-Large 전체**는 현재 Multi-FraudGT에서 사용하는 관측 필드 기준 중복 제거 후 170,426,489건이다. Train 102,505,233건 + Validation 34,491,749건 + Test 33,429,507건을 모두 포함한다. 배포 원본 CSV의 중복 제거 전 행 수와 혼동하지 않는다.
- **SAML-D 전체**는 9,504,852건이다. 두 데이터 모두 정상·사기를 포함하며 정답으로 필터링하지 않았다. 원래 0 대체 입력 기준이고, 중앙값 대체 실험 입력은 아래에서 따로 표시한다.
- 거래 피처는 거래마다 한 번 집계했다. 노드 피처는 각 거래의 **송신·수신 끝점 기준**이다. 같은 계좌가 여러 거래에 나오면 그 횟수만큼 반영한다. 전체 계좌를 한 번씩 세는 통계는 별도 CSV로 제공한다.
- HI 노드 입력은 실제 사용 조건에 맞춰 Train은 2022-09-25, Validation은 2022-10-13, Test는 2022-10-31의 누적 스냅샷을 적용했다. HI 전체 노드 평균은 이 세 구간을 거래 수로 가중한 값이다. SAML은 2023-08-23 전체 기간 말 상태를 사용했다.
- 숫자는 **전처리 후 모델 입력값**이다. 로그 변환된 수·시간 이력 값을 원래 건수·분으로 해석하거나 평균을 단순 역변환하면 안 된다. 0 비율은 실제 0, 이력이 없는 경우, 이진 피처의 거짓, 결측 대체를 모두 포함하므로 결측률과 같지 않다.
- 전체 평균·표준편차·최솟값·최댓값·0 개수/비율을 계산했다. 전체 중앙값·분위수는 이번 집계에 포함하지 않았다. 배치마다 반복해서 뽑힌 이웃의 노출 횟수가 아니라 전체 거래 모집단의 입력 분포다.''']
    rows=[
      ['전체 거래 수','170,426,489','9,504,852'],
      ['기간','2022-08-01~2022-10-31','2022-10-07~2023-08-23'],
      ['전체 거래에 등장한 계좌 수',f"{cov['HI_all']['active_query_accounts']:,}",f"{cov['SAML_all']['active_query_accounts']:,}"],
      ['기본 피처 종류','계좌 19 + 거래 숫자 14 + 결제방식 1 = 34종','동일한 34종 스키마'],
      ['미제공 정보를 0으로 대체한 피처','SAML과 동일한 전역 11종 결측 처리 없음','계좌 유형 6 + 소유관계 3 + 국가 2 = 11종'],
      ['실제 노드 입력','19 + Ego 1 = 20차원','동일'],
      ['관계별 실제 엣지 입력','숫자 14 + 결제방식 one-hot 8 + Port 1 = 23차원','동일'],
      ['결제방식 Unknown',f"{int(p['HI_all','Unknown']['rows']):,}건",f"{int(p['SAML_all','Unknown']['rows']):,}건 ({percent(p['SAML_all','Unknown']['fraction'])})"],
      ['미지원 결제통화','기존 HI 인코딩·정규화 통계 사용','159,771건의 금액 z-score를 기존 규칙대로 0 처리'],
    ]
    out.append(table(['비교 항목','HI-Large 전체','SAML-D 전체'],rows))
    out += ['#### 계좌 입력 19종: 송신·수신 값 비교',
            '각 칸의 `송 / 수`는 송신 계좌와 수신 계좌 순서다. 소유관계·계좌 유형의 SAML 0은 정보 부재 대체값이며, 자기거래 수의 SAML 0은 관측값이다.']
    rows=[]
    for name in node_names:
        def pair(domain,key,formatter):
            return ' / '.join(formatter(n[domain,role,name][key]) for role in ['src','dst'])
        if name.startswith('type_') or name.startswith('log_entity_'): note='정보 미제공 → 전부 0'
        elif name=='log_self_count': note='관측 자기거래 없음'
        else: note='관측 거래에서 계산'
        rows.append([f'`{name}`<br>{NODE[name]}',pair('HI_all','mean',number),pair('SAML_all','mean',number),
                     pair('HI_all','zero_fraction',percent),pair('SAML_all','zero_fraction',percent),note])
    out.append(table(['피처·의미','HI 전체 평균<br>송 / 수','SAML 평균<br>송 / 수','HI 0 비율<br>송 / 수','SAML 0 비율<br>송 / 수','SAML 적용'],rows))
    out += ['#### 거래 숫자 입력 14종: 전체 평균·0 비율',
            '이진 피처의 평균은 값이 1인 거래의 비율이다. `same_known_country=0`은 다른 국가 또는 정보 부재일 수 있고, 함께 입력하는 `both_countries_known=0`이 국가 정보 부재의 단서를 제공한다.']
    rows=[]
    for name in edge_names:
        hi,sa=e['HI_all',name],e['SAML_all',name]
        note='정보 미제공 → 전부 0' if name in ['same_known_country','both_countries_known'] else ('관측 자기거래 없음' if name=='is_self_transfer' else ('HI 통계 고정; 미지원 통화는 0' if name=='paid_currency_z' else '관측 거래에서 계산'))
        rows.append([f'`{name}`<br>{EDGE[name]}',number(hi['mean']),number(sa['mean']),percent(hi['zero_fraction']),percent(sa['zero_fraction']),note])
    out.append(table(['피처·의미','HI 전체 평균','SAML 평균','HI 0 비율','SAML 0 비율','SAML 적용'],rows))
    out += ['#### 결제방식 1종: 실제 one-hot 8차원',
            '각 거래는 아래 8개 열 중 하나가 1이고 나머지는 0이다. 표의 비율은 해당 one-hot 열의 평균과 같다. SAML Cash Deposit·Cash Withdrawal은 Cash로, Debit card·Cross-border는 Unknown으로 대응한다.']
    rows=[]
    for name in ['ACH','Bitcoin','Cash','Cheque','Credit Card','Reinvestment','Wire','Unknown']:
        hi,sa=p['HI_all',name],p['SAML_all',name]
        mapping={'ACH':'ACH','Bitcoin':'해당 결제방식 없음','Cash':'Cash Deposit + Cash Withdrawal','Cheque':'Cheque','Credit Card':'Credit card','Reinvestment':'해당 결제방식 없음','Wire':'해당 결제방식 없음; Cross-border를 임의 매핑하지 않음','Unknown':'Debit card + Cross-border'}[name]
        rows.append([name,f"{int(hi['rows']):,}",percent(hi['fraction']),f"{int(sa['rows']):,}",percent(sa['fraction']),mapping])
    out.append(table(['모델 범주','HI 전체 건수','HI 비율','SAML 건수','SAML 비율','SAML 원본 대응'],rows))
    out += ['#### 추가 구조 입력: Port·Ego와 그래프 인덱스',
            'Port는 계좌별 시간순 최초 상대계좌의 0부터 시작하는 순번이다. 수신 Port는 정방향 관계, 송신 Port는 역방향 관계에 사용한다. 각 관계에 Port 1개가 추가되는 것이며 같은 관계에 2개를 모두 붙이는 것은 아니다.']
    rows=[]
    for name in ['in_port','out_port']:
        hi,sa=e['HI_all',name],e['SAML_all',name]
        rows.append([name,number(hi['mean']),number(sa['mean']),f"{int(float(hi['minimum'])):,}~{int(float(hi['maximum'])):,}",f"{int(float(sa['minimum'])):,}~{int(float(sa['maximum'])):,}",percent(hi['zero_fraction']),percent(sa['zero_fraction'])])
    out.append(table(['입력','HI 평균','SAML 평균','HI 범위','SAML 범위','HI 0 비율','SAML 0 비율'],rows))
    out.append('전체 집계에서 HI의 `out_port` 평균은 1,246.82, 최댓값은 55,955이고 SAML은 평균 11.23, 최댓값 59다. 앞선 정상 표본의 중앙값 비교와는 다른 통계다. 큰 값의 영향을 받는 전체 평균과 표본 중앙값을 함께 보아야 하며, 이 차이만으로 Port가 성능 하락의 확정 원인이라고 판단하지 않는다.')
    out.append('''Ego는 **현재 공유 배치의 질의 거래 끝점이면 1, 그 외 문맥 노드이면 0**이다. 배치 구성에 따라 달라지므로 전역 고정 평균을 만들지 않았다. 양쪽 데이터에서 같은 규칙을 사용한다. `edge_index`·노드/거래 ID는 연결과 조회에 쓰는 인덱스이며 ID 숫자 자체를 새로운 수치 피처로 넣지 않는다. 사기 정답과 패턴명은 모델 입력이 아니다.

기존 캐시의 `pair_history_count`, `same_entity`, `amt_z_pay_ccy`는 17개 원래 거래 열 중 이번 Multi-FraudGT 숫자 14종에서 제외된 열이다. SAML 캐시 71개 열 전체나 과거 HGB 41피처가 이 모델에 모두 들어간 것은 아니다. 소유관계 3종은 노드 피처로 사용되지만 `same_entity` 엣지 피처를 추가로 사용하는 것은 아니다.''')
    out += ['#### 중앙값 대체 실험에서 달라진 입력',
            '아래 3종만 모든 SAML 계좌에 같은 상수로 대체했다. 위 전체 통계표는 기존 0 대체 기준이다.']
    out.append(table(['노드 피처','기존 SAML 값','중앙값 대체 실험 값'],[
        ['`log_entity_observed_accounts`','0','2.302585'],
        ['`log_entity_out_diversity`','0','3.044523'],
        ['`log_entity_in_diversity`','0','2.772589'],
    ]))
    out += ['#### 집계 파일과 검증',
            f"전체 HI 입력을 날짜가 겹치지 않는 세 구간으로 전수 순회했고, 관측 거래 ID의 중복·누락 없이 총 {verify['hi_rows']:,}건을 포함하는지 확인했다. SAML은 전체 {verify['saml_rows']:,}건을 순회했다. 알려진 0 대체 열, Unknown 건수, 기존 HI Train/Test 결제방식 모집단 통계와의 일치도 검산했다. 저장된 입력의 크기·수정 시각은 작업 전후 동일하며 모델 재학습·추론이나 SALT-GNN 재개는 수행하지 않았다."]
    out.append(table(['파일','내용'],[
        [f'[거래·Port 전체 통계]({PREFIX}edge_full_statistics.csv)','HI Train/Validation/Test/전체, SAML 전체; 평균·표준편차·범위·0 비율'],
        [f'[거래 끝점별 노드 전체 통계]({PREFIX}node_query_full_statistics.csv)','각 구간의 실제 노드 스냅샷을 거래 빈도로 가중한 송신·수신 19종'],
        [f'[고유 활동 계좌 전체 통계]({PREFIX}node_account_full_statistics.csv)','계좌당 한 번 집계; HI 전체는 마지막 날 누적 스냅샷'],
        [f'[결제방식 전체 분포]({PREFIX}payment_full_distribution.csv)','구간별·전체 one-hot 범주 건수·비율'],
        [f'[모집단 커버리지]({PREFIX}coverage.json), [검산 결과]({PREFIX}verification.json)','전수 집계 범위·인원/거래 수·검증'],
        [f'[집계 계획]({PREFIX}plan.json), [입력 파일 목록]({PREFIX}input_manifest.json)','입력 경로·형상·집계 기준'],
        [f'[전수 집계 코드]({PREFIX}compare_full_inputs.py), [표 생성 코드]({PREFIX}render_tables.py)','기존 입력을 읽어 통계와 표를 재현'],
    ]))
    body='\n\n'.join(out)+'\n'
    text=REPORT.read_text()
    if '\n'+MARKER in text:
        before,after=text.split('\n'+MARKER,1)
        later=re.search(r'\n## \d+\.',after)
        tail=after[later.start():] if later else ''
    else:before,tail=text.rstrip(),''
    text=before.rstrip()+'\n\n'+body+tail
    text=re.sub(r'^## 5\. 관측 가능한 피처와 누적 그래프의 분포 차이(?: — 표본 비교)*$',
                '## 5. 관측 가능한 피처와 누적 그래프의 분포 차이 — 표본 비교',text,flags=re.MULTILINE)
    note='추가: **HI-Large·SAML-D 전체 모집단의 34종 입력과 Port·Ego 비교표는 10절**에 수록했다. 기존 5절은 정상 거래 표본 비교다.'
    if note not in text:
        text=text.replace('\n## 1. 핵심 판단','\n'+note+'\n\n## 1. 핵심 판단',1)
    REPORT.write_text(text)
    print(json.dumps(dict(report=str(REPORT),node_types=len(node_names),numeric_edge_types=len(edge_names),
                         payment_feature_types=1,one_hot_columns=8,all_population_tables=True),ensure_ascii=False))

if __name__=='__main__':
    main()
