#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.yaml"
INFRA_COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.infra.yaml"
LOCAL_ENV_FILE="${DEPLOY_DIR}/.env.prod"
SHARED_ENV_FILE="/opt/aml/shared/.env.prod"

if [[ -f "${SHARED_ENV_FILE}" ]]; then
  ENV_FILE="${SHARED_ENV_FILE}"
else
  ENV_FILE="${LOCAL_ENV_FILE}"
fi

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PARAMETER_PREFIX="/aml/prod"

GIT_SHA="${1:-${GIT_SHA:-}}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "${GIT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
  || fail "전체 40자리 Git SHA가 필요합니다. 사용법: ./deploy-prod.sh <Git SHA>"

get_parameter() {
  local parameter_name="$1"
  local parameter_value

  parameter_value="$(
    aws ssm get-parameter \
      --name "${PARAMETER_PREFIX}/${parameter_name}" \
      --with-decryption \
      --region "${AWS_REGION}" \
      --query "Parameter.Value" \
      --output text
  )"

  if [[ -z "${parameter_value}" || "${parameter_value}" == "None" ]]; then
    fail "Parameter Store 값을 조회하지 못했습니다: ${PARAMETER_PREFIX}/${parameter_name}"
  fi

  printf '%s' "${parameter_value}"
}

cleanup() {
  unset PROD_DB_URL
  unset PROD_POSTGRES_USER
  unset PROD_POSTGRES_PASSWORD
  unset PROD_JWT_SECRET
  unset PROD_S3_BUCKET
  unset PROD_S3_PREFIX
  unset PROD_SQS_URL
  unset PROD_API_IMAGE
  unset PROD_WEB_IMAGE
}

trap cleanup EXIT

command -v aws >/dev/null 2>&1 \
  || fail "AWS CLI가 설치되어 있지 않습니다."

command -v docker >/dev/null 2>&1 \
  || fail "Docker가 설치되어 있지 않습니다."

docker info >/dev/null 2>&1 \
  || fail "Docker가 실행 중이 아니거나 현재 사용자에게 Docker 권한이 없습니다."

[[ -f "${COMPOSE_FILE}" ]] \
  || fail "Compose 파일이 없습니다: ${COMPOSE_FILE}"

[[ -f "${INFRA_COMPOSE_FILE}" ]] \
  || fail "Infra Compose 파일이 없습니다: ${INFRA_COMPOSE_FILE}"

[[ -f "${ENV_FILE}" ]] \
  || fail "환경변수 파일이 없습니다: ${ENV_FILE}"

AWS_ACCOUNT_ID="$(
  aws sts get-caller-identity \
    --region "${AWS_REGION}" \
    --query "Account" \
    --output text
)"

[[ "${AWS_ACCOUNT_ID}" =~ ^[0-9]{12}$ ]] \
  || fail "AWS 계정 ID를 확인하지 못했습니다."

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_TAG="prod-${GIT_SHA}"

PROD_API_IMAGE="${ECR_REGISTRY}/aml-api:${IMAGE_TAG}"
PROD_WEB_IMAGE="${ECR_REGISTRY}/aml-web:${IMAGE_TAG}"

export PROD_API_IMAGE
export PROD_WEB_IMAGE

echo "prod Parameter Store 값을 조회합니다."

PROD_DB_URL="$(get_parameter "db/url")"
PROD_POSTGRES_USER="$(get_parameter "db/username")"
PROD_POSTGRES_PASSWORD="$(get_parameter "db/password")"
PROD_JWT_SECRET="$(get_parameter "jwt/secret")"
PROD_S3_BUCKET="$(get_parameter "s3/bucket")"
PROD_S3_PREFIX="$(get_parameter "s3/prefix")"
PROD_SQS_URL="$(get_parameter "sqs/url")"

export PROD_DB_URL
export PROD_POSTGRES_USER
export PROD_POSTGRES_PASSWORD
export PROD_JWT_SECRET
export PROD_S3_BUCKET
export PROD_S3_PREFIX
export PROD_SQS_URL

echo "Amazon ECR에 로그인합니다."

aws ecr get-login-password \
  --region "${AWS_REGION}" |
  docker login \
    --username AWS \
    --password-stdin "${ECR_REGISTRY}"

echo "prod Infra Compose 설정을 검증합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${INFRA_COMPOSE_FILE}" \
  config --quiet

echo "prod 애플리케이션 Compose 설정을 검증합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  config --quiet

echo "prod PostgreSQL Infra를 먼저 실행합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${INFRA_COMPOSE_FILE}" \
  up -d postgres

echo "prod PostgreSQL이 준비될 때까지 기다립니다."

POSTGRES_READY=false

for attempt in {1..30}; do
  if docker compose \
    --env-file "${ENV_FILE}" \
    -f "${INFRA_COMPOSE_FILE}" \
    exec -T postgres \
    sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    >/dev/null 2>&1; then
    POSTGRES_READY=true
    break
  fi

  sleep 2
done

if [[ "${POSTGRES_READY}" != "true" ]]; then
  docker compose \
    --env-file "${ENV_FILE}" \
    -f "${INFRA_COMPOSE_FILE}" \
    ps postgres

  fail "prod PostgreSQL이 제한 시간 안에 준비되지 않았습니다."
fi

echo "prod PostgreSQL 준비가 완료되었습니다."

echo "prod ECR 이미지를 내려받습니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  pull api web

echo "prod 애플리케이션 컨테이너를 실행합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  up -d --no-build --pull never

echo "prod PostgreSQL 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${INFRA_COMPOSE_FILE}" \
  ps

echo "prod 애플리케이션 컨테이너 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps
