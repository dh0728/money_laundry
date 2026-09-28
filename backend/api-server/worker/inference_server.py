"""The single public entry point of the KubeSphere inference worker."""
from contextlib import asynccontextmanager
from datetime import datetime
import hmac
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request as HttpRequest
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from demo_calculator import FEATURE_VERSION, MODEL_VERSION
from inference_compute import check_url, request_from
from inference_service import Conflict, InferenceService, NotFound, Settings
from worker_transport import ProtocolError


def valid_endpoint(url, loopback=False):
    parsed = urlsplit(url)
    if (parsed.username or parsed.password or parsed.fragment or not parsed.hostname
            or (parsed.scheme != "https" and not (
                loopback and parsed.scheme == "http" and parsed.hostname == "127.0.0.1"))):
        raise ValueError("HTTPS endpoint required")


def create_app(settings: Settings):
    if len(settings.token) < 32 or settings.max_input_bytes < 1:
        raise ValueError("Inference settings are incomplete")
    valid_endpoint(settings.object_base_url, settings.allow_loopback)
    if not settings.object_base_url.endswith("/") or urlsplit(settings.object_base_url).query:
        raise ValueError("Object base must end in a slash and have no query")
    if settings.callback_url:
        valid_endpoint(settings.callback_url, settings.allow_loopback)
        if not settings.callback_token or len(settings.callback_token) < 32:
            raise ValueError("Callback authentication required")
    service = InferenceService(settings)

    @asynccontextmanager
    async def lifespan(app):
        service.start()
        try:
            yield
        finally:
            service.close()

    app = FastAPI(title="AML inference worker", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service

    async def authenticate(request: HttpRequest):
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(),
                                   ("Bearer " + settings.token).encode()):
            raise HTTPException(401, "UNAUTHORIZED")
        if not service.engine or not service.engine.is_alive():
            raise HTTPException(503, "WORKER_UNAVAILABLE")

    async def payload(request):
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > 65536:
                raise HTTPException(413, "REQUEST_TOO_LARGE")
        import json
        try:
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ValueError()
            return result
        except (ValueError, UnicodeError):
            raise HTTPException(422, "INVALID_REQUEST") from None

    def validate_identity(body, request_id, execution_round):
        if (type(body.get("contract_version")) is not int or body["contract_version"] != 2
                or body.get("request_id") != str(request_id)
                or type(body.get("execution_round")) is not int
                or body["execution_round"] != execution_round or not 1 <= execution_round <= 2**31 - 1
                or type(body.get("job_id")) is not int or not 0 < body["job_id"] <= 2**63 - 1
                or body.get("model_kind") not in ("BINARY", "TYPE")
                or str(UUID(body["run_id"])) != body["run_id"]):
            raise ValueError()

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse({"error": "INVALID_REQUEST"}, status_code=422)

    @app.exception_handler(Conflict)
    async def conflict(request, error):
        return JSONResponse({"error": "REQUEST_CONFLICT"}, status_code=409)

    @app.exception_handler(NotFound)
    async def missing(request, error):
        return JSONResponse({"error": "REQUEST_NOT_FOUND"}, status_code=404)

    @app.get("/health")
    def health():
        healthy = service.engine and service.engine.is_alive()
        return JSONResponse({"status": "UP" if healthy else "DOWN"}, status_code=200 if healthy else 503)

    path = "/api/v1/inference-requests/{request_id}/rounds/{execution_round}"

    @app.put(path, dependencies=[Depends(authenticate)])
    async def submit(request_id: UUID, execution_round: int, request: HttpRequest):
        body = await payload(request)
        try:
            validate_identity(body, request_id, execution_round)
            if (body.get("model_version") != MODEL_VERSION or body.get("feature_version") != FEATURE_VERSION
                    or not re.fullmatch("[0-9a-f]{64}", body.get("manifest_sha256", ""))
                    or set(body.get("result_urls", {})) != {"scores.parquet", "result.json"}):
                raise ValueError()
            allowed = {"contract_version", "job_id", "run_id", "model_kind", "request_id", "execution_round",
                       "model_version", "feature_version", "manifest_sha256", "manifest_url", "input_url", "result_urls"}
            if set(body) != allowed:
                raise ValueError()
            logical = request_from(body)
            check_url(body["manifest_url"], settings.object_base_url, logical.manifest)
            check_url(body["input_url"], settings.object_base_url, logical.inputs + "targets.parquet")
            for name, url in body["result_urls"].items():
                check_url(url, settings.object_base_url, logical.output + name)
        except (ValueError, TypeError, KeyError, AttributeError, ProtocolError):
            raise HTTPException(422, "INVALID_REQUEST") from None
        view, created = service.submit(body)
        return JSONResponse(view, status_code=202 if created else 200)

    @app.get(path, dependencies=[Depends(authenticate)])
    def status(request_id: UUID, execution_round: int):
        return service.get((str(request_id), execution_round))

    @app.put(path + "/cancellation", dependencies=[Depends(authenticate)])
    async def cancel(request_id: UUID, execution_round: int, request: HttpRequest):
        body = await payload(request)
        try:
            validate_identity(body, request_id, execution_round)
            if (str(UUID(body["cancel_id"])) != body["cancel_id"]
                    or body["reason_code"] != "REPORT_CORRECTED"
                    or datetime.fromisoformat(body["requested_at"].replace("Z", "+00:00")).utcoffset() is None
                    or set(body) != {"contract_version", "job_id", "run_id", "model_kind", "request_id",
                                     "execution_round", "cancel_id", "reason_code", "requested_at"}):
                raise ValueError()
        except (ValueError, TypeError, KeyError, AttributeError):
            raise HTTPException(422, "INVALID_REQUEST") from None
        view = service.cancel(body)
        return JSONResponse(view, status_code=200 if view.get("cancellation_status") else 202)

    return app


def main():
    import uvicorn
    settings = Settings(Path(os.environ["INFERENCE_STATE_DIR"]), os.environ["INFERENCE_TOKEN"],
                        os.environ["INFERENCE_OBJECT_BASE_URL"], os.environ.get("INFERENCE_CALLBACK_URL"),
                        os.environ.get("INFERENCE_CALLBACK_TOKEN"))
    uvicorn.run(create_app(settings), host=os.environ.get("INFERENCE_BIND", "127.0.0.1"),
                port=int(os.environ.get("INFERENCE_PORT", "8090")), workers=1, access_log=False)


if __name__ == "__main__":
    main()
