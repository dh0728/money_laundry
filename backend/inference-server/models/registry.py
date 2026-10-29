"""The one place that decides which model runs for the versions a request carries.

To plug in a model: add a package under models/ with spec and model modules and list
it in MODELS. The backend binds versions when a run starts; older packages stay listed
while their runs can still resume.
"""
from common.worker_transport import ProtocolError
from models.binary_v10 import model as binary_v10_model, spec as binary_v10_spec
from models.demo_random import model as demo_model, spec as demo_spec


class ModelPackage:
    def __init__(self, name, spec, model):
        self.name, self.spec, self.model = name, spec, model


MODELS = (ModelPackage("demo_random", demo_spec, demo_model),
          ModelPackage("binary_v10", binary_v10_spec, binary_v10_model))


def find(model_version, feature_version):
    """Package that accepts the versions a request was bound to, or None."""
    return next((package for package in MODELS
                 if package.spec.supported_versions(model_version, feature_version)), None)


def supported_versions(model_version, feature_version):
    return find(model_version, feature_version) is not None


def require(model_version, feature_version):
    package = find(model_version, feature_version)
    if package is None:
        raise ProtocolError("Unsupported model versions")
    return package
