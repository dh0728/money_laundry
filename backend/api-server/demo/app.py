"""Streamlit reads existing backend results; never reads the database directly."""
import json
import os

import pandas as pd
import streamlit as st

from api_client import ApiClient, ApiError, model_label


def table(rows, fields=None):
    if not rows:
        st.info('표시할 데이터가 없습니다.')
        return
    selected = [{k: r.get(k) for k in fields} for r in rows] if fields else rows
    st.dataframe(pd.json_normalize(selected), hide_index=True, width='stretch')


def page_view(client, path, params, key, fields):
    page = int(st.number_input('페이지 (0부터)', min_value=0, step=1, key=key))
    data = client.get(path, dict(params, page=page, size=20), page=True)
    st.caption(f"전체 {data['totalElements']}건 · {data['totalPages']}페이지 · 현재 {data['page'] + 1}번째 조회")
    table(data['content'], fields)
    return data['content']


def graph_view(graph):
    nodes, edges = graph.get('nodes', []), graph.get('edges', [])
    st.caption(f'계좌 {len(nodes)}개 · 거래 {len(edges)}건. 계좌 표시는 서비스 식별자입니다.')
    if len(nodes) > 150 or len(edges) > 300:
        st.info('큰 그래프는 표로 표시합니다. 전체 거래는 아래 구성 거래 표에서 확인하세요.')
        return
    quote = lambda value: json.dumps(str(value), ensure_ascii=False)
    dot = ['digraph G { rankdir=LR; node [shape=box];']
    for node in nodes:
        dot.append(f'{quote(node["id"])} [label={quote(str(node.get("bankId", "")) + ":" + str(node["id"]))}];')
    for edge in edges:
        dot.append(f'{quote(edge["from"])} -> {quote(edge["to"])} [label={quote(edge.get("txId", edge.get("id", "")))}];')
    st.graphviz_chart('\n'.join(dot + ['}']))


def main():
    st.set_page_config(page_title='AML 시연', layout='wide')
    st.title('거래 분석 · Alert 시연')
    st.caption('백엔드가 공개한 결과를 조회합니다. 사건 판정·거래 이동 기능은 아직 제공하지 않습니다.')
    with st.sidebar:
        base = st.text_input('백엔드 주소', os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080'))
        st.button('새로고침')
        st.caption('조회 전용 화면 · DB 직접 접근 없음')
    headers = {}
    for env, header in [('CF_ACCESS_CLIENT_ID', 'CF-Access-Client-Id'),
                        ('CF_ACCESS_CLIENT_SECRET', 'CF-Access-Client-Secret')]:
        if os.getenv(env):
            headers[header] = os.environ[env]
    try:
        configured_base = os.getenv('AML_DEMO_API_URL', 'http://127.0.0.1:8080')
        if headers and base.rstrip('/') != configured_base.rstrip('/'):
            raise ApiError('접근 인증이 설정되어 있습니다. AML_DEMO_API_URL로 지정한 주소만 조회할 수 있습니다.')
        client = ApiClient(base, headers)
        st.subheader('1. 분석 작업')
        jobs = page_view(client, 'batch-jobs', {'type': 'ANALYSIS'}, 'jobs_' + base,
                         ['jobId', 'analysisDate', 'status', 'currentStage', 'rowCount', 'errorCode'])
        if not jobs:
            st.info('분석 작업이 없습니다. 은행 목업 업로드와 백엔드 분석 실행 후 조회하세요.')
            return
        job_id = st.selectbox('분석 작업 선택', [j['jobId'] for j in jobs], key='job_' + base)
        job = client.get(f'batch-jobs/{job_id}')
        st.warning(model_label(job))
        st.write({'상태': job.get('status'), '단계': job.get('currentStage'),
                  '이진 모델': job.get('modelVersionBinary'), '패턴 모델': job.get('modelVersionType')})
        if job.get('status') != 'COMPLETED':
            st.info('아직 완료되지 않은 작업입니다. 아래에 미완료 결과를 대신 표시하지 않습니다.')
            if job.get('errorCode'):
                st.code(str(job['errorCode']))
            return
        counters = job.get('counters', {})
        cols = st.columns(2)
        cols[0].metric('의심 거래', counters.get('suspiciousTxCount', 0))
        cols[1].metric('Alert', counters.get('alertCount', 0))
        st.subheader('2. 의심 거래')
        page_view(client, 'suspicious-transactions', {'jobId': job_id}, f'tx_{base}_{job_id}',
                  ['txId', 'txAt', 'fromBank', 'toBank', 'amountUsd', 'launderingScore', 'typeName'])
        st.subheader('3. Alert')
        alerts = page_view(client, 'alerts', {'jobId': job_id}, f'alerts_{base}_{job_id}',
                           ['alertId', 'status', 'assigneeId', 'version', 'summary'])
        if not alerts:
            return
        alert_id = st.selectbox('Alert 선택', [a['alertId'] for a in alerts], key=f'alert_{base}_{job_id}')
        versions = client.get(f'alerts/{alert_id}/versions')
        version = st.selectbox('근거 버전', ['최신'] + [v['version'] for v in versions],
                               key=f'version_{base}_{alert_id}')
        params = {} if version == '최신' else {'version': version}
        detail = client.get(f'alerts/{alert_id}', params)
        st.write({'Alert': detail['alertId'], '버전': detail['version'], '상태': detail['status'],
                  '구성 정책': detail.get('policyVersion')})
        st.caption('저장된 정책의 결과입니다. 논의 중인 날짜별 5일 정책 적용을 뜻하지 않습니다.')
        st.write(detail.get('summary', {}))
        if detail.get('limits'):
            st.info('탐색 제한: ' + ', '.join(detail['limits']))
        st.subheader('거래 연결')
        graph_view(detail.get('graph', {}))
        table(detail.get('transactions', []), ['txId', 'occurredAt', 'fromBankId', 'toBankId',
                                              'amountUsd', 'role', 'includedReasons', 'scores'])
    except ApiError as error:
        st.error(str(error))
    except (KeyError, TypeError, ValueError):
        st.error('응답 데이터가 화면 계약과 맞지 않습니다. 백엔드 배포 버전을 확인하세요.')


if __name__ == '__main__':
    main()
