"""Original cumulative node feature formulas, selected into frozen 19-column order."""

import numpy as np
import pandas as pd
from .schema import ENTITY_TYPES, NODE_FEATURES

ALL_FEATURES = (
    [
        "log_out_count",
        "log_in_count",
        "log_out_neighbors",
        "log_in_neighbors",
        "log_self_count",
        "log_reciprocal_neighbors",
        "net_count_ratio",
        "reciprocity_ratio",
        "mean_paid_currency_z",
        "mean_received_currency_z",
        "paid_outlier_fraction",
        "received_outlier_fraction",
        "log_currency_count",
        "log_active_days",
    ]
    + ["type_" + x for x in ENTITY_TYPES]
    + [
        "log_entity_observed_accounts",
        "log_entity_out_diversity",
        "log_entity_in_diversity",
    ]
)


def finite(name, x):
    if not np.isfinite(x).all():
        raise ValueError(name + " contains nonfinite values")
    return x


def build_nodes(c):
    agg = c.execute(
        """WITH outgoing AS (SELECT src AS node_id,count(*) AS out_n,count(DISTINCT dst) AS out_u,
          count(*) FILTER(WHERE src=dst) AS self_n,avg(paid_currency_z) AS out_z,
          avg(CASE WHEN abs(paid_currency_z)>=3 THEN 1.0 ELSE 0 END) AS out_tail FROM hist GROUP BY src),
      incoming AS (SELECT dst AS node_id,count(*) AS in_n,count(DISTINCT src) AS in_u,avg(received_currency_z) AS in_z,
          avg(CASE WHEN abs(received_currency_z)>=3 THEN 1.0 ELSE 0 END) AS in_tail FROM hist GROUP BY dst),
      pairs AS (SELECT DISTINCT src,dst FROM hist WHERE src!=dst),
      reciprocal AS (SELECT a.src AS node_id,count(*) AS reciprocal_n FROM pairs a JOIN pairs b ON a.src=b.dst AND a.dst=b.src GROUP BY a.src),
      currency_set AS (SELECT src AS node_id,payment_currency AS currency FROM hist UNION SELECT dst,receiving_currency FROM hist),
      currencies AS (SELECT node_id,count(*) AS n_currency FROM currency_set GROUP BY node_id),
      active AS (SELECT src AS node_id,day FROM hist UNION SELECT dst,day FROM hist),
      active_days AS (SELECT node_id,count(*) AS n_days FROM active GROUP BY node_id),
      ent_pairs AS (SELECT DISTINCT source_entity,target_entity FROM hist WHERE source_entity IS NOT NULL AND target_entity IS NOT NULL),
      ent_out AS (SELECT source_entity AS entity_id,count(*) AS ent_out_n FROM ent_pairs GROUP BY source_entity),
      ent_in AS (SELECT target_entity AS entity_id,count(*) AS ent_in_n FROM ent_pairs GROUP BY target_entity)
      SELECT k.*,CASE WHEN k.entity_id IS NULL THEN 0 ELSE count(*) OVER(PARTITION BY k.entity_id) END AS observed_entity_accounts,coalesce(o.out_n,0) AS out_n,coalesce(i.in_n,0) AS in_n,coalesce(o.out_u,0) AS out_u,
       coalesce(i.in_u,0) AS in_u,coalesce(o.self_n,0) AS self_n,coalesce(r.reciprocal_n,0) AS reciprocal_n,
       coalesce(o.out_z,0) AS out_z,coalesce(i.in_z,0) AS in_z,coalesce(o.out_tail,0) AS out_tail,
       coalesce(i.in_tail,0) AS in_tail,cu.n_currency,ad.n_days,coalesce(eo.ent_out_n,0) AS ent_out_n,
       coalesce(ei.ent_in_n,0) AS ent_in_n
      FROM active_days ad JOIN kyc k USING(node_id) LEFT JOIN outgoing o USING(node_id)
      LEFT JOIN incoming i USING(node_id) LEFT JOIN reciprocal r USING(node_id)
      JOIN currencies cu USING(node_id) LEFT JOIN ent_out eo ON k.entity_id=eo.entity_id
      LEFT JOIN ent_in ei ON k.entity_id=ei.entity_id ORDER BY node_id"""
    ).fetchdf()
    if agg.empty:
        raise ValueError("No graph history")
    v = lambda name: agg[name].to_numpy(np.float64)
    outn, inn = v("out_n"), v("in_n")
    ou, iu = v("out_u"), v("in_u")
    rec = v("reciprocal_n")
    fields = [
        np.log1p(outn),
        np.log1p(inn),
        np.log1p(ou),
        np.log1p(iu),
        np.log1p(v("self_n")),
        np.log1p(rec),
        (outn - inn) / np.maximum(outn + inn, 1),
        rec / np.maximum(ou + iu, 1),
        v("out_z"),
        v("in_z"),
        v("out_tail"),
        v("in_tail"),
        np.log1p(v("n_currency")),
        np.log1p(v("n_days")),
    ]
    fields += [(agg.entity_type == typ).to_numpy(np.float64) for typ in ENTITY_TYPES]
    fields += [
        np.log1p(v("observed_entity_accounts")),
        np.log1p(v("ent_out_n")),
        np.log1p(v("ent_in_n")),
    ]
    nx = finite("daily node features", np.stack(fields, axis=1).astype(np.float32))
    node_ids = agg.node_id.to_numpy(np.int64)
    out = pd.DataFrame(
        nx[:, [ALL_FEATURES.index(n) for n in NODE_FEATURES]], columns=NODE_FEATURES
    )
    out.insert(0, "node_id", node_ids)
    return out
