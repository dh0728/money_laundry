"""Validate the layout with isolated runs; never start the user's training."""
from configure import configure
ROOT, _ = configure('lesson_layout_verification')
import ast
import hashlib
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import nbformat as nbf
from nbclient import NotebookClient
from corrected_runtime import source_manifest
from fraudgt_lab.storage import write_json
from fraudgt_lab.config import digest

manifest = json.loads((ROOT/'lesson_layout_manifest.json').read_text())
assert source_manifest() == manifest['source_sha256_before']
os.environ['JUPYTER_PATH'] = str(ROOT/'kernel_specs') + os.pathsep + os.environ.get('JUPYTER_PATH', '')
records = []
for row in manifest['notebooks']:
    started = time.monotonic()
    path = Path(row['path'])
    notebook = nbf.read(path, as_version=4)
    expected_hash = digest(path)
    for i, cell in enumerate(notebook.cells):
        if cell.cell_type == 'code':
            compile(cell.source, path.name+':'+str(i), 'exec')
        if 'lesson-settings' in cell.metadata.get('tags', []):
            lines = cell.source.splitlines()
            replacements = {
                'RUN_NAME': repr('layout_test_'+row['mode']+'_'+str(time.time_ns())),
                'RUN_TRAINING': 'False', 'FOLLOW_ACTIVE_TRAINING': 'False',
            }
            for j, line in enumerate(lines):
                key = line.split('=')[0].strip()
                if key in replacements:
                    lines[j] = key+' = '+replacements[key]
            cell.source = '\n'.join(lines)
    notebook.cells.append(nbf.v4.new_code_cell('''
from lesson_runtime import prediction_frame
from fraudgt_lab.config import TrainConfig
assert CONFIG == TrainConfig(graph_mode="MODE_VALUE")
assert not RUN_TRAINING and not FOLLOW_ACTIVE_TRAINING
assert not (RUN_ROOT / "models").exists()
assert h_df.empty and pred_df.empty
assert sample_stats["disjoint"] == (CONFIG.graph_mode == "disjoint")
assert sample_stats["relations"] == 1
assert sample_stats["targets"] == 8
assert backend_info["sampling_check"] == "PASS"
assert backend_info["python"] == "/usr/bin/python"
# Missing and reordered predictions keep their original transaction/label rows.
frame = prediction_frame(
    np.array([10, 20, 30]), np.array([0, 9, 1]),
    np.array([2, 0, 1]), np.array([2, 0]), np.array([2.0, -2.0]),
)
assert frame.transaction_id.tolist() == [10, 20, 30]
assert frame.scored.tolist() == [False, True, True]
assert pd.isna(frame.loc[0, "predicted_label"])
assert frame.loc[1, "predicted_label"] == 1 and bool(frame.loc[1, "correct"])
assert frame.loc[2, "predicted_label"] == 0 and not bool(frame.loc[2, "correct"])
assert not prediction_frame(np.array([1]), np.array([0]), [], [], []).scored.any()
print("LAYOUT_FULL_EXECUTION_PASS")
'''.replace('MODE_VALUE', row['mode'])))
    try:
        NotebookClient(notebook, timeout=180, kernel_name=notebook.metadata.kernelspec.name,
                       resources={'metadata': {'path': str(path.parent)}}).execute()
    except BaseException:
        nbf.write(notebook, ROOT/(row['mode']+'_lesson_failed.ipynb'))
        raise
    assert digest(path) == expected_hash, 'Notebook was saved by another editor during verification.'
    nbf.write(notebook, ROOT/(row['mode']+'_lesson_verified.ipynb'))
    result = {'mode': row['mode'], 'utc': datetime.now(timezone.utc).isoformat(), 'status': 'pass',
              'seconds': time.monotonic()-started, 'cells': len(notebook.cells)-1,
              'kernel_name': notebook.metadata.kernelspec.name, 'python': '/usr/bin/python',
              'fresh_kernel_all_cells': True, 'real_eight_target_graph': True,
              'training_started': False, 'prediction_row_alignment': True,
              'source_sha256_unchanged': source_manifest()==manifest['source_sha256_before'],
              'notebook_sha256': expected_hash}
    records.append(result)
    print(json.dumps(result), flush=True)
write_json(ROOT/'lesson_layout_verification.json', {'status': 'pass', 'cases': records,
    'source_sha256': source_manifest(), 'helper_sha256': digest(ROOT/'lesson_runtime.py')})
