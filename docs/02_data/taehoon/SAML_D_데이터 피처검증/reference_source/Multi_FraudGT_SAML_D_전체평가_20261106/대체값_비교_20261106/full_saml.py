from imputation import *
import sys,time,signal
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0,str(BASE))
import evaluate_saml as e
import torch,pandas as pd
from sklearn.metrics import average_precision_score,roc_auc_score

STOP=False
def stop(signum,frame):
    global STOP
    STOP=True

def setup():
    plan=check_frozen();selection=json.loads((ROOT/'selection.json').read_text())
    assert selection['plan_sha256']==sha(ROOT/'plan.json') and selection['saml_labels_used'] is False
    old=json.loads((BASE/'protocol.json').read_text())
    for name,h in old['source'].items():assert sha(BASE/name)==h,name
    cache=json.loads((BASE/'cache/complete.json').read_text())
    for name,info in cache['inputs'].items():
        st=Path(name).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),name
    for name,info in cache['generated'].items():
        st=(BASE/'cache'/name).stat();assert (st.st_size,st.st_mtime_ns)==(info['size'],info['mtime_ns']),name
    method=selection['selected_method'];node=np.load(BASE/'cache/nodes19.npy',mmap_mode='r')
    assert not node[:,10:19].any()
    new=owners(node,method)
    assert new.shape==(len(node),3) and np.isfinite(new).all()
    path=ROOT/'imputed_owner_values.npy'
    if path.exists():np.testing.assert_array_equal(np.load(path,mmap_mode='r'),new)
    else:np.save(path,new)
    protocol=dict(plan_sha256=sha(ROOT/'plan.json'),selection_sha256=sha(ROOT/'selection.json'),
        selected_method=method,imputed_owner_sha256=sha(path),original_saml_protocol_sha256=sha(BASE/'protocol.json'),
        rows=N,threshold=.5,checkpoint_sha256=WEIGHT_SHA,graph_and_order='Same as original complete SAML evaluation',
        original_target_metrics_preserved=True,target_labels_used_for_selection=False,
        target_status='Post-hoc diagnostic re-evaluation of already inspected external Test',source_sha256=plan['source_sha256'])
    if (ROOT/'target_protocol.json').exists():assert json.loads((ROOT/'target_protocol.json').read_text())==protocol
    else:write('target_protocol.json',protocol)
    event('saml_start',selected_method=method,rows=N)
    return method,new

