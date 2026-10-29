"""Render real current histories in a CPU-only viewer, without training."""
from pathlib import Path
from datetime import datetime,timezone
import copy,json,base64
import nbformat as nbf
from nbclient import NotebookClient
root=Path(__file__).resolve().parent
monitor=root/'V10_FraudGT_공유그래프_진행조회.ipynb'
original=nbf.read(monitor,as_version=4)
records=[]
manifest=json.loads((root/'lesson_layout_manifest.json').read_text())
for row in manifest['notebooks']:
    notebook=copy.deepcopy(original)
    notebook.cells=[c for c in notebook.cells if 'viewer-follow' not in c.metadata.get('tags',[])]
    notebook.cells[2].source=notebook.cells[2].source.replace('shared_corrected_001',row['mode']+'_corrected_001')
    notebook.cells.append(nbf.v4.new_code_cell('''
import sys
assert 'torch' not in sys.modules
assert viewer.figure is not None
assert viewer.table is not None
assert len(viewer.figure.data) > 1000
print('READ_ONLY_PNG_VIEWER_PASS')
'''))
    NotebookClient(notebook,kernel_name='python3',timeout=90,resources={'metadata':{'path':str(root)}}).execute()
    snapshot=next(c for c in notebook.cells if 'viewer-snapshot' in c.metadata.get('tags',[]))
    images=[o.data['image/png'] for o in snapshot.outputs if 'image/png' in o.get('data',{})]
    assert len(images)==1
    utc=datetime.now(timezone.utc).isoformat()
    if row['mode']=='shared':
        final=copy.deepcopy(original)
        for i in [1,2,4]:
            final.cells[i].outputs=notebook.cells[i].outputs
            final.cells[i].execution_count=notebook.cells[i].execution_count
        final.cells[3].source+='\n\n저장된 그림의 조회 시각(UTC): '+utc
        nbf.write(final,monitor)
        (root/'live_chart_preview.png').write_bytes(base64.b64decode(images[0]))
    for key in ['canonical','path']:
        target=Path(row[key]);value=nbf.read(target,as_version=4)
        preview=next(c for c in value.cells if 'live-chart-preview' in c.metadata.get('tags',[]))
        preview.outputs=copy.deepcopy(snapshot.outputs)
        preview.metadata['snapshot_utc']=utc
        # This is a saved read-only snapshot, not execution of the training cell.
        preview.execution_count=None
        nbf.write(value,target)
    records.append({'mode':row['mode'],'utc':utc,'png_outputs':len(images),'torch_not_imported':True,'training_started':False})
(root/'chart_monitor_verification.json').write_text(json.dumps({'status':'pass','cases':records},ensure_ascii=False,indent=2))
print(json.dumps(records,ensure_ascii=False))
