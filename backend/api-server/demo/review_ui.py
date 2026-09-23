"""Case-oriented prototype. All data and decisions cross the Spring HTTP boundary."""
import html
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import altair as alt
import pandas as pd
import streamlit as st

from api_client import ApiClient, ApiError

KST = timezone(timedelta(hours=9))
TYPE_NAMES = ['패턴아님', 'Fan-out', 'Fan-in', 'Gather-scatter', 'Scatter-gather',
              'Cycle', 'Random', 'Bipartite', 'Stack']


def display(value):
    if isinstance(value, dict):
        return {k: display(v) for k, v in value.items()}
    if isinstance(value, list):
        return [display(v) for v in value]
    if isinstance(value, str) and len(value) > 19 and value[10] == 'T':
        try:
            instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if instant.tzinfo:
                return instant.astimezone(KST).strftime('%Y-%m-%d %H:%M:%S KST')
        except ValueError:
            pass
    return value


def table(rows, **kwargs):
    st.dataframe(pd.json_normalize(display(rows)), hide_index=True, width='stretch', **kwargs)


def dates(key, today):
    with st.popover('기간 📅'):
        period = st.date_input('조회 기간', (today - timedelta(days=9), today), key=key)
    if len(period) != 2:
        st.info('시작일과 종료일을 선택하세요.')
        st.stop()
    return {'from': period[0].isoformat(), 'to': period[1].isoformat()}


def filter_tags(entries):
    """Visible removable chips share state with controls inside the filter popover."""
    if not entries:
        return
    columns = st.columns(min(len(entries), 5))
    for i, (key, value, label) in enumerate(entries):
        def remove(k=key, v=value):
            current = st.session_state[k]
            st.session_state[k] = [x for x in current if x != v] if isinstance(current, list) else False
        columns[i % len(columns)].button(f'#{label} ×', key=f'tag_{key}_{value}', on_click=remove)


def paged(client, path, params, key):
    fingerprint = json.dumps(params, sort_keys=True)
    if st.session_state.get(key + '_filters') != fingerprint:
        st.session_state[key + '_filters'] = fingerprint
        st.session_state[key] = 0
    page = st.number_input('페이지', min_value=0, step=1, key=key)
    result = client.get(path, dict(params, page=page, size=20), page=True)
    st.caption(f"전체 {result['totalElements']:,}건 · 페이지 {page + 1}/{max(1, result['totalPages'])}")
    return result['content']


def ledger_page(client, today):
    st.header('Transactions')
    params = dates('ledger_dates', today)
    with st.popover('필터'):
        judgements = st.multiselect('모델 판정', ['SUSPICIOUS', 'NORMAL', 'UNANALYZED'],
                                    format_func=lambda x: {'SUSPICIOUS': '의심', 'NORMAL': '정상', 'UNANALYZED': '분석 대기'}[x], key='ledger_judgement')
        payments = st.multiselect('결제 수단', client.get('review/payment-formats'), key='ledger_payments')
    filter_tags([('ledger_judgement', v, {'SUSPICIOUS': '의심', 'NORMAL': '정상', 'UNANALYZED': '분석 대기'}[v]) for v in judgements]
                + [('ledger_payments', v, v) for v in payments])
    if judgements:
        params['judgement'] = judgements
    if payments:
        params['payments'] = payments
    st.caption('필터 안의 선택 태그에서 ×를 누르면 해당 조건이 해제됩니다. 모델 판정과 직원 판단은 별개입니다.')
    owner_col, account_col, tx_col = st.columns([1, 1, 2.5])
    with owner_col:
        st.subheader('소유주')
        owners = paged(client, 'ledger/owners', params, 'owner_page')
        table(owners)
        owner = st.selectbox('소유주 선택', [r['id'] for r in owners], index=None, placeholder='선택하세요', key='owner')
    with account_col:
        st.subheader('계좌')
        if owner:
            accounts = paged(client, 'ledger/accounts', dict(params, owner=owner), 'account_page')
            table(accounts)
            labels = {r['id']: f"은행 {r['bankId']} · {r['id']}" for r in accounts}
            account = st.selectbox('계좌 선택', list(labels), index=None, format_func=labels.get, key='account')
        else:
            account = None
            st.info('소유주를 선택하세요.')
    with tx_col:
        st.subheader('거래')
        if account:
            rows = paged(client, 'ledger/transactions', dict(params, owner=owner, account=account), 'ledger_page')
            table(rows)
        else:
            st.info('계좌를 선택하세요.')


