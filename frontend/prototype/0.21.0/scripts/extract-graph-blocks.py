"""팀원 자료(세탁거래_그래프_시각화.html, IBM HI-Small)에서 패턴별 대표 블록 1개씩 뽑아
v15 프로토타입용 graph-blocks.json을 만든다.

- 원본 노드·엣지(1홉)는 그대로 옮긴다. 금액은 통화별 고정 환율로 USD 환산값을 함께 둔다.
- 2·3홉 이웃은 원본에 없으므로 결정적 난수로 합성하고 synthetic=true로 표시한다.
- 집계 엣지(n건, 합계 금액, 첫·마지막 시각)는 화면의 건별 거래 목록을 위해 n건으로 나눈다(합성).
- 연도는 프로토타입 기준일(2026-09)에 맞춰 2022 → 2026으로 옮긴다.
"""
import json, random, re, sys
from datetime import datetime, timedelta

SRC = sys.argv[1]
OUT = sys.argv[2]
PICK = {  # 원본 블록 id: 앱에서 쓰는 패턴 코드
    163: 'FAN_OUT', 160: 'FAN_IN', 169: 'CYCLE', 162: 'GATHER-SCATTER', 109: 'SCATTER-GATHER',
    216: 'BIPARTITE', 188: 'STACK', 161: 'RANDOM', 385: 'NON_PATTERN',
}
USD = {'US Dollar': 1, 'Euro': 1.0, 'Saudi Riyal': .266, 'Yuan': .145, 'Swiss Franc': 1.02, 'Rupee': .0125,
       'UK Pound': 1.16, 'Yen': .0070, 'Ruble': .0165, 'Canadian Dollar': .76, 'Australian Dollar': .68,
       'Mexican Peso': .050, 'Shekel': .29, 'Brazil Real': .19, 'Bitcoin': 20000}

html = open(SRC, encoding='utf-8').read()
start = html.index('const DATA = ') + len('const DATA = ')
data = json.loads(html[start:html.index('\n', start)].rstrip().rstrip(';'))
accounts = data[0]
blocks = {b['id']: b for b in accounts['blocks']}

def shift(ts):
    return datetime.strptime(ts, '%Y/%m/%d %H:%M').replace(year=2026)

def fmt(dt):
    return dt.strftime('%Y-%m-%d %H:%M')

