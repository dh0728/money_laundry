"""Normalized transaction history -> versioned graph and HGB feature tables.

This is a batch integration reference. GNN nodes use context_end; HGB nodes and
flows use each target day's close. Those two cutoffs must not be conflated.
"""
from pathlib import Path
import json
import duckdb
import numpy as np
import pandas as pd
from tqdm.auto import tqdm

from .base_features import prepare_snapshot, amount
from .node_features import build_nodes
from .schema import ROOT, SCHEMA, NODE_FEATURES, NUMERIC_FEATURES, FORMAT_NAMES, HGB_FEATURES
from .io import sql_string as q, sha256, write_json


def verify_assets():
    manifest = json.loads((ROOT/'assets/provenance.json').read_text())
    for record in manifest['frozen_files']:
        if sha256(ROOT/record['file']) != record['sha256']:
            raise ValueError('Frozen model/calibration mismatch: '+record['file'])


def select_gnn_edges(frame):
    """Named selection prevents interpreting a legacy 17-vector as current data."""
    missing = set(NUMERIC_FEATURES + ['payment_format']) - set(frame.columns)
    if missing:
        raise ValueError('Missing named features: '+str(sorted(missing)))
    numeric = frame[NUMERIC_FEATURES].to_numpy(dtype=np.float32)
    codes = frame.payment_format.map({v: i for i, v in enumerate(FORMAT_NAMES)}).fillna(7).to_numpy(int)
    values = np.column_stack([numeric, np.eye(8, dtype=np.float32)[codes]])
    if not np.isfinite(values).all():
        raise ValueError('Nonfinite GNN features')
    return values


def build_ports(c):
    """Zero-based peer rank by first (minute, edge_id), independently per direction."""
    for role, owner, peer in [('incoming', 'dst', 'src'), ('outgoing', 'src', 'dst')]:
        c.execute(f'''CREATE TABLE {role}_ports AS WITH firsts AS (
          SELECT {owner} owner_id,{peer} peer_id,
            min(struct_pack(ts := ts, edge_id := edge_id)) first_seen
          FROM tx GROUP BY {owner},{peer}), ranks AS (
          SELECT owner_id,peer_id,row_number() OVER(PARTITION BY owner_id ORDER BY first_seen)-1 port
          FROM firsts)
          SELECT t.edge_id,r.port::FLOAT port FROM tx t JOIN ranks r
          ON t.{owner}=r.owner_id AND t.{peer}=r.peer_id''')
    c.execute('''CREATE TABLE ports AS SELECT i.edge_id,i.port incoming_port,o.port outgoing_port
      FROM incoming_ports i JOIN outgoing_ports o USING(edge_id)''')


def endpoint_history(c, targets, day):
    """Float64 amount equality matches the frozen HGB training cache."""
    c.register('endpoint_targets', targets)
    return c.execute(f'''WITH today AS (
        SELECT role,node,ccy,count(*) n FROM account_events WHERE day=DATE {q(day)}
        GROUP BY role,node,ccy), prior AS (
        SELECT role,node,ccy,count(*) n,sum(amount) total,min(day) first_day
        FROM account_events WHERE day<DATE {q(day)} GROUP BY role,node,ccy),
      seen AS (SELECT DISTINCT role,node,ccy,amount FROM account_events WHERE day<DATE {q(day)}),
      flow AS (SELECT node,ccy,
        coalesce(sum(amount) FILTER(WHERE role=1),0) si,
        coalesce(sum(amount) FILTER(WHERE role=0),0) so
        FROM account_events WHERE day=DATE {q(day)} GROUP BY node,ccy),
      matches AS (SELECT node,ccy,amount,count(*) n FROM account_events
        WHERE day=DATE {q(day)} AND role=1 GROUP BY node,ccy,amount)
      SELECT t.edge_id,t.role,t.amount,coalesce(a.n,0) today_n,coalesce(p.n,0) prior_n,
        coalesce(p.total,0) prior_total,
        greatest(coalesce(date_diff('day',p.first_day,DATE {q(day)}),1),1) span,
        (s.node IS NOT NULL)::INTEGER seen,coalesce(f.si,0) si,coalesce(f.so,0) so,
        coalesce(m.n,0) matches
      FROM endpoint_targets t LEFT JOIN today a USING(role,node,ccy)
      LEFT JOIN prior p USING(role,node,ccy) LEFT JOIN seen s USING(role,node,ccy,amount)
      LEFT JOIN flow f USING(node,ccy) LEFT JOIN matches m USING(node,ccy,amount)
      ORDER BY t.edge_id,t.role''').df()