def chart_map(values, label, amount=False):
    if not values:
        st.info('표시할 데이터가 없습니다.')
        return
    frame = pd.DataFrame([{'항목': k, label: float(v)} for k, v in values.items()])
    if amount:
        frame[['일자', '통화']] = frame['항목'].str.split('|', expand=True)
        st.altair_chart(alt.Chart(frame).mark_bar().encode(x='일자:N', y=alt.Y(label + ':Q'), color='통화:N').facet(row='통화:N'), width='stretch')
    else:
        st.bar_chart(frame, x='항목', y=label)


def graph(client, members, key):
    txs = {m['txId']: m['transaction'] for m in members if m['state'] not in ('EXCLUDED', 'TRANSFERRED')}
    if not txs:
        st.info('표시할 거래가 없습니다.')
        return
    ordered = sorted(txs.values(), key=lambda t: t['occurredAt'])
    style = st.radio('그래프 표현', ['계좌', '소유주'], horizontal=True, key=key + '_style')
    limit = st.slider('시간 흐름 · 표시할 거래 수', 1, len(ordered), len(ordered), key=key + '_timeline') if len(ordered) > 1 else 1
    visible = ordered[:limit]
    st.caption(f"{display(visible[0]['occurredAt'])} → {display(visible[-1]['occurredAt'])}")
    account_ids = sorted({str(t[k]) for t in visible for k in ('fromAccountId', 'toAccountId')})
    nodes = []
    for offset in range(0, len(account_ids), 500):
        nodes.extend(client.get('review/account-nodes', {'ids': account_ids[offset:offset + 500]}))
    owners = {str(n['id']): str(n['ownerId']) for n in nodes}
    quote = lambda x: json.dumps(str(x), ensure_ascii=False)
    dot = ['digraph G { rankdir=LR; node [shape=box];']
    if style == '소유주':
        for owner in sorted(set(owners.values())):
            accounts = [a for a in account_ids if owners.get(a) == owner]
            rows = ''.join(f'<TR><TD PORT="a{account_ids.index(a)}">{html.escape(a)}</TD></TR>' for a in accounts)
            dot.append(f'{quote(owner)} [shape=plain label=<<TABLE BORDER="1" CELLBORDER="0"><TR><TD BGCOLOR="#e6eefb">소유주 {html.escape(owner)}</TD></TR>{rows}</TABLE>>];')
    else:
        for node in nodes:
            dot.append(f'{quote(node["id"])} [label={quote(str(node["bankId"]) + " · " + str(node["id"]))}];')
    for t in visible:
        f, r = str(t['fromAccountId']), str(t['toAccountId'])
        source = quote(f) if style == '계좌' else quote(owners[f]) + ':a' + str(account_ids.index(f))
        dest = quote(r) if style == '계좌' else quote(owners[r]) + ':a' + str(account_ids.index(r))
        dot.append(f'{source} -> {dest} [label={quote(str(t["amountPaid"]) + " " + t["paymentCurrency"])}];')
    st.graphviz_chart('\n'.join(dot + ['}']))
    table([{'txId': t['txId'], 'occurredAt': t['occurredAt'], 'fromAccountId': t['fromAccountId'], 'toAccountId': t['toAccountId']} for t in visible])


def send_command(client, user, command, key):
    # Retain the same request identity after ambiguous network failure.
    body_key = json.dumps(command, sort_keys=True)
    saved = st.session_state.get(key)
    if not saved or saved['body'] != body_key:
        saved = {'body': body_key, 'id': str(uuid.uuid4())}
        st.session_state[key] = saved
    response = client.post('review/commands', dict(command, requestId=saved['id']), user['id'])
    del st.session_state[key]
    st.session_state['last_action'] = '처리가 저장됐습니다.'
    if response.get('targetCaseId'):
        st.session_state['last_action'] += f" Episode 사건 번호: {response['targetCaseId']}"
    st.rerun()


