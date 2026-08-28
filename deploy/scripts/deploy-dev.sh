#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${DEPLOY_DIR}/compose.dev.yaml"
ENV_FILE="${DEPLOY_DIR}/.env.dev"

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PARAMETER_PREFIX="/aml/dev"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

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
  unset DEV_DB_URL
  unset DEV_POSTGRES_USER
  unset DEV_POSTGRES_PASSWORD
  unset DEV_JWT_SECRET
  unset DEV_S3_BUCKET
  unset DEV_S3_PREFIX
  unset DEV_SQS_URL
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

[[ -f "${ENV_FILE}" ]] \
  || fail "환경변수 파일이 없습니다: ${ENV_FILE}"

aws sts get-caller-identity \
  --region "${AWS_REGION}" \
  >/dev/null

echo "dev Parameter Store 값을 조회합니다."

DEV_DB_URL="$(get_parameter "db/url")"
DEV_POSTGRES_USER="$(get_parameter "db/username")"
DEV_POSTGRES_PASSWORD="$(get_parameter "db/password")"
DEV_JWT_SECRET="$(get_parameter "jwt/secret")"
DEV_S3_BUCKET="$(get_parameter "s3/bucket")"
DEV_S3_PREFIX="$(get_parameter "s3/prefix")"
DEV_SQS_URL="$(get_parameter "sqs/url")"

export DEV_DB_URL
export DEV_POSTGRES_USER
export DEV_POSTGRES_PASSWORD
export DEV_JWT_SECRET
export DEV_S3_BUCKET
export DEV_S3_PREFIX
export DEV_SQS_URL

echo "dev Compose 설정을 검증합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  config --quiet

echo "dev 컨테이너를 빌드하고 실행합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  up -d --build

echo "dev 컨테이너 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps