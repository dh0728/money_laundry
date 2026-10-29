"""The one place that decides which model versions each model kind is bound to.

The backend only prepares inputs; models run on the inference server
(backend/inference-server, models/registry.py there). To plug in a new model: add a
package here with spec and build_input modules, list it in MODELS, point the model kind
at it in DEFAULTS, and add the matching model package on the inference server.
Runs keep the versions bound when they were created, so older packages stay listed
while their runs can still resume.
"""
from common.worker_transport import ProtocolError
from models import alert_type_tree, binary_v10, demo_random
from models.alert_type_tree import build_input as alert_type_tree_input, spec as alert_type_tree_spec
from models.binary_v10 import build_input as binary_v10_input, spec as binary_v10_spec
from models.demo_random import build_input as demo_input, spec as demo_spec


class ModelPackage:
    def __init__(self, name, spec, build_input):
        self.name, self.spec, self.build_input = name, spec, build_input

    def versions(self):
        return self.spec.MODEL_VERSION, self.spec.FEATURE_VERSION


DEMO_RANDOM = ModelPackage(demo_random.__name__, demo_spec, demo_input)
BINARY_V10 = ModelPackage(binary_v10.__name__, binary_v10_spec, binary_v10_input)
ALERT_TYPE_TREE = ModelPackage(alert_type_tree.__name__, alert_type_tree_spec, alert_type_tree_input)
MODELS = (DEMO_RANDOM, BINARY_V10, ALERT_TYPE_TREE)
# The binary model scores transactions (모델 입력 준비); the type model classifies Alerts (Alert 유형 분류).
DEFAULTS = {"BINARY": BINARY_V10, "TYPE": ALERT_TYPE_TREE}


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