out = []
for block_id, code in PICK.items():
    b = blocks[block_id]
    rng = random.Random(block_id)
    nodes = []
    for i, n in enumerate(b['nodes']):
        hop = 0 if n['c'] else 1
        nodes.append({'id': n['a'], 'bank': n['b'], 'entity': n['e'], 'x': n['x'], 'y': n['y'],
                      'core': bool(n['c']), 'bridge': bool(n['g']) and not n['c'], 'hub': bool(n['h']),
                      'hubDegree': n['hd'], 'hop': hop, 'synthetic': False})
    edges = []
    for e in b['edges']:
        edges.append({'s': e['s'], 't': e['t'], 'label': e['l'], 'count': e['n'], 'amount': round(e['amt'], 2),
                      'currency': e['cur'], 'usd': round(e['amt'] * USD[e['cur']], 2), 'format': e['fmt'],
                      'first': fmt(shift(e['ts0'])), 'last': fmt(shift(e['ts1'])), 'bridgePath': bool(e.get('br')),
                      'synthetic': False})

    # 2·3홉 합성: 원본 1홉 이웃에서 바깥쪽으로 확장
    xs = [n['x'] for n in nodes]; ys = [n['y'] for n in nodes]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    span = max(max(xs) - min(xs), max(ys) - min(ys), .5)
    l0 = [e for e in edges if e['label'] == 0 and e['s'] != e['t']] or edges
    t_min = min(datetime.strptime(e['first'], '%Y-%m-%d %H:%M') for e in edges)
    t_max = max(datetime.strptime(e['last'], '%Y-%m-%d %H:%M') for e in edges)
    kinds = ['Partnership', 'Sole Proprietorship', 'Corporation', 'Individual']
    banks = sorted({n['bank'] for n in nodes})

    def add_neighbor(parent_index, hop):
        p = nodes[parent_index]
        dx, dy = p['x'] - cx, p['y'] - cy
        length = (dx * dx + dy * dy) ** .5 or 1
        angle = rng.uniform(-.55, .55)
        ux = dx / length; uy = dy / length
        rx = ux * __import__('math').cos(angle) - uy * __import__('math').sin(angle)
        ry = ux * __import__('math').sin(angle) + uy * __import__('math').cos(angle)
        dist = span * rng.uniform(.13, .2)
        node = {'id': '8' + ''.join(rng.choice('0123456789ABCDEF') for _ in range(7)) + '0',
                'bank': rng.choice(banks + [f'{rng.randint(10, 250):03d}']),
                'entity': f"{rng.choice(kinds)} #{rng.randint(100, 99999)}",
                'x': round(p['x'] + rx * dist, 4), 'y': round(p['y'] + ry * dist, 4), 'core': False, 'bridge': False,
                'hub': False, 'hubDegree': 0, 'hop': hop, 'synthetic': True}
        nodes.append(node)
        sample = rng.choice(l0)
        first = t_min + (t_max - t_min) * rng.random()
        last = min(t_max, first + timedelta(hours=rng.randint(2, 120)))
        count = rng.choice([1, 1, 2, 2, 3, 4, 6])
        usd = round(sample['usd'] * rng.uniform(.2, 1.4), 2)
        outward = rng.random() < .5
        edges.append({'s': parent_index if outward else len(nodes) - 1, 't': len(nodes) - 1 if outward else parent_index,
                      'label': 0, 'count': count, 'amount': usd, 'currency': 'US Dollar', 'usd': usd,
                      'format': sample['format'], 'first': fmt(first), 'last': fmt(last), 'bridgePath': False,
                      'synthetic': True})
        return len(nodes) - 1

    # hop1~3은 기존 순서·확률 그대로(시드 고정이라 draw 순서가 같으면 결과도 같다);
    # hop3 결과를 리스트로 남겨 hop4·hop5를 그 뒤에 이어붙인다.
    hop1 = [i for i, n in enumerate(nodes) if n['hop'] == 1 and not n['hub']]
    hop2 = []
    for i in hop1:
        if rng.random() < .45:
            hop2 += [add_neighbor(i, 2) for _ in range(rng.choice([1, 1, 2]))]
    hop3 = []
    for i in hop2:
        if rng.random() < .45:
            hop3.append(add_neighbor(i, 3))
    hop4 = []
    for i in hop3:
        if rng.random() < .45:
            hop4.append(add_neighbor(i, 4))
    for i in hop4:
        if rng.random() < .4:
            add_neighbor(i, 5)

    # 집계 엣지를 건별 거래로 분해(합성)
    for k, e in enumerate(edges):
        first = datetime.strptime(e['first'], '%Y-%m-%d %H:%M'); last = datetime.strptime(e['last'], '%Y-%m-%d %H:%M')
        weights = [rng.uniform(.4, 1.6) for _ in range(e['count'])]
        total = sum(weights)
        steps = sorted([0, 1] + [rng.random() for _ in range(max(0, e['count'] - 2))])[:e['count']]
        e['id'] = f"E{block_id}-{k + 1}"
        e['transactions'] = [{'id': f"TX-{block_id}-{k + 1}-{j + 1}",
                              'at': fmt(first + (last - first) * (steps[j] if e['count'] > 1 else 0)),
                              'usd': round(e['usd'] * w / total, 2), 'amount': round(e['amount'] * w / total, 2)}
                             for j, w in enumerate(weights)]

    out.append({'sourceBlock': block_id, 'pattern': code, 'sourcePattern': b['p'], 'laundering': b['n_l1'],
                'coreAccounts': b['n_core'], 'neighborAccounts': b['n_nbr'], 'bridge': b['bridge'],
                'nodes': nodes, 'edges': edges})

meta = {'source': '세탁거래_그래프_시각화.html · IBM AML HI-Small · 계좌 단위', 'stats': accounts['stats'],
        'hubs': accounts['n_hubs'], 'hubMaxDegree': accounts['hub_max_deg'], 'single': accounts['single'],
        'usdRates': USD}
json.dump({'meta': meta, 'blocks': out}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('blocks', len(out), 'nodes', sum(len(b['nodes']) for b in out), 'edges', sum(len(b['edges']) for b in out))
