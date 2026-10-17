"""Model integration point: runs the model package bound to the request's versions."""
from common.model_contract import ModelExecutionError
from common.worker_transport import ProtocolError
from models import registry


def run_model(targets, model_kind, *, model_version, feature_version):
    """Return a score table, or raise the structured model-team exception."""
    try:
        package = registry.require(model_version, feature_version)
        return package.model.calculate(targets, model_kind, model_version=model_version,
                                       feature_version=feature_version)
    except ModelExecutionError:
        raise
    except ProtocolError:
        raise ModelExecutionError("INPUT_INVALID", "VALIDATE_INPUT") from None
    except MemoryError:
        raise ModelExecutionError("HOST_OUT_OF_MEMORY", "INFERENCE") from None
    except Exception:
        raise ModelExecutionError("MODEL_EXECUTION_FAILED", "INFERENCE") from None
