# syntax=docker/dockerfile:1

FROM eclipse-temurin:21-jdk-noble AS builder

WORKDIR /workspace

# Gradle 관련 파일을 먼저 복사해 의존성 레이어를 캐시한다.
COPY gradlew gradlew
COPY gradle gradle
COPY build.gradle settings.gradle ./

RUN chmod +x gradlew \
    && ./gradlew dependencies --no-daemon

COPY src src

RUN ./gradlew bootJar --no-daemon \
    && JAR_FILE="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' -print -quit)" \
    && test -n "$JAR_FILE" \
    && cp "$JAR_FILE" /workspace/app.jar

FROM eclipse-temurin:21-jre-noble AS java-runtime

FROM python:3.13-slim-trixie AS runtime

ENV JAVA_HOME=/opt/java/openjdk \
    PATH="/opt/java/openjdk/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WORKER_PYTHON=/usr/local/bin/python \
    WORKER_SCRIPT=/app/worker/analysis_entry.py \
    STORAGE_DIR=/app/storage

COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk

WORKDIR /app

# Java 런타임 라이브러리와 Actuator 상태 검사 도구.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates libstdc++6 zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt /app/worker/requirements.txt
RUN pip install --no-cache-dir -r /app/worker/requirements.txt \
    && java -version \
    && python -c "import psycopg, pyarrow, httpx, boto3"

# 애플리케이션을 root가 아닌 전용 사용자로 실행한다.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/storage \
    && chown app:app /app/storage

COPY worker/analysis_entry.py worker/frozen_input.py worker/pipeline.py \
     worker/model_publication.py worker/inference_dispatch.py worker/result_collection.py \
     worker/demo_calculator.py worker/model_contract.py worker/worker_transport.py \
     worker/alert_builder.py /app/worker/

COPY --from=builder --chown=app:app /workspace/app.jar /app/app.jar

USER app:app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
