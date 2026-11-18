"""Freeze new run contracts; preserve prior experiments without importing weights."""
from contextlib import contextmanager
from pathlib import Path
from dataclasses import asdict
import ast,fcntl,hashlib,inspect,json,textwrap


def source_manifest():
    from fraudgt_lab import EXPERIMENT_ROOT
    from fraudgt_lab.config import digest
    files=list((EXPERIMENT_ROOT/'fraudgt_lab').glob('*.py'))+list((EXPERIMENT_ROOT/'fraudgt_lab').glob('*.c'))
    files += [EXPERIMENT_ROOT/name for name in ['configure.py','corrected_runtime.py','run_corrected.py']]
    return {str(p.relative_to(EXPERIMENT_ROOT)):digest(p) for p in sorted(files)}


def visible_functions(namespace=None):
    from fraudgt_lab.models import FraudGTBlock,FraudGT,make_model
    from fraudgt_lab.config import TrainConfig
    from fraudgt_lab.data import FeatureAdapter
    from fraudgt_lab.population import PopulationStream,Labels,temporal_boundaries
    from fraudgt_lab.official_loader import PeriodGraph,relations_for
    from fraudgt_lab.optimization import class_weighted_loss,make_optimizer
    from fraudgt_lab.metrics import EpochMetrics
    from fraudgt_lab.training import EpochProgressReporter,sample_next,graph_chunks,combine_batch_gradients,train_one_epoch,evaluate_one_epoch,history_row,estimate_eta,run_variant
    functions={fn.__name__:fn for fn in [make_model,temporal_boundaries,relations_for,class_weighted_loss,make_optimizer,sample_next,
                graph_chunks,combine_batch_gradients,train_one_epoch,evaluate_one_epoch,history_row,estimate_eta,run_variant]}
    classes=[FraudGTBlock,FraudGT,FeatureAdapter,PopulationStream,Labels,PeriodGraph,EpochMetrics,EpochProgressReporter]
    if namespace is not None:
        functions={name:namespace[name] for name in functions};classes=[namespace[c.__name__] for c in classes]
    for cls in classes:
        for name,method in vars(cls).items():
            if isinstance(method,classmethod):method=method.__func__
            if inspect.isfunction(method):functions[cls.__name__+'.'+name]=method
    return functions


def fingerprint(functions):
    return {name:hashlib.sha256(ast.dump(ast.parse(textwrap.dedent(inspect.getsource(fn)))).encode()).hexdigest()
            for name,fn in functions.items()}


@contextmanager
def run_lock():
    from fraudgt_lab import RUN_ROOT
    with (RUN_ROOT/'run.lock').open('a+') as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as error:raise RuntimeError('이 실행은 이미 학습 중입니다. 조회 모드를 사용하세요.') from error
        try:yield
        finally:fcntl.flock(handle,fcntl.LOCK_UN)


def require_verification():
    from fraudgt_lab import EXPERIMENT_ROOT
    value=json.loads((EXPERIMENT_ROOT/'verification.json').read_text())
    assert value['status']=='pass' and value['source_sha256']==source_manifest(),'현재 코드의 검증 기록이 필요합니다.'


def prepare(config,overrides=None):
    from fraudgt_lab import EXPERIMENT_ROOT,RUN_ROOT
    from fraudgt_lab.config import protocol,digest
    from fraudgt_lab.population import prepare_population,Labels
    from fraudgt_lab.storage import write_json,log
    prepare_population();Labels()
    source_functions=fingerprint(visible_functions())
    if overrides is not None:assert fingerprint(overrides)==source_functions,'노트북과 검증된 실행 코드가 다릅니다.'
    contracts={'protocol.json':protocol(config),'code_manifest.json':source_manifest(),
               'notebook_contract.json':{'training':asdict(config),'callable_ast_sha256':source_functions}}
    for name,value in contracts.items():
        path=RUN_ROOT/name
        if path.exists():assert json.loads(path.read_text())==json.loads(json.dumps(value)),'조건 변경 시 새 RUN_NAME을 사용하세요.'
        else:write_json(path,value)
    log('corrected_protocol_verified',graph_mode=config.graph_mode,protocol_sha256=digest(RUN_ROOT/'protocol.json'))
    return contracts['protocol.json']