def target_picker(client, key, mine=None, exclude=None):
    choice = st.radio('목적지', ['새 Episode', '기존 Episode'], horizontal=True, key=key)
    if choice == '새 Episode':
        return {}
    params = {'kind': 'EPISODE', 'status': 'OPEN'}
    if mine:
        params['assigneeId'] = mine
    rows = paged(client, 'review/cases', params, key + '_page')
    rows = [r for r in rows if r['caseId'] != exclude]
    if not rows:
        st.info('선택할 열린 Episode가 없습니다.')
        return None
    selected = st.selectbox('Episode 선택', rows, format_func=lambda r: f"Episode {r['caseId']} · {r['assigneeName']}", key=key + '_case')
    return {'targetCaseId': selected['caseId'], 'targetRevision': selected['revision']}


def review_tab(client, user, detail):
    if detail.get('relatedDecisions'):
        st.subheader('같은 거래의 다른 사건 검토 기록')
        st.caption('사건별 근거와 범위가 다를 수 있습니다. 다른 사건의 결론을 자동으로 덮어쓰지 않습니다.')
        table(detail['relatedDecisions'])
    if detail['status'] != 'OPEN':
        st.info(f"종결 결과: {detail['outcome']}. 이관 당시 범위와 판단 이력은 보존됩니다.")
        return
    if detail['assigneeId'] != user['id']:
        st.info('담당 직원만 검토 결과를 변경할 수 있습니다.')
        return
    st.caption('모델의 의심/정상은 예측이며 담당자의 결론은 이 사건 범위에 대한 판단입니다.')
    selections = []
    for g in detail['groups']:
        with st.expander(f"{g['label']} · 묶음 {g['groupId']}", expanded=True):
            pending = [m for m in g['members'] if m['state'] in ('PENDING', 'DECIDED')]
            table([{'txId': m['txId'], '조사 역할': m['reviewRole'], '처리': m['state'], '판정': m['decision']} for m in g['members']])
            picked = st.multiselect('처리 범위 선택', [m['txId'] for m in pending], key=f"pick_{detail['caseId']}_{g['groupId']}_{detail['revision']}")
            if st.checkbox('묶음의 미처리 조사 대상 전체 선택', key=f"all_{g['groupId']}_{detail['caseId']}_{detail['revision']}"):
                picked = [m['txId'] for m in pending if m['reviewRole'] == 'SUBJECT' and m['state'] == 'PENDING']
            if picked:
                selections.append({'caseId': detail['caseId'], 'revision': detail['revision'], 'groupId': g['groupId'], 'txIds': picked})
    options = {'정상 판정': ('DECIDE', 'NORMAL'), '조사 범위 제외': ('EXCLUDE', None),
               '조사 대상으로 변경': ('SUBJECT', None), '참고 맥락으로 변경': ('CONTEXT', None)}
    if detail['kind'] == 'ALERT':
        options['Episode로 이관'] = ('TRANSFER', None)
    else:
        options.update({'세탁 의심 판정': ('DECIDE', 'SUSPICIOUS'), '선택 범위 별도 묶음 분리': ('SPLIT', None),
                        '다른 Episode로 이동': ('MOVE', None), '같은 Episode 다른 묶음으로 이동': ('MOVE', None),
                        '묶음 판정 재검토': ('RECONSIDER', None)})
    options.update({'의견만 저장': ('COMMENT', None), '사건 종결': ('CLOSE', None)})
    label = st.selectbox('처리 선택', list(options))
    action, decision = options[label]
    destination = {}
    if label == '같은 Episode 다른 묶음으로 이동':
        target = st.selectbox('이동할 묶음', detail['groups'], format_func=lambda g: f"{g['label']} · {g['groupId']}")
        destination = dict(targetCaseId=detail['caseId'], targetRevision=detail['revision'], targetGroupId=target['groupId'])
    elif action in ('MOVE', 'TRANSFER'):
        destination = target_picker(client, 'detail_target', user['id'] if action == 'MOVE' else None, detail['caseId'])
    comment = st.text_area('검토 의견 (필수)', max_chars=4000)
    if action in ('CLOSE', 'COMMENT'):
        selections = [{'caseId': detail['caseId'], 'revision': detail['revision'], 'groupId': 0, 'txIds': []}]
    if action == 'CLOSE':
        st.write(f"미처리 조사 대상: {detail['pendingCount']}건")
    confirmed = st.checkbox('선택 범위와 처리 결과를 확인했습니다.')
    if st.button('처리 저장', type='primary', disabled=not confirmed or not comment.strip() or not selections or destination is None or (action == 'CLOSE' and detail['pendingCount'] > 0)):
        send_command(client, user, dict(action=action, decision=decision, selections=selections, comment=comment, **destination), 'command')


