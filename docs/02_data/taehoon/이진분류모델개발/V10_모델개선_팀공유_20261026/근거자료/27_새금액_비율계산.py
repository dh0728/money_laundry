"""Descriptive validation-only rates for the new amount novelty hypothesis."""
from lab import *
def main():
    c=connection('3GB');c.execute('SET threads=1');g=CACHE/'gnn';h=CACHE/'amount_history'
    rows=c.execute(f'''SELECT q.audit_class,count(*) n,
        avg((o.first_day>=t.day)::DOUBLE) source_amount_novel,
        avg((i.first_day>=t.day)::DOUBLE) destination_amount_novel,
        avg((p.first_day>=t.day)::DOUBLE) pair_amount_novel
        FROM read_parquet('{g/'raw_days'}/**/*.parquet',hive_partitioning=true) t
        JOIN read_parquet('{CACHE/'control_targets.parquet'}') q ON t.eid=q.edge_id
        JOIN read_parquet('{h/'out_amount_first.parquet'}') o ON t.src=o.node AND t.pc=o.ccy AND t.paid=o.amount
        JOIN read_parquet('{h/'in_amount_first.parquet'}') i ON t.dst=i.node AND t.rc=i.ccy AND t.received=i.amount
        JOIN read_parquet('{h/'pair_amount_first.parquet'}') p ON t.src=p.src AND t.dst=p.dst AND t.pc=p.pc AND t.paid=p.paid
        WHERE t.day BETWEEN DATE '2022-09-26' AND DATE '2022-10-04' AND q.audit_class IN(0,9)
        GROUP BY q.audit_class ORDER BY q.audit_class''').df().to_dict('records')
    write('16_amount_novelty_descriptive.json',dict(rows=rows,window=['2022-09-26','2022-10-04'],scope='Descriptive validation sample only; no historical test labels or model scores.'))
    log('16_amount_novelty_descriptive',rows=rows)
    matched=c.execute(f'''SELECT t.fmt,q.audit_class,count(*) n,avg((o.first_day>=t.day)::DOUBLE) source_amount_novel
        FROM read_parquet('{g/'raw_days'}/**/*.parquet',hive_partitioning=true) t
        JOIN read_parquet('{CACHE/'control_targets.parquet'}') q ON t.eid=q.edge_id
        JOIN read_parquet('{h/'out_amount_first.parquet'}') o ON t.src=o.node AND t.pc=o.ccy AND t.paid=o.amount
        WHERE t.day BETWEEN DATE '2022-09-26' AND DATE '2022-10-04' AND q.audit_class IN(0,9)
        GROUP BY t.fmt,q.audit_class ORDER BY t.fmt,q.audit_class''').df().to_dict('records')
    labels=json.loads((FIX/'categories.json').read_text())['payment_format']
    for r in matched:r['format']=labels[r['fmt']]
    write('16_amount_novelty_matched_formats.json',dict(rows=matched,window=['2022-09-26','2022-10-04'],
        comparison='Same payment format, normal vs unmatched; descriptive validation only.'))
    log('16_amount_novelty_matched_formats',rows=matched);c.close()
if __name__=='__main__':
    try:main()
    except Exception as exc:log('execution_failed',script=Path(__file__).name,error=type(exc).__name__,detail=str(exc));raise
