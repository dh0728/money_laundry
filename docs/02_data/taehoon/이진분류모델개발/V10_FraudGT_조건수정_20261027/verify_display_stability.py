"""Exercise notebook output messages without loading models or touching live runs."""
from datetime import datetime, timezone
from pathlib import Path
import json

import nbformat as nbf
from nbclient import NotebookClient

ROOT = Path(__file__).resolve().parent
setup = '''
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
import json, sys
from IPython import get_ipython
from IPython.display import clear_output

sys.path.insert(0, str(Path.cwd()))
from notebook_display import LiveTrainingDisplay
source = Path.cwd() / 'runs/shared_corrected_001/models/fraudgt_format'
history = json.loads((source / 'history.json').read_text())
assert len(history) >= 2
temporary = TemporaryDirectory()
run = Path(temporary.name)
folder = run / 'models/fraudgt_format'
folder.mkdir(parents=True)
def save(name, value):
    (folder / name).write_text(json.dumps(value))

save('history.json', history[:-1])
live = {'epoch': history[-1]['epoch'],
        'train': {'completed': 2048, 'total': 524288, 'loss': 0.1},
        'validation': {'scheduled': False}}
save('live_progress.json', live)
config = SimpleNamespace(epochs=500, seed_batch=2048, iterations_per_epoch=256,
                         validation_batches=256, validation_epoch=lambda e: e % 4 == 0)
messages = []
def observe(message):
    messages.append({'type': message['header']['msg_type'],
                     'formats': list(message['content'].get('data', {})),
                     'display_id': message['content'].get('transient', {}).get('display_id')})
    return message
get_ipython().display_pub.register_hook(observe)
checks = {}
'''
refresh_checks = '''
viewer = LiveTrainingDisplay(run, config, ['fraudgt_format'])
with patch('notebook_display.time.monotonic', return_value=100):
    viewer.refresh()
assert len(messages) == 4 and all(m['type'] == 'display_data' for m in messages)
initial_ids = [m['display_id'] for m in messages]
assert len(set(initial_ids)) == 4
checks['initial_real_history_png'] = sum('image/png' in m['formats'] for m in messages) == 1
messages.clear()
with patch('notebook_display.time.monotonic', return_value=101):
    viewer.refresh()
assert messages == []
checks['unchanged_data_emits_nothing'] = True

live['train'].update(completed=4096, loss=0.09)
save('live_progress.json', live)
with patch('notebook_display.time.monotonic', return_value=102):
    viewer.refresh()
assert len(messages) == 1
assert messages[0]['type'] == 'update_display_data'
assert messages[0]['display_id'] == initial_ids[0]
assert 'image/png' not in messages[0]['formats']
checks['progress_updates_existing_gauge_only'] = True
messages.clear()

with patch('notebook_display.time.monotonic', return_value=116):
    viewer.refresh()
assert len(messages) == 1 and 'image/png' in messages[0]['formats']
assert messages[0]['type'] == 'update_display_data'
assert messages[0]['display_id'] == initial_ids[1]
checks['chart_throttled_to_15_seconds'] = True
messages.clear()

save('history.json', history)
with patch('notebook_display.time.monotonic', return_value=117):
    viewer.refresh()
assert len(messages) == 2
assert all(m['type'] == 'update_display_data' for m in messages)
assert [m['display_id'] for m in messages] == initial_ids[1:3]
checks['new_epoch_updates_chart_and_table_immediately'] = True
checks['routine_refresh_never_clears_output'] = True

messages.clear()
clear_output(wait=False)
assert messages[0]['type'] == 'clear_output'
messages.clear()
viewer.refresh()
assert len(messages) == 4 and all(m['type'] == 'display_data' for m in messages)
assert all(m['display_id'] not in initial_ids for m in messages)
checks['explicit_output_clear_recovers_png'] = True
messages.clear()
'''
rerun_checks = '''
# Reuse the object in another cell: it must create visible output here.
viewer.refresh()
assert len(messages) == 4 and all(m['type'] == 'display_data' for m in messages)
checks['cell_rerun_creates_fresh_outputs'] = True
assert 'torch' not in sys.modules
checks['torch_not_imported'] = True
assert all(checks.values())
get_ipython().display_pub.unregister_hook(observe)
temporary.cleanup()
print('DISPLAY_STABILITY_RESULTS=' + json.dumps(checks))
'''

notebook = nbf.v4.new_notebook(cells=[
    nbf.v4.new_code_cell(setup),
    nbf.v4.new_code_cell(refresh_checks),
    nbf.v4.new_code_cell(rerun_checks),
])
NotebookClient(notebook, kernel_name='python3', timeout=90,
               resources={'metadata': {'path': str(ROOT)}}).execute()
output = ''.join(o.get('text', '') for o in notebook.cells[-1].outputs)
checks = json.loads(output.split('DISPLAY_STABILITY_RESULTS=')[1].splitlines()[0])
record = {'utc': datetime.now(timezone.utc).isoformat(), 'status': 'pass',
          'checks': checks, 'training_started': False, 'live_run_files_written': False}
nbf.write(notebook, ROOT / 'display_stability_verification.ipynb')
(ROOT / 'display_stability_verification.json').write_text(
    json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False))
