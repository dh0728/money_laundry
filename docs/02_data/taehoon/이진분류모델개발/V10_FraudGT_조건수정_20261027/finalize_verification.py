"""Publish an ordered, reproducible code-verification record (not model results)."""
from configure import configure
ROOT,_=configure('verification_archive')
from pathlib import Path
from datetime import datetime,timezone
from html import escape
import json,fcntl
from fraudgt_lab.config import digest,protocol,TrainConfig,UPSTREAM_COMMIT
from fraudgt_lab.storage import write_json
from corrected_runtime import source_manifest

now=datetime.now(timezone.utc).isoformat()
names=['functional_verification','model_math_verification','epoch_loop_verification','notebook_verification']
results={name:json.loads((ROOT/(name+'.json')).read_text()) for name in names}
assert all(value['status']=='pass' for value in results.values())
notebooks=json.loads((ROOT/'notebooks.json').read_text())['notebooks']
for row in notebooks:assert Path(row['path']).read_bytes()==Path(row['canonical']).read_bytes()
old_roots=[(Path('/workspace/handoff/V10_FraudGT_공식로더_20261027'),'verification.json','source_sha256','official_loader_001'),
 (Path('/workspace/handoff/V10_FraudGT_전체실행_20261027/V10_FraudGT_전체실행'),'runs/practice_official_001/code_manifest.json',None,'practice_official_001'),
 (Path('/workspace/handoff/V10_FraudGT_공유그래프_20261027'),'runs/shared_random_001/code_manifest.json',None,'shared_random_001')]
preserved=[]
for folder,path,key,run in old_roots:
    value=json.loads((folder/path).read_text());manifest=value[key] if key else value
    mismatch=[name for name,expected in manifest.items() if digest(folder/name)!=expected]
    assert not mismatch,mismatch
    checkpoints={name:str(folder/'runs'/run/'models/fraudgt_format'/name) for name in ['last.pt','best.pt']}
    assert all(Path(path).is_file() for path in checkpoints.values())
    active=False;lock=folder/'runs'/run/'run.lock'
    if lock.exists():
        with lock.open('rb') as handle:
            try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB);fcntl.flock(handle,fcntl.LOCK_UN)
            except BlockingIOError:active=True
    preserved.append({'run':run,'source_files_unchanged':len(manifest),'checkpoints_exist':checkpoints,'writer_active':active})
# Also check the stopped shared run's frozen backup, not a moving live checkpoint.
stopped=old_roots[2][0]/'runs/shared_random_001/stopped_checkpoints/official_loader_replacement'
for name,expected in [('last.pt','fcf87ae89e515252466d1ec64b4262e75f431ea77c4bae3caca4694c01814a30'),
                      ('best.pt','fecebd8eecac75efa2453cc8343eaf28b5ca75f60d1d6a73616d8f675ab8b73b')]:
    assert digest(stopped/name)==expected
for mode in ['shared','disjoint']:
    assert not (ROOT/'runs'/f'{mode}_corrected_001/models').exists()

record={'status':'pass','utc':now,'source_sha256':source_manifest(),
    'notebook_sha256':{row['path']:digest(row['path']) for row in notebooks},
    'test_script_sha256':{p.name:digest(p) for p in ROOT.glob('verify_*.py')},
    'upstream_commit':UPSTREAM_COMMIT,'tests':results,'prior_runs_preserved':preserved,
    'full_training_started':False,'goal_P70_R65_evaluated':False,'not_full_paper_reproduction':True}
write_json(ROOT/'verification.json',record)
for mode in ['shared','disjoint']:write_json(ROOT/f'protocol_{mode}.json',protocol(TrainConfig(graph_mode=mode)))

# Record failed fixture setup separately so a resolved failure cannot appear current.
failure=ROOT/'verification_failure.json'
if failure.exists():
    value=json.loads(failure.read_text());value.update(resolved=True,resolution='Added typing.List to the isolated upstream-class test namespace; retry passed for all six cases.')
    write_json(failure,value)
