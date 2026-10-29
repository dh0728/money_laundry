"""Reproduce the real long-running inline-cell leak and verify the plot fix."""
from pathlib import Path
from datetime import datetime, timezone
import json

import nbformat as nbf
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parent
backup = Path(json.loads((ROOT / 'inline_queue_fix_backup.json').read_text())['folder'])
code = f'''
%matplotlib inline
import sys, gc, json, weakref, importlib.util
from pathlib import Path
from io import BytesIO
import matplotlib.pyplot as plt
from matplotlib_inline.backend_inline import show
ROOT = Path({str(ROOT)!r})
sys.path.insert(0, str(ROOT))
import notebook_display as fixed
spec = importlib.util.spec_from_file_location('display_before_fix', {str(backup / 'notebook_display.py')!r})
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)
history = json.loads((ROOT / 'runs/shared_corrected_001/models/fraudgt_format/history.json').read_text())
plt.ion()
sentinel = plt.figure()  # An unrelated user plot must remain queued.
initial_queue = len(show._to_draw)

def render_many(module, count):
    refs = []
    first_png = None
    for _ in range(count):
        figure = module.learning_figure(history, 'fraudgt_format')
        refs.append(weakref.ref(figure))
        with BytesIO() as buffer:
            figure.savefig(buffer, format='png', dpi=100)
            if first_png is None:
                first_png = buffer.getvalue()
        del figure
    gc.collect()
    return refs, first_png

# All renders and assertions happen in ONE cell, before post_execute flushes.
old_refs, old_png = render_many(old, 12)
old_queued = len(show._to_draw) - initial_queue
old_alive = sum(ref() is not None for ref in old_refs)
assert old_queued == old_alive == 12
old_ids = {{id(ref()) for ref in old_refs}}
show._to_draw[:] = [figure for figure in show._to_draw if id(figure) not in old_ids]
gc.collect()
assert all(ref() is None for ref in old_refs)

new_refs, new_png = render_many(fixed, 40)
new_queued = len(show._to_draw) - initial_queue
new_alive = sum(ref() is not None for ref in new_refs)
assert new_queued == new_alive == 0
assert sentinel in show._to_draw
assert plt.isinteractive()
assert old_png == new_png, 'The plotted pixels must be identical'
result = {{'backend': plt.get_backend(), 'single_cell_execution': True,
          'old_renders': 12, 'old_queue_growth': old_queued, 'old_figures_after_gc': old_alive,
          'fixed_renders': 40, 'fixed_queue_growth': new_queued, 'fixed_figures_after_gc': new_alive,
          'png_bytes_identical': True, 'unrelated_plot_preserved': True,
          'interactive_state_preserved': True, 'torch_imported': 'torch' in sys.modules}}
Path(ROOT / 'inline_queue_retention_verification.json').write_text(json.dumps(result, indent=2)+'\\n')
print(json.dumps(result))
plt.close(sentinel)
'''
nb = nbf.v4.new_notebook(cells=[nbf.v4.new_code_cell(code)])
NotebookClient(nb, kernel_name='python3', timeout=150,
               resources={'metadata': {'path': str(ROOT)}}).execute()
nbf.write(nb, ROOT / 'inline_queue_retention_verification.ipynb')
record = json.loads((ROOT / 'inline_queue_retention_verification.json').read_text())
record.update(utc=datetime.now(timezone.utc).isoformat(), status='pass')
(ROOT / 'inline_queue_retention_verification.json').write_text(
    json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False))
