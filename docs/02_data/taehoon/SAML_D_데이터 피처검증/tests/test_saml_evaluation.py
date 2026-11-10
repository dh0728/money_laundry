import sys,unittest,json,tempfile
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from saml_evaluation import pattern_metrics,evaluate_external
from fusion_workflow import sha256

class EvaluationTests(unittest.TestCase):
    def test_pattern_totals_and_strict_zero(self):
        p=pattern_metrics([1,1,0,0],[-1,0,1,-1],['a','a','normal','normal'])
        self.assertEqual(p.TP.sum(),0);self.assertEqual(p.FP.sum(),1)
        self.assertEqual(p.FN.sum(),2);self.assertEqual(p.TN.sum(),1)
        q=pattern_metrics([1,1,0,0],[-1,0,1,-1],['a','a','normal','normal'],True)
        self.assertEqual(q.TP.sum(),1)
    def test_external_alignment_and_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);inp=root/'input';inp.mkdir()
            for name,value in dict(ids=[10,11,12,13],labels=[0,1,0,1],patterns=['normal','a','normal','a'],score_ids=[13,10,12,11],logits=[1.,-1.,-2.,2.]).items():
                np.save(inp/(name+'.npy'),np.array(value))
            meta=dict(scope='saml_all',model='synthetic_only',sha256={p.name:sha256(p) for p in inp.glob('*.npy')})
            (inp/'metadata.json').write_text(json.dumps(meta))
            r,p=evaluate_external(inp,root/'output',expected_rows=4,expected_positive=2)
            self.assertEqual(r['AP'],1.);self.assertEqual(r['TP'],2);self.assertEqual(p.TP.sum(),2)
            np.save(inp/'logits.npy',np.zeros(4))
            with self.assertRaises(ValueError):evaluate_external(inp,root/'new',expected_rows=4,expected_positive=2)

if __name__=='__main__':unittest.main()
