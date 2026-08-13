# -*- coding: utf-8 -*-
"""HI-medium + LI-medium 합성 데이터셋 구축 (G38용).

설계 (데이터 검증 반영):
  - node_id는 데이터셋 내 전역 ID: node_features는 노드×split 3행 구조이고,
    load_node_features가 split별 node_id 정렬 후 positional indexing 사용
    → 합성 시 hi ID는 유지, li ID는 +N_hi 오프셋만 적용하면 됨
  - node_key(bank/account) 교집합 14,414개(라벨 모순 2,521개)가 있으므로
    그래프 병합 없이 ID 공간을 분리 (오프셋으로 충돌 제거)
  - 엣지: hi 행 → li 행 순 concat (행 순서 보존 — cycle3/passthru/pairagg 캐시가
    행 정렬이라 나중에 단순 concat 가능), is_li 컬럼 추가
  - split은 각 셋의 기존 시간 split 유지 (재분할 금지 — 도메인 섞임 방지)

산출: data/processed/edges_hili_medium.parquet, node_features_hili_medium.parquet
"""
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

DATA = Path("data/processed")


def main():
    t0 = time.time()
    n_hi = int(pd.read_parquet(
        DATA / "node_features_hi_medium.parquet", columns=["node_id"])["node_id"].max()) + 1
    print(f"HI 노드 수: {n_hi:,} → LI 오프셋으로 사용", flush=True)

    # node_features 합성 (li node_id += n_hi)
    parts = []
    for src_name in ("hi", "li"):
        nf = pd.read_parquet(DATA / f"node_features_{src_name}_medium.parquet")
        if src_name == "li":
            nf["node_id"] += n_hi
        parts.append(nf)
    nf = pd.concat(parts, ignore_index=True)
    nf.to_parquet(DATA / "node_features_hili_medium.parquet", index=False)
    print(f"node_features_hili_medium.parquet 저장 ({len(nf):,}행)", flush=True)
    del nf, parts

    # 엣지 합성 (배치 단위, li from/to += n_hi, is_li 부여)
    out_path = DATA / "edges_hili_medium.parquet"
    writer = None
    total = 0
    for src_name in ("hi", "li"):
        is_li = 1 if src_name == "li" else 0
        pf = pq.ParquetFile(DATA / f"edges_{src_name}_medium.parquet")
        for batch in pf.iter_batches(batch_size=2_000_000):
            tbl = batch.to_pandas()
            if is_li:
                tbl["from_id"] += n_hi
                tbl["to_id"] += n_hi
            tbl["is_li"] = np.int8(is_li)
            at = pa.Table.from_pandas(tbl, preserve_index=False)
            if writer is None:
                writer = pq.ParquetWriter(out_path, at.schema)
            writer.write_table(at)
            total += len(tbl)
        print(f"  {src_name} 엣지 반영 완료 (누적 {total:,}행)", flush=True)
    writer.close()
    print(f"edges_hili_medium.parquet 저장 ({total:,}행) | 완료 ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
