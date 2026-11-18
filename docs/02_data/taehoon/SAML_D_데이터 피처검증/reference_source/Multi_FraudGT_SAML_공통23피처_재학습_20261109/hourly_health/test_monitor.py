"""Regression cases for false leak alarms, LR boundaries, slowdown and stalls."""
import copy,importlib.util,math,time,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('health_monitor',Path(__file__).with_name('monitor.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class HealthTests(unittest.TestCase):
    def setUp(self):
        self.now=1_800_000_000.;self.worker=dict(pid=123,start_ticks=456,command='train.py',RssAnon_bytes=m.GIB)
        self.sample=dict(time=self.now,utc=m.utc(self.now),state='running',stage='train',phase='train',epoch=40,
            training_process=self.worker,nonfinite_loss=False,progress_age_seconds=1,cgroup={'memory.events':{'oom':0,'oom_kill':0}})
        self.cp=dict(status='checked',schedule_matches=True,tensors_finite=True,plan_matches=True,manifest_matches=True)
        self.policy=dict(stale_progress_seconds=600,cpu_growth_bytes=512*1024**2,cpu_growth_fraction=.25,
            gpu_growth_bytes=256*1024**2,gpu_growth_fraction=.05)
        self.history=[dict(train_seconds=200,validation_seconds=110 if i%4==0 else 0,resumed_partial_epoch=False) for i in range(40)]
    def evaluate(self,samples=None,events=None):
        return m.assess(self.sample,samples or [],self.history,self.cp,events or [],
            {'sample':{'cgroup':{'memory.events':{'oom':0,'oom_kill':0}}}},self.policy)
    def cpu_samples(self,growing=False):
        result=[]
        for i in range(60):
            s=copy.deepcopy(self.sample);s['time']=self.now-3540+60*i
            s['training_process']['RssAnon_bytes']=m.GIB+(i*30*1024**2 if growing else (i%2)*10*1024**2)
            s['training_process']['RssFile_bytes']=(10+i/2)*m.GIB
            result.append(s)
        return result
    def gpu_events(self,growing=False):
        return [dict(utc=m.utc(self.now-3540+i*60),event='training_progress',pid=123,
            gpu_allocated_bytes=10*m.GIB+(i*50*1024**2 if growing else 0),gpu_reserved_bytes=(12+i/4)*m.GIB) for i in range(60)]
    def test_cache_and_reservation_growth_are_not_leaks(self):
        r=self.evaluate(self.cpu_samples(),self.gpu_events());self.assertEqual(r['state'],'ok');self.assertFalse(r['issues'])
    def test_sustained_cpu_and_gpu_growth(self):
        r=self.evaluate(self.cpu_samples(True),self.gpu_events(True));codes={v['code'] for v in r['issues']}
        self.assertIn('cpu_memory_growth',codes);self.assertIn('gpu_memory_growth',codes)
    def test_distinct_process_and_validation_excluded(self):
        samples=self.cpu_samples(True)
        for s in samples:s['phase']='validation'
        r=self.evaluate(samples,self.gpu_events());self.assertEqual(r['cpu_anonymous_growth']['status'],'collecting')
        for s in samples:s['phase']='train';s['training_process']['start_ticks']=999
        self.assertFalse(self.evaluate(samples)['cpu_anonymous_growth']['suspected'])
    def test_lr_mismatch_oom_and_nonfinite(self):
        self.cp['schedule_matches']=False;self.sample['cgroup']['memory.events']['oom_kill']=1;self.sample['nonfinite_loss']=True
        r=self.evaluate();self.assertEqual(r['state'],'critical')
        self.assertTrue({'learning_rate_mismatch','new_oom','nonfinite_loss'}<={i['code'] for i in r['issues']})
    def test_slowdown_and_stall(self):
        for h in self.history[-10:]:h['train_seconds']=280
        self.sample['progress_age_seconds']=601
        codes={v['code'] for v in self.evaluate()['issues']}
        self.assertIn('slow_train',codes);self.assertIn('stale_progress',codes)
    def test_short_warmup_not_leak(self):
        self.assertFalse(m.growth([(i*60,i*m.GIB) for i in range(8)],1,.1)['suspected'])
    def test_native_lr_schedule(self):
        p=dict(warmup_epochs=5,epochs=500,base_lr=.001)
        self.assertEqual(m.expected_lr(p,1),1e-9);self.assertEqual(m.expected_lr(p,6),.001)
        self.assertAlmostEqual(m.expected_lr(p,41),.001*.5*(1+math.cos(math.pi*35/495)))
        self.assertNotEqual(m.expected_lr(p,284),m.expected_lr({**p,'epochs':284},284))

if __name__=='__main__':unittest.main()
