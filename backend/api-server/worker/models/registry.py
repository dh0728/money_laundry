"""The one place that decides which model package each model kind runs.

To plug in a new model: add a package under models/ with spec, build_input and
model modules, list it in MODELS, and point the model kind at it in DEFAULTS.
Runs keep the versions bound when they were created, so older packages stay listed
while their runs can still resume.
"""
from common.worker_transport import ProtocolError
from models import demo_random
from models.demo_random import build_input as demo_input, model as demo_model, spec as demo_spec


class ModelPackage:
    def __init__(self, name, spec, build_input, model):
        self.name, self.spec, self.build_input, self.model = name, spec, build_input, model

    def versions(self):
        return self.spec.MODEL_VERSION, self.spec.FEATURE_VERSION


DEMO_RANDOM = ModelPackage(demo_random.__name__, demo_spec, demo_input, demo_model)
MODELS = (DEMO_RANDOM,)
DEFAULTS = {"BINARY": DEMO_RANDOM, "TYPE": DEMO_RANDOM}


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
