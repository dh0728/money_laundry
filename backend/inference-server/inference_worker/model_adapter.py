"""Model integration point: runs the model package bound to the request's versions."""
import pyarrow as pa

from common.model_contract import ModelExecutionError
from common.worker_transport import ProtocolError
from models import registry


def run_model(inputs, model_kind, *, model_version, feature_version):
    """Return a score table, or raise the structured model-team exception.

    inputs maps each input file name (targets, transactions, accounts) to its table; a bare
    table is the targets file alone. A model that reads the materials defines
    calculate_inputs(inputs, ...); otherwise calculate receives the targets table.
    """
    try:
        if isinstance(inputs, pa.Table):
            inputs = {"targets": inputs}
        package = registry.require(model_version, feature_version)
        bundle = getattr(package.model, "calculate_inputs", None)
        if bundle is not None:
            return bundle(inputs, model_kind, model_version=model_version, feature_version=feature_version)
        return package.model.calculate(inputs["targets"], model_kind, model_version=model_version,
                                       feature_version=feature_version)
    except ModelExecutionError:
        raise
    except ProtocolError:
        raise ModelExecutionError("INPUT_INVALID", "VALIDATE_INPUT") from None
    except MemoryError:
        raise ModelExecutionError("HOST_OUT_OF_MEMORY", "INFERENCE") from None
    except Exception:
        raise ModelExecutionError("MODEL_EXECUTION_FAILED", "INFERENCE") from None
