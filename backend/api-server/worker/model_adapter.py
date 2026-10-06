"""Model integration point. The deployed adapter is currently the approved demo."""
from demo_calculator import calculate
from model_contract import ModelExecutionError
from worker_transport import ProtocolError


def run_model(targets, model_kind, *, model_version, feature_version):
    """Return a score table, or raise the structured model-team exception."""
    try:
        return calculate(targets, model_kind, model_version=model_version,
                         feature_version=feature_version)
    except ModelExecutionError:
        raise
    except ProtocolError:
        raise ModelExecutionError("INPUT_INVALID", "VALIDATE_INPUT") from None
    except MemoryError:
        raise ModelExecutionError("HOST_OUT_OF_MEMORY", "INFERENCE") from None
    except Exception:
        raise ModelExecutionError("MODEL_EXECUTION_FAILED", "INFERENCE") from None
