"""Model-team exception contract and worker-owned retry policy (v1)."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorRule:
    stages: tuple[str, ...]
    action: str
    message: str
    retry: bool = False


MODEL_ERRORS = {
    "INPUT_INVALID": ErrorRule(("VALIDATE_INPUT",), "CORRECT_INPUT", "Model input is invalid."),
    "MODEL_VERSION_MISMATCH": ErrorRule(("LOAD_MODEL",), "CHECK_MODEL_DEPLOYMENT", "Model version does not match."),
    "MODEL_LOAD_FAILED": ErrorRule(("LOAD_MODEL",), "CHECK_MODEL_DEPLOYMENT", "Model could not be loaded."),
    "GPU_OUT_OF_MEMORY": ErrorRule(("LOAD_MODEL", "INFERENCE"), "CHECK_INFERENCE_ENVIRONMENT", "GPU memory was exhausted."),
    "HOST_OUT_OF_MEMORY": ErrorRule(("LOAD_MODEL", "INFERENCE", "POSTPROCESS"), "CHECK_INFERENCE_ENVIRONMENT", "Host memory was exhausted."),
    "MODEL_TEMPORARILY_UNAVAILABLE": ErrorRule(("LOAD_MODEL", "INFERENCE"), "CHECK_INFERENCE_ENVIRONMENT", "Model is temporarily unavailable.", True),
    "MODEL_OUTPUT_INVALID": ErrorRule(("POSTPROCESS",), "CHECK_MODEL_OUTPUT", "Model output violates the result contract."),
    "MODEL_EXECUTION_FAILED": ErrorRule(("LOAD_MODEL", "INFERENCE", "POSTPROCESS"), "INSPECT_MODEL_FAILURE", "Model execution failed for an unknown reason."),
}


class ModelExecutionError(Exception):
    """Raise only after owned model work has stopped; never include raw exception text."""

    def __init__(self, code: str, stage: str):
        rule = MODEL_ERRORS.get(code)
        if rule is None or stage not in rule.stages:
            raise ValueError("Invalid model error contract")
        self.code, self.stage = code, stage
        super().__init__(rule.message)

    def document(self):
        return {"error_contract_version": 1, "code": self.code, "stage": self.stage,
                "message": MODEL_ERRORS[self.code].message}

    @classmethod
    def from_document(cls, document):
        if (not isinstance(document, dict)
                or set(document) != {"error_contract_version", "code", "stage", "message"}
                or type(document["error_contract_version"]) is not int
                or document["error_contract_version"] != 1
                or not all(isinstance(document[k], str) for k in ("code", "stage", "message"))
                or len(document["message"]) > 256):
            raise ValueError("Invalid model error contract")
        # Do not persist untrusted free text, even from the model process.
        return cls(document["code"], document["stage"])


def model_failure(error):
    return {"status": "FAILED", "error_code": error.code, "model_error": error.document()}


def retry_decision(outcome, model_failures, transfer_failures):
    """Return domain, delay or None, action; a child retryable flag is not authority."""
    if "model_error" in outcome:
        error = ModelExecutionError.from_document(outcome["model_error"])
        if outcome.get("error_code") != error.code:
            raise ValueError("Model error code mismatch")
        rule = MODEL_ERRORS[error.code]
        delay = (60, 300)[model_failures - 1] if rule.retry and 1 <= model_failures < 3 else None
        return "MODEL", delay, "NONE" if delay is not None else rule.action
    code = outcome.get("error_code")
    if code == "TRANSFER_UNAVAILABLE":
        delay = (30, 120)[transfer_failures - 1] if 1 <= transfer_failures < 3 else None
        return "TRANSFER", delay, "NONE" if delay is not None else "CHECK_STORAGE_CONNECTIVITY"
    actions = {
        "TRANSFER_ACCESS_DENIED": "REFRESH_ACCESS_OR_CHECK_PERMISSION",
        "INPUT_OR_MODEL_INVALID": "INSPECT_INPUT_OR_ARTIFACT",
        "MODEL_PROCESS_FAILED": "INSPECT_PROCESS_EXIT",
        "MODEL_PROTOCOL_INVALID": "CHECK_MODEL_ADAPTER",
        "MODEL_PROCESS_UNAVAILABLE": "CHECK_INFERENCE_ENVIRONMENT",
    }
    return "WORKER", None, actions.get(code, "INSPECT_WORKER_FAILURE")