ordered=list(results['functional_verification']['tests'])
for name,title in [('model_math_verification','05_pinned_GTLayer_forward_and_gradient'),
                   ('epoch_loop_verification','06_mid_epoch_resume_and_validation_schedule'),
                   ('notebook_verification','07_fresh_kernel_notebooks_and_visible_code')]:
    path=ROOT/(name+'.json')
    ordered.append({'order':len(ordered)+1,'utc':datetime.fromtimestamp(path.stat().st_mtime,timezone.utc).isoformat(),
                    'test':title,'status':'pass','detail':results[name]})
ordered.append({'order':8,'utc':now,'test':'08_preserve_old_sources_and_checkpoints','status':'pass','detail':preserved})
write_json(ROOT/'ordered_verification_results.json',ordered)
with (ROOT/'verification_journal.jsonl').open('a') as stream:
    stream.write(json.dumps({'utc':now,'event':'verification_finalized','checks':8,'source_sha256':record['source_sha256'],
                             'full_training_started':False},ensure_ascii=False)+'\n')

rows=[('1. 사용자 지정 비교군','기존 실습형을 공유 방식으로 바꾸면 비교군 소실','실습형은 개별 그래프, 공유 노트북은 원래2,048건 배치 전체 공유'),
 ('2. 기본형·PE 관계','기본형·PE에도 역방향 관계가 이웃 선택에 참여','기본형·PE는 to만, Multi는 to+rev_to'),
 ('3. 기간과 학습 거래','기존 프로젝트 기간·평가 cohort 사용','관측 거래 수의 일 단위60/20/20. train102,505,233 / val34,491,749 / test33,429,507'),
 ('4. 검증 표본','양성 전수+정상 IPW cohort41,246건','검증 전체에서 균일 셔플, 최대256×2,048=524,288 요청. IPW 없음'),
 ('5. 검증 시점','매 epoch 검증','epoch1,4,8,…500. 미실행 epoch val은 빈칸'),
 ('6. 판정 대상','별도 query 경로로 모든 요청 거래 판정','공식 sampled-target head. coverage / 누락 양성 / 요청 집합 Recall 하한 기록'),
 ('7. 개별 그래프 손실','메모리용 작은 조각이 손실 단위가 되면 비교 불공정','64건씩 계산해도 원래2,048건 배치의 판정수 기준 평균으로 복원, 평균8개 누적'),
 ('8. 화면과 재개','조회 상태·재개 지표가 혼동될 수 있음','에폭별 train/val ACC·P·R·F1·AP·무패턴R, 실시간 게이지, 검증 주기를 반영한 ETA, 중간 배치 재개')]
comparison=''.join('<tr>'+''.join('<td>'+escape(text)+'</td>' for text in row)+'</tr>' for row in rows)
labels=['모집단·기간·정답 매핑','모델별 실제 공식 dataset constructor 및 PyG loader 대조','공식 head·손실 gradient·coverage',
        'V10 실제 GPU 배치 6개 + 검증 그래프','원본 GTLayer 계산·입력 gradient','작은 합성 데이터6 epoch / 중간 배치 중단 재개','두 노트북 새 커널41개 셀 및 함수 AST 동일성','기존3종 코드58개 파일·체크포인트 보존']
tests=''.join(f'<tr><td>{i+1}</td><td>{escape(row["utc"])}</td><td>{escape(labels[i])}</td><td class="pass">PASS</td></tr>' for i,row in enumerate(ordered))
real=results['functional_verification']['tests'][3]
gpu=''.join(f'<tr><td>{r["mode"]}</td><td>{r["variant"]}</td><td>{r["targets"]:,}</td><td>{r["scored"]:,}</td><td>{r["nodes"]:,}</td><td>{r["forward_edges"]+r["reverse_edges"]:,}</td><td>{r["peak_cuda_mib"]:,.1f}</td></tr>' for r in real['train_batches'])
source_base=f'https://github.com/junhongmit/FraudGT/blob/{UPSTREAM_COMMIT}/'
source_paths=['configs/AML-Large-HI/AML-Large-HI-SparseNodeGT.yaml','fraudGT/datasets/aml_dataset.py',
              'fraudGT/config/dataset_config.py','fraudGT/sampler/custom_sampler.py',
              'fraudGT/head/hetero_edge.py','fraudGT/train/custom_train.py']
