"""Resume the existing notebook kernel, using its unchanged saved training protocol."""
from pathlib import Path
from datetime import datetime, timezone
import json
import time
import argparse

from jupyter_client import BlockingKernelClient

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--recovery-record', default='cpu_memory_recovery_20261028.json')
args = parser.parse_args()
RECORD = ROOT / args.recovery_record
record = json.loads(RECORD.read_text())
connection = Path('/workspace/.local/share/jupyter/runtime') / f"kernel-{record['kernel_id']}.json"
client = BlockingKernelClient(connection_file=str(connection))
client.load_connection_file()
client.start_channels()

bootstrap = f'''
from pathlib import Path
import sys, json, traceback
EXPERIMENT_ROOT = Path({str(ROOT)!r})
sys.path.insert(0, str(EXPERIMENT_ROOT))
from configure import configure
EXPERIMENT_ROOT, RUN_ROOT = configure('shared_corrected_001')
from fraudgt_lab.config import TrainConfig, VARIANTS
from fraudgt_lab.training import run_variant, finish_evaluation
from fraudgt_lab.storage import log
from corrected_runtime import run_lock, require_verification, prepare
from lesson_runtime import LearningCallbacks, history_frame
CONFIG = TrainConfig(**json.loads((RUN_ROOT / 'protocol.json').read_text())['training'])
assert CONFIG.graph_mode == 'shared'
require_verification()
callbacks = LearningCallbacks(RUN_ROOT, CONFIG, refresh_seconds=2)
MODEL_NAMES = list(VARIANTS)
history_by_model = {{}}
training_finished = False
'''
training = '''
with run_lock():
    require_verification()
    prepare(CONFIG)
    callbacks.start()
    try:
        for model_name in MODEL_NAMES:
            run_variant(CONFIG, model_name,
                        on_epoch=callbacks.on_epoch, on_progress=callbacks.on_progress)
            history_by_model[model_name] = history_frame(RUN_ROOT, model_name)
        training_finished = True
        final_result = finish_evaluation(CONFIG)
    except BaseException:
        log('corrected_execution_interrupted', traceback=traceback.format_exc(),
            checkpoint='last completed optimizer update')
        raise
    finally:
        callbacks.finish()
'''

try:
    client.wait_for_ready(timeout=30)
    message_id = client.execute(bootstrap, allow_stdin=False, stop_on_error=True)
    deadline = time.monotonic() + 60
    while True:
        reply = client.get_shell_msg(timeout=max(0.1, deadline - time.monotonic()))
        if reply.get('parent_header', {}).get('msg_id') == message_id:
            assert reply['content']['status'] == 'ok', reply['content'].get('evalue')
            break
    message_id = client.execute(training, allow_stdin=False, stop_on_error=True)
    record.update(status='resumed_in_existing_notebook_kernel',
                  resume_utc=datetime.now(timezone.utc).isoformat(),
                  execute_message_id=message_id,
                  memory_policy='gc.collect + malloc_trim at phase boundaries and every32 logical batches')
    RECORD.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'kernel_id': record['kernel_id'], 'training_submitted': True,
                      'run': 'shared_corrected_001', 'model_conditions_changed': False}))
finally:
    client.stop_channels()
