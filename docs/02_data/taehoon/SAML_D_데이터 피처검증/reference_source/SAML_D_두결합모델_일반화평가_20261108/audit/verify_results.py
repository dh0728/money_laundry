"""Independent artifact, prediction coverage, operating point and pattern audit."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from experiment import *
import csv
from html.parser import HTMLParser

def main():
    check_frozen();result=read_json(OUT/'results.json')['results'];y=np.asarray(labels())>0
    order=np.load(OUT/'day_order.npy',mmap_mode='r');assert len(np.unique(order))==N and order.min()==0 and order.max()==N-1
    salt=scores('A3');cursor=0;chunks=0;plan_sha=sha(OUT/'plan.json')
    for path in sorted((OUT/'scores/A3/commits').glob('*.json')):
        d=read_json(path);assert d['start']==cursor and d['plan_sha256']==plan_sha
        block=np.asarray(salt[order[d['start']:d['stop']]])
        assert hashlib.sha256(block.tobytes()).hexdigest()==d['sha256'];cursor=d['stop'];chunks+=1
    assert cursor==N
    records=[]
    for name,r in result.items():
        z=scores(name)
        for point in ('primary','hi_validation_threshold'):
            if point not in r:continue
            saved=r[point];p=z>=saved['threshold_logit']
            actual=[int(np.count_nonzero(mask)) for mask in (y&p,~y&p,y&~p,~y&~p)]
            assert actual==[saved[k] for k in ('TP','FP','FN','TN')]
            records.append(dict(model=name,point=point,all_counts_verified=True))
    pattern=read_json(OUT/'patterns.json')['rows']
    for name in ('Multi_FraudGT_HGB','A3_HGB'):
        for point in ('primary','hi_validation_threshold'):
            rows=[r for r in pattern if r['model']==name and r['operating_point']==point]
            assert sum(r['rows'] for r in rows)==N and sum(r['positive'] for r in rows)==POS
            for key in ('TP','FP','FN'):assert sum(r[key] for r in rows)==result[name][point][key]
    class Parser(HTMLParser):
        def __init__(self):super().__init__();self.links=[];self.tables=0
        def handle_starttag(self,tag,attrs):
            if tag=='table':self.tables+=1
            if tag=='a':self.links.append(dict(attrs)['href'])
    page=OUT/'SAML_D_두결합모델_일반화_결과.html';parser=Parser();parser.feed(page.read_text())
    assert parser.tables==5 and all((OUT/name).is_file() for name in parser.links)
    assert read_json(OUT/'input_cache_verification.json')['passed']
    check_frozen()
    audit=dict(passed=True,utc=utc(),salt_prediction_chunks=chunks,salt_coverage=N,all_committed_score_hashes_verified=True,
        all_operating_point_counts_verified=records,all_pattern_totals_verified=True,html_tables=parser.tables,all_report_links_exist=True,
        source_models_unchanged=True,salt_training_still_paused=True,report_sha256=sha(page),script_sha256=sha(Path(__file__)))
    write(OUT/'independent_verification.json',audit);print(json.dumps(audit,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