def money_overview(client, user, d):
    minutes = st.selectbox('단시간 기준 (분)', [5, 15, 30, 60, 180, 360, 1440], index=4,
                           disabled=d['status'] == 'CLOSED', key=f"money_delay_{d['caseId']}")
    data = client.get(f"review/cases/{d['caseId']}/money", {'minutes': minutes})
    with st.expander('조사 중심 계좌 S'):
        st.caption('초기값은 씨앗 거래의 송·수취 계좌입니다. 선택 변경은 지표 범위만 바꾸며 사건 거래의 판정·소속은 바꾸지 않습니다.')
        editable = d['status'] == 'OPEN' and d['assigneeId'] == user['id']
        selected = st.multiselect('조사 계좌', data['candidateAccounts'], default=data['selectedAccounts'],
                                  disabled=not editable, key=f"money_accounts_{d['caseId']}_{d['revision']}")
        extra = st.text_input('추가 계좌 가명 UUID (쉼표 구분)', disabled=not editable)
        comment = st.text_input('계좌 범위 변경 의견', disabled=not editable)
        if st.button('조사 계좌 적용', disabled=not editable or not comment.strip()):
            accounts = sorted(set(selected + [a.strip() for a in extra.split(',') if a.strip()]))
            payload = dict(revision=d['revision'], accounts=accounts, comment=comment)
            fingerprint = json.dumps([d['caseId'], payload], sort_keys=True)
            if st.session_state.get('money_payload') != fingerprint:
                st.session_state['money_payload'] = fingerprint
                st.session_state['money_request'] = str(uuid.uuid4())
            payload['requestId'] = st.session_state['money_request']
            client.post(f"review/cases/{d['caseId']}/money-scope", payload, user['id'])
            st.rerun()
    if not data.get('available'):
        reasons = {'WAITING_RECEIPTS': '관측 기간의 은행 보고 수신·통합 완료를 기다리고 있습니다.',
                   'EMPTY_SUBJECT_SCOPE': '조사 대상 거래가 없습니다.', 'EMPTY_ACCOUNT_SCOPE': '조사 계좌를 선택하세요.',
                   'NO_CLOSED_SNAPSHOT': '이전 종결 사건에는 당시 자금 지표 기록이 없습니다.'}
        st.info(reasons.get(data.get('reason'), '지표를 산출할 수 없습니다.'))
        return
    st.caption(f"관측 기간 T: {display(data['start'])} ~ {display(data['endExclusive'])} 미만 · 수신 원장 {data['ledgerCount']:,}건")
    if not data['complete']:
        st.caption('수신 완료된 연속 날짜까지만 계산했습니다.')
    if d['status'] == 'CLOSED':
        st.caption('종결 당시 3시간 기준 지표를 보존한 값입니다.')
    st.subheader('외부 유입액 · 조사 범위 밖 → 안')
    table([{'통화': r['currency'], '외부 유입액': r['in'], '외부 유출액': r['out'], '전체 순유입액': r['net']} for r in data['external']])
    st.subheader(f"단시간 유출 비율 · {data['delayMinutes']}분")
    percent = lambda x: '산출 불가' if x is None else f'{x:.2f}%'
    table([{'계좌': r['accountId'], '통화': r['currency'], '평가 입금액': r['eligibleIn'],
            '대응 입금액': r['matchedIn'], '관측시간 부족 입금액': r['excludedIn'],
            '비율': percent(r['rapidOutflowPercent'])} for r in data['accounts']])
    st.caption('FIFO 계산상 추정이며 동일 자금의 이동을 확인한 값은 아닙니다. 동일 시각 입·출금과 자기 계좌 이체는 빠른 전달로 대응시키지 않습니다.')
    st.subheader('계좌별 순유입 · 양의 순유입 집중도')
    table([{'계좌': r['accountId'], '통화': r['currency'], '입금': r['in'], '출금': r['out'], '순유입': r['net'],
            '집중도': percent(r['concentrationPercent'])} for r in data['accounts']])
    st.caption('내부 이체 포함. 집중도는 통화별 양의 순유입액 중 비중이며 실제 잔액 비중이 아닙니다.')