def hgb_day(c, day):
    raw = c.execute(f'''SELECT t.* FROM tx t JOIN targets q USING(edge_id)
      WHERE day=DATE {q(day)} ORDER BY edge_id''').df()
    ids = raw.edge_id.to_numpy(np.int64)
    # Rebuild only account statistics at the day's close, with the same fixed scale.
    c.execute(f'''CREATE OR REPLACE VIEW hist AS SELECT t.*,
      {amount('paid','ps')} paid_currency_z,{amount('received','rs')} received_currency_z,
      ks.entity_id source_entity,kd.entity_id target_entity FROM tx t
      JOIN kyc ks ON ks.node_id=t.src JOIN kyc kd ON kd.node_id=t.dst
      LEFT JOIN stats ps ON ps.currency=t.payment_currency
      LEFT JOIN stats rs ON rs.currency=t.receiving_currency WHERE t.day<=DATE {q(day)}''')
    nodes = build_nodes(c).set_index('node_id')
    edges = c.execute(f'''SELECT e.* FROM edge_features e JOIN tx t USING(edge_id)
      JOIN targets q USING(edge_id) WHERE day=DATE {q(day)} ORDER BY edge_id''').df()
    np.testing.assert_array_equal(edges.edge_id, ids)
    values = {name: edges[name].to_numpy(np.float32) for name in NUMERIC_FEATURES}
    for role, col in [('src','src'),('dst','dst')]:
        nx = nodes.loc[raw[col], NODE_FEATURES]
        values.update({role+'_'+n: nx[n].to_numpy(np.float32) for n in NODE_FEATURES})
    minute = c.execute(f'''WITH s AS (SELECT src,ts,count(*) FILTER(WHERE src<>dst) n
        FROM tx WHERE day=DATE {q(day)} GROUP BY src,ts),
      d AS (SELECT dst,ts,count(*) FILTER(WHERE src<>dst) n
        FROM tx WHERE day=DATE {q(day)} GROUP BY dst,ts)
      SELECT t.edge_id,s.n sn,d.n dn FROM tx t JOIN targets q USING(edge_id)
      JOIN s USING(src,ts) JOIN d USING(dst,ts) WHERE day=DATE {q(day)} ORDER BY edge_id''').df()
    values['minute_sender_vs_prior_hour'] = np.log1p(60*minute.sn.to_numpy(float))-values['sender_count_1h']
    values['minute_receiver_vs_prior_hour'] = np.log1p(60*minute.dn.to_numpy(float))-values['receiver_count_1h']
    targets = pd.concat([pd.DataFrame(dict(edge_id=ids,role=role,
      node=raw[node].to_numpy(),ccy=raw[ccy].to_numpy(),amount=raw[amt].to_numpy(float)))
      for role,node,ccy,amt in [(0,'src','payment_currency','paid'),(1,'dst','receiving_currency','received')]],ignore_index=True)
    endpoints = endpoint_history(c, targets, day)
    for role, name in [(0,'src'),(1,'dst')]:
        a = endpoints[endpoints.role==role]
        np.testing.assert_array_equal(a.edge_id, ids)
        v = lambda key: a[key].to_numpy(float)
        maximum = np.maximum(v('si'),v('so'))
        values[name+'_day_ccy_flow_balance'] = np.divide(np.minimum(v('si'),v('so')),maximum,out=np.zeros(len(a)),where=maximum>0)
        values[name+'_day_ccy_log_matching_in_amount'] = np.log1p(v('matches'))
        values[name+'_prior_ccy_amount_seen'] = v('seen')
        mean = np.divide(v('prior_total'),v('prior_n'),out=np.zeros(len(a)),where=v('prior_n')>0)
        values[name+'_prior_ccy_amount_vs_mean'] = np.log1p(np.divide(v('amount'),mean,out=np.zeros(len(a)),where=mean>0))
        values[name+'_day_ccy_rate_vs_prior'] = np.log1p(v('today_n'))-np.log1p(v('prior_n')/v('span'))
    seen = c.execute(f'''SELECT t.edge_id,EXISTS(SELECT 1 FROM tx h WHERE
      h.day<t.day AND h.src=t.src AND h.dst=t.dst AND h.payment_currency=t.payment_currency
      AND h.paid::DOUBLE=t.paid::DOUBLE)::INTEGER AS value FROM tx t JOIN targets q USING(edge_id)
      WHERE day=DATE {q(day)} ORDER BY edge_id''').df()
    values['pair_amount_seen_before_day'] = seen.value.to_numpy()
    out = pd.DataFrame({n: np.asarray(values[n],np.float32) for n in HGB_FEATURES})
    if not np.isfinite(out.to_numpy()).all():
        raise ValueError('Nonfinite HGB features')
    out.insert(0,'edge_id',ids)
    return out


def prepare(settings, progress=True):
    verify_assets()
    root = prepare_snapshot(settings)
    c = duckdb.connect(str(root/'work.duckdb'))
    try:
        c.execute(f"SET threads={int(settings.get('threads',2))}")
        c.execute(f"SET memory_limit={q(settings.get('memory_limit','2GB'))}")
        build_ports(c)
        c.execute('''CREATE TABLE account_events AS
          SELECT edge_id,day,0 AS role,src AS node,payment_currency AS ccy,paid::DOUBLE AS amount FROM tx
          UNION ALL SELECT edge_id,day,1,dst,receiving_currency,received::DOUBLE FROM tx''')
        c.execute(f"COPY (SELECT * FROM ports ORDER BY edge_id) TO {q(root/'ports.parquet')} (FORMAT PARQUET)")
        hgb_dir = root/'hgb'; hgb_dir.mkdir()
        days = [str(x[0]) for x in c.execute('SELECT DISTINCT day FROM tx JOIN targets USING(edge_id) ORDER BY day').fetchall()]
        rows = 0
        for day in tqdm(days,desc='HGB 일별 피처',disable=not progress):
            frame = hgb_day(c,day)
            frame.to_parquet(hgb_dir/(day+'.parquet'),index=False)
            rows += len(frame)
        manifest = json.loads((root/'manifest.json').read_text())
        manifest.update(schema_version=SCHEMA['schema_version'],hgb_rows=rows,
          gnn_node_cutoff=settings['context_end'],hgb_node_cutoff='each target day inclusive',
          hgb_history_cutoff='strictly before each target day',
          schema_sha256=sha256(ROOT/'assets/schema.json'),
          status='complete_integration_reference',
          production_validation='actual backend and full historical population parity not run')
        write_json(root/'complete.json',manifest)
    finally:
        c.close()
    return root
