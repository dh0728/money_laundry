"""Add an early backend check while retaining the user's current notebook cells."""
from pathlib import Path
from datetime import datetime, timezone
import json
import shutil
import nbformat as nbf

root = Path(__file__).resolve().parent
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
archive = root/'notebook_backups'/('sampler_fix_'+stamp)
archive.mkdir(parents=True, exist_ok=True)
for name in ['verification.json','lesson_layout_verification.json','lesson_layout_manifest.json','notebooks.json']:
    shutil.copy2(root/name, archive/name)
manifest = json.loads((root/'lesson_layout_manifest.json').read_text())
patched = []
for row in manifest['notebooks']:
    for key in ['path','canonical']:
        path = Path(row[key])
        notebook = nbf.read(path, as_version=4)
        saved = archive/(row['mode']+'_'+key+'.ipynb')
        shutil.copy2(path, saved)
        if not any('sampling-backend-check' in c.metadata.get('tags', []) for c in notebook.cells):
            index = next(i for i,c in enumerate(notebook.cells) if 'lesson-settings' in c.metadata.get('tags', []))
            explanation = nbf.v4.new_markdown_cell('기본 Python 3 커널에서도 실제 이웃 추출을 먼저 확인합니다. 라이브러리 설치 전의 오류가 남아 있으면 해당 커널을 재시작하고 첫 셀부터 실행하세요.')
            check = nbf.v4.new_code_cell('''from notebook_environment import check_sampling_backend

backend_info = check_sampling_backend(GRAPH_MODE)
for name, value in backend_info.items():
    print(f"{name}: {value}")''', metadata={'tags':['sampling-backend-check']})
            notebook.cells[index+1:index+1] = [explanation, check]
        nbf.validate(notebook)
        nbf.write(notebook, path)
        patched.append(str(path))
        if key == 'path':
            lengths = [len(c.source.splitlines()) for c in notebook.cells if c.cell_type == 'code']
            row.update(cells=len(notebook.cells), code_cells=len(lengths), longest_code_cell=max(lengths))
manifest['sampling_backend_fix'] = {'utc':stamp,'backup':str(archive)}
(root/'lesson_layout_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(root/'notebooks.json').write_text(json.dumps({'utc':stamp,'notebooks':manifest['notebooks']},ensure_ascii=False,indent=2))
print(json.dumps({'patched':patched,'backup':str(archive)},ensure_ascii=False))