def case_detail(client, user, case_id):
    d = client.get(f'review/cases/{case_id}')
    st.header(f"{d['kind'].title()} {d.get('alertId') or d['caseId']}")
    st.caption(f"담당 {d['assigneeName']} · {d['status']} · 탐지/생성 {display(d['createdAt'])} · {d['ageDays']}일 경과")
    if d['status'] == 'OPEN' and d['assigneeId'] == user['id'] and not any(h['action'] == 'REVIEW_START' for h in d['history']):
        if st.button('검토 시작 기록'):
            send_command(client, user, dict(action='REVIEW_START', selections=[dict(caseId=case_id, revision=d['revision'], groupId=0, txIds=[])], comment='담당자 상세 검토 시작'), 'review_start')
    key = f"tab_{case_id}"
    tab = st.segmented_control('상세 탭', ['개요', '자금 흐름', '거래', '검토 의견'], default='개요', key=key)
    members = [m for g in d['groups'] for m in g['members']]
    if tab == '개요':
        summary = d['summary']
        cols = st.columns(4)
        cols[0].metric('거래 수', summary['txCount'])
        cols[1].metric('씨앗 거래', summary['seedCount'])
        cols[2].metric('위험도 (최대 씨앗 점수)', f"{summary['riskScore']:.3f}")
        cols[3].metric('연결 Alert', len(d['sourceAlertIds']))
        st.write('거래 기간', display(summary['firstTxAt']), '—', display(summary['lastTxAt']))
        st.subheader('총 거래액 · 통화별')
        table([{'통화': k, '거래액 합계': v} for k, v in summary['amountsByCurrency'].items()])
        st.caption('경유 거래의 금액도 각각 합산한 거래액입니다.')
        money_overview(client, user, d)
        cols = st.columns(2)
        with cols[0]:
            st.subheader('상위 송금 계좌')
            table(summary['topSenders'])
        with cols[1]:
            st.subheader('결제 수단 구성 (건수)')
            chart_map(summary['paymentFormats'], '거래 수')
        st.subheader('일별 의심 거래 ' + ('금액' if d['kind'] == 'EPISODE' else '건수'))
        chart_map(summary['dailySuspiciousAmount'] if d['kind'] == 'EPISODE' else summary['dailySuspiciousCount'], '금액' if d['kind'] == 'EPISODE' else '건수', d['kind'] == 'EPISODE')
        st.subheader('연결 유형' if d['kind'] == 'EPISODE' else '대표 탐지 유형')
        st.write(' · '.join(d['primaryTypes']) if d['kind'] == 'EPISODE' else summary['primaryType'])
        st.caption('모델 분류의 요약이며 실제 세탁 패턴의 정답이 아닙니다.')
        if d['kind'] == 'ALERT':
            st.write('씨앗 중 대표 유형 비중', summary['typeShare'])
        patterns = {'Fan-out': 'A -> B; A -> C; A -> D;', 'Fan-in': 'B -> A; C -> A; D -> A;',
                    'Gather-scatter': 'A -> M; B -> M; M -> C; M -> D;',
                    'Scatter-gather': 'A -> B; A -> C; B -> D; C -> D;',
                    'Cycle': 'A -> B; B -> C; C -> A;', 'Stack': 'A -> B; B -> C; C -> D;',
                    'Bipartite': 'A -> C; A -> D; B -> C; B -> D;'}
        if summary['primaryType'] in patterns:
            st.caption('대표 유형 모양 예시 · 이 사건의 실제 그래프가 아닙니다.')
            st.graphviz_chart('digraph { rankdir=LR; ' + patterns[summary['primaryType']] + ' }')
        st.button('실제 자금 흐름 보기', on_click=lambda: st.session_state.update({key: '자금 흐름'}))
        st.subheader('탐지 근거')
        st.write('씨앗의 모델 탐지와 거래 연결 관계를 제공합니다. 모델 내부 설명을 추정하지 않습니다.')
        table([{'txId': m['txId'], '역할': m['transaction'].get('role'), '연결 이유': m['transaction'].get('includedReasons'), '모델 점수': m['transaction'].get('scores')} for m in members])
        st.subheader('처리 이력')
        st.write(f"생성 {display(d['createdAt'])} · 배정 {display(d['assignedAt'])} · {d['assigneeName']}")
        table(d['history'])
    elif tab == '자금 흐름':
        graph(client, members, str(case_id))
    elif tab == '거래':
        table([dict(m['transaction'], reviewRole=m['reviewRole'], state=m['state'], decision=m['decision']) for m in members])
    else:
        review_tab(client, user, d)


