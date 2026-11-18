from experiment import *
import torch
from salt_daily.model import DailySALT,model_kwargs
from salt_daily.data import DailyData,tensors,cleanup
from salt_daily.evaluation import score,model_digest

def main():
    check_frozen()
    assert read_json(OUT/'prepare_complete.json')['status']=='pass'
    protocol=read_json(SALT/'protocol.json')
    checkpoint=torch.load(OUT/'A3_best.pt',map_location='cpu',weights_only=False)
    assert checkpoint['epoch']==6 and checkpoint['variant']=='A3'
    assert checkpoint['protocol_sha256']==sha(SALT/'protocol.json')
    assert sha(OUT/'A3_best.pt')==read_json(OUT/'plan.json')['salt_checkpoint_sha256']
    torch.set_num_threads(1);torch.manual_seed(42)
    model=DailySALT('A3',**model_kwargs(protocol,checkpoint['delta'])).eval().cuda()
    model.load_state_dict(checkpoint['model'])
    digest=model_digest(model)
    for scope in ('validation','test'):
        request=read_json(MODEL/f'{scope}_epoch6/request.json')
        assert request['model_sha256']==digest
    log('salt_cuda_setup_started')
    loader=DailyData(device='cuda')
    loader.degrees.directory=OUT/'degree_cache';loader.degrees.directory.mkdir(exist_ok=True)
    # Use the complete production 8192-target block, preserving shared batches.
    validation=population('validation');span=validation.meta['spans'][0]
    loader.set_day(span['day']);take=np.arange(span['start'],span['start']+8192,dtype=np.int64)
    actual=np.empty(len(take),np.float32)
    with torch.inference_mode():
        for part,arrays,_ in loader.microbatches(validation,take,microbatch=4096,max_edges=6000000):
            actual[part-take[0]]=model(*tensors(arrays,'cuda')).cpu().numpy()
    expected=salt_scores('validation')[take]
    np.testing.assert_allclose(actual,expected,rtol=2e-5,atol=2e-4)
    parity=dict(rows=len(take),max_abs_error=float(np.max(np.abs(actual-expected))),
        rtol=2e-5,atol=2e-4,identical_production_batch_context=True,model_sha256=digest)
    write(OUT/'salt_preflight.json',parity);log('salt_production_score_parity_passed',**parity)
    cleanup()
    data=population('fusion_fit')
    values,seconds=score(model,data,loader,'cuda',OUT/'salt_scores','fusion_fit',epoch=6)
    assert len(values)==7315599 and np.isfinite(values).all()
    check_frozen()
    write(OUT/'salt_complete.json',dict(status='complete',utc=utc(),rows=len(values),seconds=seconds,
        checkpoint_sha256=sha(OUT/'A3_best.pt'),score_sha256=sha(OUT/'salt_scores/fusion_fit_epoch6/scores.npy')))
    log('salt_fusion_fit_complete',rows=len(values),seconds=seconds)

if __name__=='__main__':main()
