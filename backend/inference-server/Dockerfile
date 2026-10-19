# syntax=docker/dockerfile:1
# Build context: backend/inference-server. Used by the local demo stack; the shared
# inference server runs this folder directly (see README.md).
FROM python:3.13-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    INFERENCE_STATE_DIR=/state \
    INFERENCE_BIND=0.0.0.0 \
    INFERENCE_PORT=8090

WORKDIR /app/inference-server
COPY requirements.txt requirements-models.txt ./
# CPU torch for the local demo stack; the shared GPU server installs its own build (README).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.10.0 \
    && pip install --no-cache-dir -r requirements-models.txt \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /state \
    && chown app:app /state

COPY inference_server.py ./
COPY inference_worker ./inference_worker
COPY models ./models
COPY common ./common
RUN python -c "import inference_server, inference_worker.inference_compute, models.registry, models.binary_v10.network, models.binary_v10.preprocess"

USER app:app
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3).close()"
ENTRYPOINT ["python", "-B", "/app/inference-server/inference_server.py"]
