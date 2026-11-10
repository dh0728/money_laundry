from pathlib import Path
import sys,unittest,tempfile
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from fusion_workflow import *

class FusionTests(unittest.TestCase):
    def test_id_alignment_and_duplicates(self):
        np.testing.assert_array_equal(aligned_scores(np.array([4,2,9]),np.array([9,4,2]),np.array([.9,.4,.2])),[.4,.2,.9])
        with self.assertRaises(ValueError):aligned_scores(np.array([1,2]),np.array([1,1]),np.array([0.,1.]))
        with self.assertRaises(ValueError):aligned_scores(np.array([1,3]),np.array([1,2]),np.array([0.,1.]))
    def test_hgb_correction_once(self):
        p=np.array([[.5,.25,.25]])
        np.testing.assert_allclose(corrected_hgb_logits(p),[np.log(.01)])
    def test_threshold_ties_are_atomic(self):
        y=np.array([1,0,1,0]);z=np.array([3.,2.,2.,-1.])
        selected=best_validation_f1(y,z)
        self.assertEqual(selected['threshold_logit'],2.);self.assertEqual(selected['TP'],2);self.assertEqual(selected['FP'],1)
    def test_overlap_rejected(self):
        with self.assertRaises(ValueError):check_disjoint({'ids':np.array([1,2])},{'ids':np.array([2,3])})
    def test_frozen_workflow_and_tampering(self):
        rng=np.random.default_rng(42)
        def table(start):
            x=rng.normal(size=(80,2));return dict(ids=np.arange(start,start+80),hgb=x[:,0],gnn=x[:,1],y=(x.sum(1)>0).astype('int8'))
        fit,val,test=table(0),table(100),table(200)
        with tempfile.TemporaryDirectory() as d:
            p,f=fit_and_freeze(fit,val,d,20261107)
            self.assertIsNone(p['class_weight']);self.assertIsNone(p['sample_weight'])
            result=evaluate_frozen_test(test,d);self.assertEqual(result['primary']['rows'],80)
            with self.assertRaises(FileExistsError):fit_and_freeze(fit,val,d,20261107)
            write_json(Path(d)/'fusion_parameters.json',{**p,'intercept':99})
            with self.assertRaises(ValueError):evaluate_frozen_test(test,d)

if __name__=='__main__':unittest.main()
