"""The one place that decides which model versions each model kind is bound to.

The backend only prepares inputs; models run on the inference server
(backend/inference-server, models/registry.py there). To plug in a new model: add a
package here with a spec module and its targets file builder (build_input, or
models/tx_id_targets.py for models that read the materials), list it in MODELS, point the
model kind at it in DEFAULTS, and add the matching model package on the inference server.
Runs keep the versions bound when they were created. A replaced model's package is removed
on both sides, so a run still bound to it cannot resume and needs a new run.
"""
from common.worker_transport import ProtocolError
from models import demo_random, multi_fraudgt_hgb, salt_r, tx_id_targets
from models.demo_random import build_input as demo_input, spec as demo_spec
from models.multi_fraudgt_hgb import spec as multi_fraudgt_hgb_spec
from models.salt_r import spec as salt_r_spec


class ModelPackage:
    def __init__(self, name, spec, build_input):
        self.name, self.spec, self.build_input = name, spec, build_input

    def versions(self):
        return self.spec.MODEL_VERSION, self.spec.FEATURE_VERSION


DEMO_RANDOM = ModelPackage(demo_random.__name__, demo_spec, demo_input)
# Both models read the materials, so their targets file is a tx_id list (models/tx_id_targets.py);
# the type model gets only the suspicious TARGETs (features/prepare_features.py prepare_type).
MULTI_FRAUDGT_HGB = ModelPackage(multi_fraudgt_hgb.__name__, multi_fraudgt_hgb_spec, tx_id_targets)
SALT_R = ModelPackage(salt_r.__name__, salt_r_spec, tx_id_targets)
MODELS = (DEMO_RANDOM, MULTI_FRAUDGT_HGB, SALT_R)
DEFAULTS = {"BINARY": MULTI_FRAUDGT_HGB, "TYPE": SALT_R}


def default(model_kind):
    """Package used when a new run binds its models."""
    try:
        return DEFAULTS[model_kind.upper()]
    except (KeyError, AttributeError):
        raise ProtocolError("Unsupported model kind") from None


def find(model_version, feature_version):
    """Package that accepts the versions a run was bound to, or None."""
    return next((package for package in MODELS
                 if package.spec.supported_versions(model_version, feature_version)), None)


def supported_versions(model_version, feature_version):
    return find(model_version, feature_version) is not None


def require(model_version, feature_version):
    package = find(model_version, feature_version)
    if package is None:
        raise ProtocolError("Unsupported model versions")
    return package
