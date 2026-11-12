"""The one place that decides which model runs for the versions a request carries.

To plug in a model: add a package under models/ with spec and model modules and list
it in MODELS. The backend binds versions when a run starts; a replaced model's package is
removed, so a run still bound to it cannot resume and needs a new run.
"""
from common.worker_transport import ProtocolError
from models.demo_random import model as demo_model, spec as demo_spec
from models.multi_fraudgt_hgb import model as multi_fraudgt_hgb_model, spec as multi_fraudgt_hgb_spec
from models.salt_r import model as salt_r_model, spec as salt_r_spec


class ModelPackage:
    def __init__(self, name, spec, model):
        self.name, self.spec, self.model = name, spec, model


MODELS = (ModelPackage("demo_random", demo_spec, demo_model),
          ModelPackage("multi_fraudgt_hgb", multi_fraudgt_hgb_spec, multi_fraudgt_hgb_model),
          ModelPackage("salt_r", salt_r_spec, salt_r_model))


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