sources=''.join(f'<li><a href="{source_base+path}">{escape(path)}</a></li>' for path in source_paths)
links=''.join(f'<li><a href="{Path(row["canonical"]).name}">{"개별 그래프 실습형" if row["mode"]=="disjoint" else "공유그래프 실습형"}</a> · 실제 수정 경로: <code>{escape(row["path"])}</code></li>' for row in notebooks)
page=f'''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V10 FraudGT 노트북 수정·검증 기록</title>
<style>body{{font:16px/1.7 system-ui,sans-serif;max-width:1180px;margin:48px auto;padding:0 24px;color:#1b283b;background:#f6f8fc}}h1,h2{{line-height:1.3}}section{{background:white;padding:28px;border:1px solid #dbe3ed;border-radius:12px;margin:24px 0}}table{{width:100%;border-collapse:collapse;font-size:14px}}td,th{{border-bottom:1px solid #dbe3ed;padding:12px;text-align:left;vertical-align:top}}th{{background:#edf3fa}}code{{overflow-wrap:anywhere}}.pass{{color:#087247;font-weight:bold}}.notice{{background:#fff6df;border-left:4px solid #d69a16;padding:16px}}a{{color:#1757a6}}.scroll{{overflow:auto}}</style>
<h1>V10 FraudGT 노트북 수정·검증 기록</h1><p>기록 시각: {now} · 목표 P≥70%, R≥65%</p>
<section><h2>유지한 비교 구조</h2><p><b>기존 실습형은 거래별 개별 그래프 비교용으로 유지했습니다.</b> 공유 노트북은 실제 PyG의2,048건 배치 전체 공유 그래프를 사용합니다. 두 방식의 V10 입력, 대상 거래 순서, 기간, 손실, 검증 조건을 맞췄습니다.</p><ul>{links}</ul>
<p>첫 셀 RUN_TRAINING=True → 커널 재시작 → 전체 실행. 기본값False에서는 학습을 시작하지 않습니다. 기존 실행은 이전 코드로 계속되며, 이 수정본은 disjoint_corrected_001 / shared_corrected_001 새 실행을 사용합니다. 현재 위치에서 실행하려면 같은 handoff 아래의 조건수정 패키지와 기존 project 캐시가 함께 있어야 합니다.</p></section>
<section><h2>확인한 차이와 수정</h2><div class="scroll"><table><tr><th>순서</th><th>기존 문제 또는 차이</th><th>수정본</th></tr>{comparison}</table></div></section>
<section><h2>같이 고정한 조건</h2><p>V10 계좌19종+거래수치14종+결제방식1종. 거래 입력은 결제방식8열 one-hot 포함22열입니다. 기존41종 결합모델의 트리 전용 피처 전체를 GNN에 넣은 것은 아닙니다. PE는 port, Multi는 port·역방향·ego를 추가합니다.</p>
<p>epoch500 / 요청배치2,048 / epoch256배치 / 누적8 / BCE[1,6] / AdamW lr0.001·decay1e-5 / warmup5·cosine / clip1 / hidden64·2layers·8heads·attention dropout0.2. 가중치300은 사용하지 않습니다.</p>
<p>Train2022-08-01~09-25, Val09-26~10-13, Test10-14~10-31. 그래프는 각 split 종료까지 누적합니다. 일말 cutoff는 시연 조건으로 남기고 학습 이웃에는 적용하지 않습니다. split 내부 거래 이후 정보가 포함되는 오프라인 조건이며, train에 val/test 간선을 넣지 않습니다.</p></section>
<section><h2>검증 결과 — 완료 순서</h2><p>아래는 코드 검증입니다. 합성 데이터 점수와 초기화 모델의 GPU 검사는 최종 모델 성능이 아닙니다.</p><div class="scroll"><table><tr><th>순서</th><th>UTC</th><th>검증</th><th>결과</th></tr>{tests}</table></div>
<p>원본 GTLayer에 동일한 유효 파라미터를 넣었을 때 정·역관계 모두 최대 순전파 절대오차3.58×10⁻⁷이며 입력 gradient도 허용오차 안에서 일치했습니다. 없는 torch_scatter.scatter_max는 검증에서 native scatter_reduce의amax로 치환했습니다. dropout을 끈 eval 비교이며 RNG 순서까지 같다는 뜻은 아닙니다.</p>
<p>공식 constructor 추출 검증의 초기 typing.List 누락과 노트북 생성 문자열 오류는 수정 후 재검증했습니다. 초기 실패 기록도 보존했습니다. 두 방식의 중간 배치 재개는 연속6 epoch 실행과 모델·지표가 일치했고, 검증은1·4·6(시험 마지막epoch)에만 실행됐습니다.</p>
<p><a href="ordered_verification_results.json">순서별 JSON</a> · <a href="verification.json">소스 해시·전체 검증</a> · <a href="verification_journal.jsonl">추가 기록</a></p></section>
<section><h2>실제 V10 GPU 배치 확인</h2><div class="scroll"><table><tr><th>방식</th><th>모델</th><th>요청</th><th>판정</th><th>노드</th><th>문맥 간선</th><th>GPU peak MiB</th></tr>{gpu}</table></div>
<p>공유는 실제2,048건 배치, 개별은 실제64건 처리 조각의 점검입니다. 모든 모델에서 순전파·역전파가 유한값이었으며 개별 그래프 사이를 잇는 간선은 없었습니다. Val prefix는day73, 기본형의 실제 검증배치2,048건도 별도로 확인했습니다.</p>
<div class="notice"><b>판정 누락을 반드시 함께 확인해야 합니다.</b> 점검한 공유 기본형 train배치는2,048건 중843건, val배치는2,048건 중695건만 공식 head에서 판정됐습니다. 이는 해당1배치의 동작 확인이며 전체 평균이 아닙니다. 나머지는 전처리 삭제가 아니라 샘플링된 문맥에 대상 간선이 없어 readout에서 제외된 경우입니다. 따라서 판정된 거래만의 Recall을 전체 요청 거래 Recall로 부르면 안 됩니다. coverage·missing_positive·requested_recall_lower_bound를 함께 기록합니다.</div></section>
<section><h2>공식 실행과 남는 차이</h2><ul>
<li>V10 입력·스케일러·관측값 중복 제거를 유지했습니다. 정적KYC의 실제 제공 시점은 검증되지 않았습니다.</li>
<li>실습형의 개별 그래프는 의도한 비교군입니다. 공유형만 논문의 배치 공유 범위를 적용합니다.</li>
<li>현재 기본 worker0/thread2, 공식 리소스 옵션18/24. GPU allocator 상한35%와 activation checkpointing을 사용합니다. 이 자원 설정은 원 논문의 장비·실행시간과 다릅니다.</li>
<li>원 코드의 accumulation 경계 오류는 재현하지 않고 완전한8배치 누적·마지막 flush로 고쳤습니다.</li>
<li>seed42 한 번의 비교입니다. 샘플링 RNG·초기화 호출 순서·동일 시각 port 순서까지 bitwise 재현하지 않습니다. Train은 전체 target 순회를 유지하지만 epoch마다 loader를 다시 만드는 메모리 구현입니다.</li>
<li>과거에도 사용한 test 데이터입니다. 외부 일반화 검증이나 미사용 holdout이라는 주장을 하지 않습니다.</li></ul>
<p><b>이번 수정본으로 전체 학습을 시작하지 않았습니다. P70/R65 달성 결과도 아직 없습니다.</b> 기존 세 실행의 코드58개 파일 해시와 체크포인트 보존을 확인했습니다. 이전 결과를 수정 조건의 결과로 합치지 않습니다.</p></section>
<section><h2>대조한 공식 소스</h2><ul>{sources}</ul><p>검증한 고정 commit: <code>{UPSTREAM_COMMIT}</code></p></section></html>'''
(ROOT/'노트북_조건수정_검증기록.html').write_text(page)
print(json.dumps({'status':'pass','source_files':len(record['source_sha256']),'notebooks':len(notebooks),'prior_runs':preserved,'report':str(ROOT/'노트북_조건수정_검증기록.html')},ensure_ascii=False))