def cases_page(client, user, today, kind):
    st.header('Alerts' if kind == 'ALERT' else 'Episodes')
    params = dict(kind=kind, **dates(kind + '_dates', today))
    with st.popover('필터'):
        status = st.multiselect('업무 상태', ['OPEN', 'CLOSED'], default=['OPEN'], key=kind + '_status')
        mine = st.checkbox('내 담당만', key=kind + '_mine')
    filter_tags([(kind + '_status', v, {'OPEN': '열림', 'CLOSED': '종결'}[v]) for v in status]
                + ([(kind + '_mine', True, '내 담당')] if mine else []))
    if len(status) == 1:
        params['status'] = status[0]
    if mine:
        params['assigneeId'] = user['id']
    rows = paged(client, 'review/cases', params, kind + '_page')
    if not rows:
        st.info('조건에 맞는 사건이 없습니다.')
        return
    shown = [dict(선택=False, 사건=r['caseId'], Alert=r.get('alertId'), 위험도=r['summary']['riskScore'], 유형=' · '.join(r['primaryTypes']), 씨앗유형비중=r['summary']['typeShare'], 거래금액=str(r['summary']['amountsByCurrency']), 거래수=r['summary']['txCount'], 담당자=r['assigneeName'], 상태=r['status'], 탐지일=display(r['createdAt']), 경과일=r['ageDays']) for r in rows]
    edited = st.data_editor(pd.DataFrame(shown), hide_index=True, disabled=[k for k in shown[0] if k != '선택'], key=kind + '_selection')
    picked = edited.loc[edited['선택'], '사건'].tolist()
    if kind == 'ALERT' and user['role'] == 'L1' and picked:
        with st.expander('선택 Alert들을 Episode로 이관', expanded=True):
            selections = []
            valid = True
            for id in picked:
                d = client.get(f'review/cases/{id}')
                if d['assigneeId'] != user['id'] or d['status'] != 'OPEN':
                    st.info(f'{id}: 본인 담당의 열린 Alert만 이관할 수 있습니다.')
                    valid = False
                    continue
                for g in d['groups']:
                    options = [m['txId'] for m in g['members'] if m['state'] == 'PENDING']
                    ids = st.multiselect(f"Alert {d['alertId']} 이관 범위", options, default=options, key=f'batch_{id}_{g["groupId"]}_{d["revision"]}')
                    if ids:
                        selections.append(dict(caseId=id, revision=d['revision'], groupId=g['groupId'], txIds=ids))
            destination = target_picker(client, 'batch_target')
            comment = st.text_area('이관 의견', key='batch_comment')
            confirmed = st.checkbox('Alert별 선택 범위를 확인했습니다.', key='batch_confirm')
            if st.button('선택 범위 일괄 이관', disabled=not valid or not confirmed or not comment.strip() or not selections or destination is None):
                send_command(client, user, dict(action='TRANSFER', selections=selections, comment=comment, **destination), 'batch_command')
    choice = st.selectbox('상세 조회할 사건', rows, index=None, format_func=lambda r: f"{kind.title()} {r.get('alertId') or r['caseId']}")
    if choice:
        case_detail(client, user, choice['caseId'])


