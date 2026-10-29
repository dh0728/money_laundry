"""Add an independent read-only viewer and a quick plot to both notebooks."""
from pathlib import Path
from datetime import datetime,timezone
import os,json,shutil
import nbformat as nbf

root=Path(__file__).resolve().parent
archive=Path(json.loads((root/'chart_fix_backup.json').read_text())['folder'])
monitor=root/'V10_FraudGT_공유그래프_진행조회.ipynb'
setup='''from pathlib import Path
import sys

PACKAGE_NAME = "V10_FraudGT_조건수정_20261027"
PACKAGE_ROOT = None
for parent in [Path.cwd(), *Path.cwd().parents]:
    candidates = [parent, parent / PACKAGE_NAME, parent / "handoff" / PACKAGE_NAME]
    PACKAGE_ROOT = next((p for p in candidates if (p / "notebook_display.py").is_file()), None)
    if PACKAGE_ROOT is not None:
        break
if PACKAGE_ROOT is None:
    raise FileNotFoundError("조건수정 패키지를 찾을 수 없습니다.")
sys.path.insert(0, str(PACKAGE_ROOT))
import importlib
import notebook_display
importlib.reload(notebook_display)
from notebook_display import show_saved_training
'''
cells=[
 nbf.v4.new_markdown_cell('''# 공유그래프 학습 진행 조회

진행 중인 학습의 기록을 읽어 게이지·그래프·표를 보여줍니다. 모델을 생성하거나 GPU를 사용하지 않습니다. 학습 노트북은 그대로 두고 이 파일을 별도 커널에서 실행하면 됩니다.'''),
 nbf.v4.new_code_cell(setup),
 nbf.v4.new_code_cell('''RUN_NAME = "shared_corrected_001"
RUN_DIR = PACKAGE_ROOT / "runs" / RUN_NAME
REFRESH_SECONDS = 2
print("조회할 실행:", RUN_DIR)'''),
 nbf.v4.new_markdown_cell('## 현재 기록\n\n아래에 저장된 그림은 마지막 조회 시점의 기록입니다. 셀을 다시 실행하면 최신 상태로 바뀝니다.'),
 nbf.v4.new_code_cell('viewer = show_saved_training(RUN_DIR)',metadata={'tags':['viewer-snapshot']}),
 nbf.v4.new_markdown_cell('## 실시간 갱신\n\n진행률과 loss는 2초마다 확인하고, 그래프는 최대 15초 간격으로 갱신합니다. 새 epoch 결과가 저장되면 그래프와 표에 바로 반영합니다. 전체 출력을 지우지 않고 바뀐 부분만 갱신합니다.\n\n표시 코드가 수정된 경우 이 조회 셀만 중단한 뒤 다시 실행하세요. 학습 노트북은 계속 실행됩니다.'),
 nbf.v4.new_code_cell('importlib.reload(notebook_display)\nviewer = notebook_display.show_saved_training(\n    RUN_DIR, follow=True, refresh_seconds=REFRESH_SECONDS\n)',metadata={'tags':['viewer-follow']})]
nb=nbf.v4.new_notebook(cells=cells,metadata={
 'kernelspec':{'display_name':'Python 3 (ipykernel)','language':'python','name':'python3'},
 'language_info':{'name':'python'},'purpose':'read_only_training_monitor_no_torch'})
nbf.write(nb,monitor)
manifest=json.loads((root/'lesson_layout_manifest.json').read_text())
patches=[]
for row in manifest['notebooks']:
 for key in ['canonical','path']:
  path=Path(row[key]);nb=nbf.read(path,as_version=4)
  shutil.copy2(path,archive/(row['mode']+'_'+key+'.ipynb'))
  if not any('live-chart-preview' in c.metadata.get('tags',[]) for c in nb.cells):
   index=next(i for i,c in enumerate(nb.cells) if 'lesson-settings' in c.metadata.get('tags',[]))
   link=os.path.relpath(monitor,path.parent)
   text='### 현재 학습 그래프 먼저 보기\n\n저장된 학습 기록을 바로 확인합니다.'
   if row['mode']=='shared':text+=f' 학습 셀이 실행 중이라 다른 셀을 실행할 수 없으면 [공유그래프 진행 조회]({link})를 별도로 열어 실행하세요.'
   cell=nbf.v4.new_code_cell('''import importlib
import notebook_display
importlib.reload(notebook_display)
from notebook_display import show_saved_training

progress_viewer = show_saved_training(RUN_ROOT)''',metadata={'tags':['live-chart-preview']})
   nb.cells[index+1:index+1]=[nbf.v4.new_markdown_cell(text),cell]
  nbf.validate(nb);nbf.write(nb,path)
  patches.append(str(path))
  if key=='path':
   lengths=[len(c.source.splitlines()) for c in nb.cells if c.cell_type=='code']
   row.update(cells=len(nb.cells),code_cells=len(lengths),longest_code_cell=max(lengths))
(root/'lesson_layout_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(root/'notebooks.json').write_text(json.dumps({'utc':datetime.now(timezone.utc).isoformat(),'notebooks':manifest['notebooks']},ensure_ascii=False,indent=2))
print(json.dumps({'monitor':str(monitor),'patched':patches},ensure_ascii=False))
