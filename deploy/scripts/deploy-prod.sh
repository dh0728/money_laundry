#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.yaml"
ENV_FILE="${DEPLOY_DIR}/.env.prod"

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PARAMETER_PREFIX="/aml/prod"

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
  unset PROD_DB_URL
  unset PROD_POSTGRES_USER
  unset PROD_POSTGRES_PASSWORD
  unset PROD_JWT_SECRET
  unset PROD_S3_BUCKET
  unset PROD_S3_PREFIX
  unset PROD_SQS_URL
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

echo "prod Compose 설정을 검증합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  config --quiet

echo "prod 컨테이너를 빌드하고 실행합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  up -d --build

echo "prod 컨테이너 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps
