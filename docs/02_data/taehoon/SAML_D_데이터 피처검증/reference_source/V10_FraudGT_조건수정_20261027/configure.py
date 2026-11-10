"""Set local, portable input paths before importing the training package."""
from pathlib import Path
import os
import sys


def configure(run_name='shared_corrected_001'):
    assert run_name and Path(run_name).name == run_name
    root = Path(__file__).resolve().parent
    project = (root / 'project').resolve()
    run = Path(os.environ.get('FRAUDGT_CORRECTED_OUTPUT', root / 'runs')) / run_name
    run = run.resolve()
    loaded = sys.modules.get('fraudgt_lab')
    if loaded is not None and (loaded.RUN_ROOT != run or loaded.EXPERIMENT_ROOT != root):
        raise RuntimeError('다른 실험이 로드되어 있습니다. 새 커널에서 실행하세요.')
    run.mkdir(parents=True, exist_ok=True)
    os.environ['AML_PROJECT_ROOT'] = str(project)
    os.environ['AML_RUN_DIR'] = str(run)
    for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
        os.environ.setdefault(key, '2')
    for path in (root, project / 'feature_dependency/_deps',
                 project / 'experiments/v10_gnn_verify_20261025/runtime_deps'):
        sys.path.insert(0, str(path))
    return root, run
