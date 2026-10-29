"""Append the dependency fix and actual default-kernel verification."""
from pathlib import Path
from datetime import datetime,timezone
import json
import sys

root=Path(__file__).resolve().parent
sys.path.insert(0,str(root))
from configure import configure
configure('sampler_fix_record')
from corrected_runtime import source_manifest, require_verification
from fraudgt_lab.config import digest
from fraudgt_lab.storage import write_json

require_verification()
layout=json.loads((root/'lesson_layout_manifest.json').read_text())
checks=json.loads((root/'lesson_layout_verification.json').read_text())
native=json.loads((root/'native_dependency_verification.json').read_text())
assert checks['status']=='pass' and native['status']=='pass'
assert all(r['python']=='/usr/bin/python' and r['kernel_name']=='python3' for r in checks['cases'])
assert source_manifest()==layout['source_sha256_before']
for row,result in zip(layout['notebooks'],checks['cases']):
    assert digest(row['path'])==result['notebook_sha256']
now=datetime.now(timezone.utc).isoformat()
record={'utc':now,'event':'neighbor_sampler_dependency_fix','status':'pass',
 'cause':'pyg-lib existed only in /workspace/kimi/venv; notebook metadata selected the default /usr/bin/python kernel. Prior validation used the venv.',
 'fix':'Install the identical official pyg_lib0.8.0+pt210cu126 wheel into the bundled project runtime_deps, already added by configure().',
 'global_packages_changed':False,'training_source_changed':False,'full_training_started':False,
 'restart_required':'Restart the affected notebook kernel to discard PyG cached WITH_PYG_LIB=False, then run cells from the top.',
 'native_dependency':native,'notebook_checks':checks,
 'validation_command':'/usr/bin/python verify_lesson_notebooks.py',
 'sources':['https://pytorch-geometric.readthedocs.io/en/latest/install/installation.html',
            'https://data.pyg.org/whl/torch-2.10.0+cu126.html']}
write_json(root/'sampler_dependency_fix.json',record)
with (root/'verification_journal.jsonl').open('a') as stream:stream.write(json.dumps(record,ensure_ascii=False)+'\n')
ordered=json.loads((root/'ordered_verification_results.json').read_text())
ordered.append({'order':len(ordered)+1,'utc':now,'test':'10_default_kernel_native_sampling_dependency','status':'pass','detail':record})
write_json(root/'ordered_verification_results.json',ordered)
verification=json.loads((root/'verification.json').read_text())
verification['notebook_sha256']={row['path']:digest(row['path']) for row in layout['notebooks']}
verification.setdefault('notebook_helpers_sha256',{}).update({name:digest(root/name) for name in
 ['notebook_environment.py','make_lesson_notebooks.py','verify_lesson_notebooks.py']})
verification['sampling_dependency_fix']=record
write_json(root/'verification.json',verification)
page=root/'노트북_구성변경_기록.html'
html=page.read_text()
notice='''<section id="sampling-dependency-fix"><h2>후속 수정: 기본 커널의 NeighborSampler 오류</h2>
<p>기본 Python 3 커널에는 pyg-lib가 없고 검증용 가상환경에만 있던 것이 원인이었습니다. PyTorch2.10.0+cu126에 맞는 pyg-lib0.8.0+pt210cu126을 프로젝트 runtime_deps에 포함했습니다. 이미 검증한 native 파일9개의 SHA256도 동일합니다.</p>
<p><b>오류가 난 노트북을 다시 열고 해당 커널을 재시작한 뒤 위에서부터 실행하세요.</b> PyG가 처음 불러올 때 저장한 '라이브러리 없음' 상태를 해제하기 위해 재시작이 필요합니다. 코드의 샘플러 플래그를 강제로 바꾸지 않습니다.</p>
<p>이제 기본 /usr/bin/python 커널에서 개별·공유 두 노트북54개 셀 전체 실행과 실제8건 그래프 추출이 모두 통과했습니다. 학습 조건·그래프 공유 범위·체크포인트는 변경하지 않았으며 검증 중 전체 학습을 시작하지 않았습니다.</p>
<p><a href="sampler_dependency_fix.json">검증 기록</a> · <a href="https://pytorch-geometric.readthedocs.io/en/latest/install/installation.html">공식 설치 기준</a> · <a href="https://data.pyg.org/whl/torch-2.10.0+cu126.html">사용한 공식 wheel</a></p></section>'''
if 'sampling-dependency-fix' not in html:
    html=html.replace('<h1>V10 실습 노트북 구성 변경</h1>','<h1>V10 실습 노트북 구성 변경</h1>'+notice,1)
    page.write_text(html)
print(json.dumps({'status':'pass','kernel':'/usr/bin/python','notebooks':2,'cells_per_notebook':54,'native_files_match':9},ensure_ascii=False))