def dashboard_page(client, user, today):
    st.header('대시보드')
    period = dates('dashboard_dates', today)
    data = client.get('dashboard', period)
    personal, institution = st.tabs(['개인', '기관 전체'])
    with personal:
        p = data['personal']
        cols = st.columns(3)
        for col, label, field in zip(cols, ['내 담당 미처리', '할당 후 3일 이상', '기간 내 내 종결'], ['pending', 'aged', 'closed']):
            col.metric(label, p[field])
        st.subheader('먼저 확인할 업무')
        table(data['priority'])
        st.subheader('최근 내 활동')
        table(data['activities'])
    with institution:
        p, det = data['institution'], data['detection']
        cols = st.columns(5)
        rate = f"{det['suspicious'] / det['received']:.1%}" if det['received'] and not data.get('pendingReports') else '—'
        cols[0].metric('오늘 탐지 의심 거래', det['suspicious'], f'전체 수신 거래 대비 {rate}', delta_color='off')
        change = f"{(p['today'] - p['yesterday']) / p['yesterday']:+.1%}" if p['yesterday'] else '전일 기준 없음'
        cols[1].metric('오늘 유입 Alert', p['today'], change, delta_color='off')
        for col, label, field in zip(cols[2:], ['미처리 Alert', '미처리 Episode', '할당 후 3일 이상'], ['alerts', 'episodes', 'aged']):
            col.metric(label, p[field])
        st.caption(f"거래 기준일 {data['deliveryDate']} · 수신·통합 {det['received']:,}건 / 모델 결과 {det['analyzed']:,}건")
        if det['analyzed'] < det['received']:
            st.info('분석 진행 중입니다. 탐지 건수·비율은 아직 최종 결과가 아닙니다.')
        if data.get('pendingReports'):
            st.info('검수·통합이 끝나지 않은 수신 보고가 있어 전체 거래 수와 최종 탐지율을 아직 확정할 수 없습니다.')
        st.subheader('기관 탐지 현황')
        if data['daily']:
            st.line_chart(pd.DataFrame(data['daily']), x='day', y=['incoming', 'completed'])
        cols = st.columns(2)
        with cols[0]:
            st.subheader('모델 판정 조합 분포')
            counts = {r['agreement']: r['count'] for r in data['agreements']}
            frame = pd.DataFrame([{'유형': k, '건수': counts.get(k, 0)} for k in ['STRONG', 'ATYPICAL', 'PATTERN_ONLY', 'WEAK']])
            total = frame['건수'].sum()
            frame['비율'] = frame['건수'] / total if total else 0
            st.altair_chart(alt.Chart(frame).mark_arc(innerRadius=65).encode(theta='건수:Q', color='유형:N', tooltip=['유형', '건수', alt.Tooltip('비율:Q', format='.1%')]), width='stretch')
            table(frame.to_dict('records'))
        with cols[1]:
            st.subheader('의심 거래 탐지 유형별 분포')
            chart_map({TYPE_NAMES[r['type']]: r['count'] for r in data['types']}, '거래 수')


def main():
    st.set_page_config(page_title='AML RADAR', layout='wide')
    base = os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080')
    try:
        client = ApiClient(base)
        users = client.get('demo/users')
        clock = client.get('demo/clock')
        today = datetime.fromisoformat(clock['businessAt']).astimezone(KST).date()
        if 'review_user' not in st.session_state:
            st.title('AML RADAR')
            st.caption('시연 직원 선택 · 정식 로그인은 후속 구현입니다.')
            cols = st.columns(2)
            for col, role in zip(cols, ['L1', 'L2']):
                if col.button(role + (' · Alert 검토' if role == 'L1' else ' · Episode 조사'), width='stretch'):
                    st.session_state['review_user'] = next(u for u in users if u['role'] == role)
                    st.rerun()
            return
        user = st.session_state['review_user']
        client.headers['X-Demo-User-Id'] = str(user['id'])
        with st.sidebar:
            st.title('AML RADAR')
            st.write(user['name'], user['role'])
            # Demo seed has multiple staff per role. Switching is explicit and local-only.
            same_role = [u for u in users if u['role'] == user['role']]
            selected = st.selectbox('시연 담당자', same_role, index=next(i for i,u in enumerate(same_role) if u['id']==user['id']), format_func=lambda u:u['name'])
            if selected['id'] != user['id']:
                st.session_state['review_user'] = selected
                st.rerun()
            st.caption('업무 시각 ' + display(clock['businessAt']))
            page = st.radio('화면', ['대시보드', 'Transactions', 'Alerts', 'Episodes', '분석 작업'])
            if st.button('직원 선택으로 돌아가기'):
                del st.session_state['review_user']
                st.rerun()
            st.button('새로고침')
        if st.session_state.get('last_action'):
            st.success(st.session_state.pop('last_action'))
        if page == '대시보드': dashboard_page(client, user, today)
        elif page == 'Transactions': ledger_page(client, today)
        elif page in ('Alerts', 'Episodes'): cases_page(client, user, today, 'ALERT' if page == 'Alerts' else 'EPISODE')
        else:
            rows = paged(client, 'batch-jobs', {'type': 'ANALYSIS'}, 'jobs')
            table(rows)
            st.caption('더미 모델 결과는 탐지 성능 평가용이 아닙니다.')
    except ApiError as error:
        st.error(str(error))


if __name__ == '__main__':
    main()