def preflight(model,config,graph,adapter,new):
    path=ROOT/'target_preflight.json'
    if path.exists():
        assert json.loads(path.read_text())['protocol_sha256']==sha(ROOT/'target_protocol.json')
        return
    order=np.load(BASE/'cache/order.npy',mmap_mode='r');old=np.load(BASE/'cache/logits.npy',mmap_mode='r')
    new_gpu=torch.tensor(new,device='cuda');reference=e.SamlAdapter();checks=[]
    with torch.inference_mode():
        for index in [0,1,(N//2048)//2,N//2048]:
            ids=order[index*2048:min((index+1)*2048,N)]
            sampled=e.sample_next(iter(graph.loader(ids,batch_size=2048)),config,'test',0,index)
            rows,batch,stats=adapter.materialize(graph,sampled,ids);assert np.array_equal(rows,np.arange(len(ids)))
            baseline,selected=model(batch);old_scores=np.asarray(old[ids])
            np.testing.assert_allclose(baseline.cpu().numpy(),old_scores,rtol=1e-5,atol=1e-5)
            untouched={k:v for k,v in vars(batch).items() if k!='node_features'}
            nodes=sampled['node'].n_id.to('cuda');batch.node_features=batch.node_features.clone()
            batch.node_features[:,16:19]=new_gpu[nodes]
            rr,ref,_=reference.materialize(graph,sampled,ids);assert np.array_equal(rows,rr)
            ref.node_features[:,16:19]=torch.from_numpy(new[sampled['node'].n_id.numpy()])
            for k,v in vars(batch).items():torch.testing.assert_close(v.cpu(),getattr(ref,k),rtol=0,atol=0)
            for k,v in untouched.items():assert torch.equal(v,getattr(batch,k))
            predicted,selected=model(batch);assert torch.equal(selected,torch.arange(len(ids),device='cuda')) and torch.isfinite(predicted).all()
            ref_z,_=model(ref.to('cuda'));torch.testing.assert_close(predicted,ref_z,rtol=1e-5,atol=1e-5)
            checks.append(dict(global_batch=index,rows=len(ids),baseline_max_error=float(np.max(np.abs(baseline.cpu().numpy()-old_scores))),
                changed_inputs_bitwise_match_CPU=True,only_owner_fields_changed=True,all_targets_coverage=1.))
            del batch,ref,sampled,baseline,predicted,ref_z;trim()
    write('target_preflight.json',dict(passed=True,protocol_sha256=sha(ROOT/'target_protocol.json'),checks=checks))
    event('saml_preflight_passed',checked_batches=len(checks))

def run():
    method,new=setup();protocol_sha=sha(ROOT/'target_protocol.json');chunks=ROOT/'target_chunks';chunks.mkdir(exist_ok=True)
    model,config,graph,adapter=e.load();preflight(model,config,graph,adapter,new)
    adapter.node[:,16:19].copy_(torch.from_numpy(new).to('cuda'))
    order=np.load(BASE/'cache/order.npy',mmap_mode='r');step=32*2048
    already=0
    for file in chunks.glob('*.json'):
        info=json.loads(file.read_text());assert info['protocol_sha256']==protocol_sha and sha(file.with_suffix('.npz'))==info['sha256']
        already+=info['rows']
    completed=already;started=time.monotonic()
    with torch.inference_mode(),ThreadPoolExecutor(max_workers=1) as pool:
        for start in range(0,N,step):
            marker=chunks/f'{start:08d}.json'
            if marker.exists():continue
            end=min(start+step,N);ids=order[start:end];count=(len(ids)+2047)//2048
            iterator=iter(graph.loader(ids,batch_size=2048));future=pool.submit(e.sample_next,iterator,config,'test',0,start//2048)
            z=np.empty(len(ids),dtype='float32');seen=np.zeros(len(ids),bool);chunk_start=time.monotonic()
            for local in range(count):
                index=start//2048+local;sampled=future.result()
                if local+1<count:future=pool.submit(e.sample_next,iterator,config,'test',0,index+1)
                rows,batch,_=adapter.materialize(graph,sampled,ids);predicted,selected=model(batch)
                assert torch.equal(selected,torch.arange(len(rows),device='cuda')) and torch.isfinite(predicted).all() and not seen[rows].any()
                z[rows]=predicted.cpu().numpy();seen[rows]=True
                done=completed+int(seen.sum());speed=(done-already)/(time.monotonic()-started)
                if index%8==0 or done==N:event('saml_progress',completed=done,total=N,percent=100*done/N,rows_per_second=speed,eta_seconds=(N-done)/speed)
                del batch,sampled,predicted,selected
            assert seen.all()
            tmp=marker.with_suffix('.tmp.npz');np.savez(tmp,ids=ids,logits=z);tmp.replace(marker.with_suffix('.npz'))
            write(str(marker.relative_to(ROOT)),dict(protocol_sha256=protocol_sha,rows=len(ids),start=start,end=end,
                sha256=sha(marker.with_suffix('.npz')),seconds=time.monotonic()-chunk_start))
            completed+=len(ids);trim()
            if STOP:event('saml_interrupted',completed=completed,total=N);return
    event('saml_inference_complete',rows=N,elapsed_seconds=time.monotonic()-started)
    del model,graph,adapter;torch.cuda.empty_cache();trim();report()

def metrics(y,z):
    pred=z>0;tp=int((y&pred).sum());fp=int((~y&pred).sum());fn=int((y&~pred).sum());tn=int((~y&~pred).sum())
    ratio=lambda a,b:a/b if b else 0.
    ap=e.binary_average_precision(y,z);assert abs(ap-average_precision_score(y,z))<1e-12
    return dict(rows=len(y),positive=int(y.sum()),TP=tp,FP=fp,FN=fn,TN=tn,precision=ratio(tp,tp+fp),recall=ratio(tp,tp+fn),
                F1=ratio(2*tp,2*tp+fp+fn),AP=ap,FPR=ratio(fp,fp+tn),ROC_AUC=float(roc_auc_score(y,z)),coverage=1.)

def report():
    protocol=json.loads((ROOT/'target_protocol.json').read_text());protocol_sha=sha(ROOT/'target_protocol.json')
    z=np.lib.format.open_memmap(ROOT/'saml_logits.npy','w+',dtype='float32',shape=(N,));seen=np.zeros(N,bool)
    for path in sorted((ROOT/'target_chunks').glob('*.json')):
        info=json.loads(path.read_text());assert info['protocol_sha256']==protocol_sha and sha(path.with_suffix('.npz'))==info['sha256']
        with np.load(path.with_suffix('.npz')) as a:
            ids=a['ids'];assert len(ids)==info['rows']==len(np.unique(ids)) and (ids<N).all() and not seen[ids].any()
            assert np.isfinite(a['logits']).all();z[ids]=a['logits'];seen[ids]=True
    assert seen.all();z.flush()
    y=np.load(BASE/'cache/labels.npy',mmap_mode='r').astype(bool);old=np.load(BASE/'cache/logits.npy',mmap_mode='r')
    baseline=metrics(y,old);changed=metrics(y,z);known=json.loads((BASE/'result.json').read_text())
    for key in ['TP','FP','FN','TN','precision','recall','F1','AP','FPR']:assert abs(baseline[key]-known[key])<1e-12,key
    paired=dict(normal_rescued=int(((~y)&(old>0)&(z<=0)).sum()),new_false_positives=int(((~y)&(old<=0)&(z>0)).sum()),
                positive_gained=int((y&(old<=0)&(z>0)).sum()),positive_lost=int((y&(old>0)&(z<=0)).sum()))
    selected=protocol['selected_method']
    result=dict(utc=datetime.now(timezone.utc).isoformat(),method=selected,protocol_sha256=protocol_sha,baseline=baseline,imputed=changed,paired=paired,
                delta={key:changed[key]-baseline[key] for key in ['precision','recall','F1','AP','FPR']},logits_sha256=sha(ROOT/'saml_logits.npy'),
                methods_selected_on='HI Validation AP only',main_model_retrained=False,threshold=.5,all_rows_verified=True,AP_sklearn_crosscheck=True)
    write('result.json',result);pd.DataFrame([dict(method='zero',**baseline),dict(method=selected,**changed)]).to_csv(ROOT/'saml_metrics.csv',index=False)
    pattern=e.pq.read_table(e.S/'cache/truth.parquet',columns=['pattern']).to_pandas()['pattern'];rows=[]
    for name,ix in pattern.groupby(pattern,sort=True).groups.items():
        ix=np.asarray(ix);p0=old[ix]>0;p1=z[ix]>0;truth=y[ix]
        rows.append(dict(pattern=name,rows=len(ix),positive=int(truth.sum()),old_predicted_positive=int(p0.sum()),new_predicted_positive=int(p1.sum()),
            old_positive_rate=float(p0.mean()),new_positive_rate=float(p1.mean())))
    pd.DataFrame(rows).to_csv(ROOT/'pattern_comparison.csv',index=False)
    validation=pd.read_csv(ROOT/'validation_metrics.csv');fit=json.loads((ROOT/'fit.json').read_text())
    titles={'original':'HI 원본','zero':'기존 0 처리','train_median':'HI Train 전체 중앙값','degree_median':'HI Train 차수 구간별 중앙값'}
    valrows='\n'.join(f"| {titles[v.method]} | {v.precision:.2%} | {v.recall:.2%} | {v.F1:.2%} | {v.AP:.2%} | {v.FPR:.4%} |" for v in validation.itertuples())
    targetrows='\n'.join(f"| {titles[name]} | {v['precision']:.2%} | {v['recall']:.2%} | {v['F1']:.2%} | {v['AP']:.2%} | {v['FPR']:.4%} | {v['FP']:,} |" for name,v in [('zero',baseline),(selected,changed)])
    text=f'''# 소유관계 결측 대체 후 SAML-D 전체 평가

완료: {result['utc']}

**선택 방식: {titles[selected]}**. HI Validation AP로 선택한 뒤 SAML 전체 **{N:,}건**을 평가했다. GNN 가중치(epoch280), 임계값0.5, 그래프·샘플링·거래 순서·Port·Ego는 고정했다.

## SAML-D 전체 결과

| 처리 | Precision | Recall | F1 | AP | FPR | 오탐 수 |
|---|---:|---:|---:|---:|---:|---:|
{targetrows}

변화: Precision **{result['delta']['precision']*100:+.2f} pp**, Recall **{result['delta']['recall']*100:+.2f} pp**, F1 **{result['delta']['F1']*100:+.2f} pp**, AP **{result['delta']['AP']*100:+.2f} pp**. 원래 오탐 중 **{paired['normal_rescued']:,}건**이 정상 판정으로 바뀌었고 새 오탐은 **{paired['new_false_positives']:,}건**이다. 사기 추가 탐지는 **{paired['positive_gained']:,}건**, 기존에 탐지하던 사기를 놓친 건수는 **{paired['positive_lost']:,}건**이다.

| 실제 / 예측 | 정상 예측 | 사기 예측 |
|---|---:|---:|
| 정상 | TN {changed['TN']:,} | FP {changed['FP']:,} |
| 사기 | FN {changed['FN']:,} | TP {changed['TP']:,} |

## HI Validation에서 선택한 근거

HI Validation 전체에서 정답과 독립적으로 262,144건(128개 공유 배치)을 무작위 선택했다. 같은 그래프·같은 샘플링으로 다음 조건을 비교했다. 실제 SAML 결측 상황에 맞춰 zero 및 두 대체 조건에서 계좌 유형6개·국가2개를 계속 0으로 두고, 소유관계3개만 대체했다. original은 참고용 원본 상한 비교다.

| 처리 | Precision | Recall | F1 | AP | FPR |
|---|---:|---:|---:|---:|---:|
{valrows}

후보 두 개 중 AP가 높은 방식을 선택했다. 동률이면 F1, 그마저 동률이면 전체 중앙값을 선택하도록 사전에 정했다. SAML 정답·새 예측점수로 방법이나 임계값을 선택하지 않았다. HI Validation은 표본 평가이고 SAML은 전체 평가다.

## 대체값 계산

- 대상 열: `log_entity_observed_accounts`, `log_entity_out_diversity`, `log_entity_in_diversity`.
- HI Train 마지막 날(2022-09-25)의 활동 계좌 **{fit['active_train_accounts']:,}개**만 사용했다. 사기 정답을 읽지 않았다.
- 전체 중앙값(이미 로그 변환된 입력 공간): **{fit['global_median']}**. 거래 빈도로 계좌에 가중치를 주지 않았다.
- 조건부 방식은 관측 가능한 `log_out_neighbors`, `log_in_neighbors`로 고정 구간을 만들고, 그 구간의 HI Train 소유관계 중앙값을 사용했다. 계좌가 128개 미만인 구간은 전체 중앙값으로 대체했다. 유효 구간은 {fit['supported_cells']}/{fit['total_cells']}개다.
- 계좌 유형·국가 정보·Unknown 결제방식 매핑과 다른 피처는 유지했다. 원본 캐시와 원본 0 처리 점수도 보존했다.

## 해석과 검증

이 값은 **관측된 SAML 소유관계가 아니라 HI 통계로 추정한 대체값**이다. 기존 Test 결과를 이미 보고 결측 취약점을 분석한 뒤 수행한 후속 진단이므로, 완전히 새로운 미사용 Test 검증으로 해석하지 않는다. HI Validation에서 더 나았던 방식이 SAML에도 더 낫다는 보장은 없고, 이 결과를 보고 추가로 SAML 임계값을 조절하지 않았다.

전체 거래 ID 중복·누락 없이 정확히 한 번 점수를 만들었다. 대표 실제 배치에서 기존 0 처리 점수 재현, 변경된 GPU 입력과 독립 CPU 입력의 일치, 소유관계 열 외 입력 보존을 검사했다. 전체 AP는 scikit-learn으로 교차 검산했고 원본 전체 지표도 재계산해 일치시켰다.

`plan.json`, `fit.json`, `selection.json`, `target_protocol.json`에 학습 범위·대체값·선택 근거·고정 조건을 기록했다. `validation_metrics.csv`, `saml_metrics.csv`, `pattern_comparison.csv`, `result.json`에 결과가 있고 `saml_logits.npy`는 원본 거래 ID 순서의 전체 새 점수다. 각 실행 스크립트와 `target_chunks/`의 재개 가능한 결과를 함께 보존했다.

**SALT-GNN은 중단 상태를 유지한다.** 원래 체크포인트를 변경하거나 학습을 재개하지 않았다.
'''
    (ROOT/'결과.md').write_text(text);event('complete',method=selected,baseline=baseline,imputed=changed,paired=paired)

if __name__=='__main__':
    signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
    if len(sys.argv)>1 and sys.argv[1]=='report':report()
    else:run()
