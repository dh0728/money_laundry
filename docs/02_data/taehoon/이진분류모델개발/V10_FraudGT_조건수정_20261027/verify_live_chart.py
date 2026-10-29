"""Reproduce and verify chart output after clearing and reusing a display."""
from pathlib import Path
import json,sys
import nbformat as nbf
from nbclient import NotebookClient
root=Path(__file__).resolve().parent
mode=sys.argv[1] if len(sys.argv)>1 else 'before'
notebook=nbf.v4.new_notebook(cells=[nbf.v4.new_code_cell('''
import sys
from pathlib import Path
from types import SimpleNamespace
from IPython.display import clear_output
ROOT=Path.cwd()
sys.path.insert(0,str(ROOT))
from notebook_display import LiveTrainingDisplay
run=ROOT/'runs/shared_corrected_001'
config=SimpleNamespace(epochs=500,seed_batch=2048,iterations_per_epoch=256,validation_batches=256,
                       validation_epoch=lambda e:e==1 or e%4==0 or e==500)
viewer=LiveTrainingDisplay(run,config,['fraudgt_format','pe_fraudgt_format','multi_fraudgt_format'])
viewer.refresh()
clear_output(wait=False)
viewer.refresh()
''')])
NotebookClient(notebook,kernel_name='python3',timeout=90,resources={'metadata':{'path':str(root)}}).execute()
outputs=notebook.cells[0].outputs
record={'phase':mode,'png_outputs':sum('image/png' in o.get('data',{}) for o in outputs),
        'html_outputs':sum('text/html' in o.get('data',{}) for o in outputs),'uses_real_history':True}
nbf.write(notebook,root/('live_chart_'+mode+'.ipynb'))
(root/('live_chart_'+mode+'.json')).write_text(json.dumps(record,ensure_ascii=False,indent=2))
print(json.dumps(record))
if mode=='after':assert record['png_outputs']==1
