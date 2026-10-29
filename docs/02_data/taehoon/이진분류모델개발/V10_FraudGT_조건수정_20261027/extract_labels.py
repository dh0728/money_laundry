"""Export sparse supervision once; observations and split planning never read it."""
from configure import configure
ROOT,_=configure('preparation')
from pathlib import Path
import json,hashlib
import numpy as np
import duckdb
base=Path('/workspace/kimi/Claude_GNN/final_model')
db=base/'daily_v1/daily.duckdb'
pattern=base/'experiments/drop_exact_v1/pattern_labels.parquet'
c=duckdb.connect(str(db),read_only=True)
c.execute("SET threads=2;SET memory_limit='1GB'")
rows=c.execute(f'''SELECT t.edge_id, CASE WHEN p.edge_id IS NULL THEN 9 ELSE 1 END audit_class
FROM tx t LEFT JOIN (SELECT DISTINCT edge_id FROM read_parquet('{pattern}')) p USING(edge_id)
WHERE t.y>0 AND t.day BETWEEN DATE '2022-08-01' AND DATE '2022-10-31' ORDER BY t.edge_id''').fetchnumpy()
G=ROOT/'project/experiments/v10_goal65_20261024/cache/gnn'
present=np.load(G/'present.npy',mmap_mode='r')
ids=np.asarray(rows['edge_id'],np.int64);classes=np.asarray(rows['audit_class'],np.int8)
assert np.all(ids[1:]>ids[:-1])
assert (ids >= 0).all() and (ids < len(present)).all(), 'Supervision must lie inside the cached date range'
keep=present[ids]!=0
np.save(ROOT/'assets/positive_ids.npy',ids[keep]);np.save(ROOT/'assets/positive_classes.npy',classes[keep])
r={'raw_positive_rows':len(ids),'observed_positive_rows':int(keep.sum()),'dropped_observation_duplicates':int((~keep).sum()),
   'source_database':str(db),'source_stat':[db.stat().st_size,db.stat().st_mtime_ns],
   'pattern_membership_only_for_unmatched_recall':str(pattern),'labels_not_used_to_select_observations_or_split':True}
(ROOT/'assets/labels_source.json').write_text(json.dumps(r,ensure_ascii=False,indent=2));print(json.dumps(r))
