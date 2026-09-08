#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

LEGACY_COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.yaml"
BLUE_COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.blue.yaml"
GREEN_COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.green.yaml"
INFRA_COMPOSE_FILE="${DEPLOY_DIR}/compose.prod.infra.yaml"

NGINX_SOURCE_DIR="${DEPLOY_DIR}/nginx"
NGINX_UPSTREAM_DIR="/etc/nginx/upstreams"
NGINX_ACTIVE_LINK="${NGINX_UPSTREAM_DIR}/prod-active.conf"
NGINX_PROD_CONF="/etc/nginx/conf.d/prod.conf"

STATE_DIR="/opt/aml/state"
ACTIVE_COLOR_FILE="${STATE_DIR}/prod-active-color"
CURRENT_SHA_FILE="${STATE_DIR}/prod-current-sha"
PREVIOUS_SHA_FILE="${STATE_DIR}/prod-previous-sha"
LAST_SUCCESS_FILE="${STATE_DIR}/prod-last-success-at"
LOCK_FILE="${STATE_DIR}/prod-deploy.lock"

LOCAL_ENV_FILE="${DEPLOY_DIR}/.env.prod"
SHARED_ENV_FILE="/opt/aml/shared/.env.prod"

if [[ -f "${SHARED_ENV_FILE}" ]]; then
  ENV_FILE="${SHARED_ENV_FILE}"
else
  ENV_FILE="${LOCAL_ENV_FILE}"
fi

AWS_REGION="${AWS_REGION:-ap-northeast-2}"
PARAMETER_PREFIX="/aml/prod"
PROD_BASE_URL="${PROD_BASE_URL:-https://aiaml.co.kr}"
PROD_DRAIN_SECONDS="${PROD_DRAIN_SECONDS:-30}"

GIT_SHA="${1:-${GIT_SHA:-}}"

# 자동 롤백 판단에 사용하는 배포 상태입니다.
TRAFFIC_SWITCHED="false"
DEPLOY_COMMITTED="false"
ROLLBACK_IN_PROGRESS="false"
ACTIVE_WEB_PORT=""
ACTIVE_API_PORT=""
ORIGINAL_ACTIVE_COLOR_FILE_EXISTS="false"
ORIGINAL_CURRENT_SHA_FILE_EXISTS="false"
ORIGINAL_CURRENT_SHA=""

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "${GIT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
  || fail "전체 40자리 Git SHA가 필요합니다."

[[ "${PROD_DRAIN_SECONDS}" =~ ^[0-9]+$ ]] \
  || fail "PROD_DRAIN_SECONDS는 0 이상의 정수여야 합니다."

[[ -d "${STATE_DIR}" ]] \
  || fail "상태 디렉터리가 없습니다: ${STATE_DIR}"

command -v flock >/dev/null 2>&1 \
  || fail "flock이 설치되어 있지 않습니다."

exec 9>"${LOCK_FILE}"

flock -n 9 \
  || fail "다른 prod 배포가 이미 실행 중입니다."


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

rollback_to_previous_slot() {
  local reason="${1:-배포 확정 전 오류}"
  local rollback_failed="false"
  local restored_upstream=""
  local restored_active_color=""
  local restored_current_sha=""
  local target_running_services=""

  if [[ "${TRAFFIC_SWITCHED}" != "true" || "${DEPLOY_COMMITTED}" == "true" ]]; then
    echo "자동 롤백 조건에 해당하지 않습니다: ${reason}" >&2
    return 0
  fi

  if [[ "${ROLLBACK_IN_PROGRESS}" == "true" ]]; then
    echo "자동 롤백이 이미 진행 중입니다." >&2
    return 1
  fi

  ROLLBACK_IN_PROGRESS="true"

  echo "배포 확정 전 오류가 발생하여 기존 Slot으로 복구합니다: ${reason}" >&2

  if [[ -z "${PREVIOUS_UPSTREAM:-}" || ! -f "${PREVIOUS_UPSTREAM}" ]]; then
    echo "복구할 기존 upstream 파일이 없습니다: ${PREVIOUS_UPSTREAM:-없음}" >&2
    rollback_failed="true"
  elif ! ln -sfn "${PREVIOUS_UPSTREAM}" "${NEXT_LINK}"; then
    echo "기존 upstream을 가리키는 임시 링크를 만들지 못했습니다." >&2
    rollback_failed="true"
  elif ! mv -Tf "${NEXT_LINK}" "${NGINX_ACTIVE_LINK}"; then
    echo "기존 upstream으로 활성 링크를 복구하지 못했습니다." >&2
    rollback_failed="true"
  fi

  if [[ "${rollback_failed}" == "false" ]] && ! nginx -t; then
    echo "기존 upstream 복구 후 Nginx 문법 검사가 실패했습니다." >&2
    rollback_failed="true"
  fi

  if [[ "${rollback_failed}" == "false" ]] && ! systemctl reload nginx; then
    echo "기존 upstream으로 Nginx를 Reload하지 못했습니다." >&2
    rollback_failed="true"
  fi

  if [[ "${rollback_failed}" == "false" ]]; then
    restored_upstream="$(readlink -f "${NGINX_ACTIVE_LINK}" || true)"

    if [[ "${restored_upstream}" != "${PREVIOUS_UPSTREAM}" ]]; then
      echo "복구된 upstream이 기존 upstream과 일치하지 않습니다: ${restored_upstream}" >&2
      rollback_failed="true"
    else
      TRAFFIC_SWITCHED="false"
    fi
  fi

  if [[ "${rollback_failed}" == "false" ]]; then
    if [[ "${ORIGINAL_ACTIVE_COLOR_FILE_EXISTS}" == "true" ]]; then
      if [[ ! -f "${ACTIVE_COLOR_FILE}" ]]; then
        echo "롤백 후 활성 Color 상태 파일이 없습니다: ${ACTIVE_COLOR_FILE}" >&2
        rollback_failed="true"
      else
        restored_active_color="$(tr -d '\r\n' < "${ACTIVE_COLOR_FILE}")"

        if [[ "${restored_active_color}" != "${ACTIVE_COLOR}" ]]; then
          echo "롤백 후 활성 Color가 기존 값과 일치하지 않습니다: ${restored_active_color}" >&2
          rollback_failed="true"
        fi
      fi
    elif [[ -e "${ACTIVE_COLOR_FILE}" ]]; then
      echo "롤백 전에는 없던 활성 Color 상태 파일이 생성되었습니다." >&2
      rollback_failed="true"
    fi
  fi

  if [[ "${rollback_failed}" == "false" ]]; then
    if [[ "${ORIGINAL_CURRENT_SHA_FILE_EXISTS}" == "true" ]]; then
      if [[ ! -f "${CURRENT_SHA_FILE}" ]]; then
        echo "롤백 후 현재 SHA 상태 파일이 없습니다: ${CURRENT_SHA_FILE}" >&2
        rollback_failed="true"
      else
        restored_current_sha="$(tr -d '\r\n' < "${CURRENT_SHA_FILE}")"

        if [[ "${restored_current_sha}" != "${ORIGINAL_CURRENT_SHA}" ]]; then
          echo "롤백 후 현재 SHA가 기존 값과 일치하지 않습니다: ${restored_current_sha}" >&2
          rollback_failed="true"
        fi
      fi
    elif [[ -e "${CURRENT_SHA_FILE}" ]]; then
      echo "롤백 전에는 없던 현재 SHA 상태 파일이 생성되었습니다." >&2
      rollback_failed="true"
    fi
  fi

  if [[ "${rollback_failed}" == "false" ]] && ! curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 3 \
    --max-time 5 \
    --retry 5 \
    --retry-delay 1 \
    --retry-all-errors \
    "http://127.0.0.1:${ACTIVE_WEB_PORT}/health" \
    >/dev/null; then
    echo "복구된 기존 Slot의 WEB Health Check가 실패했습니다." >&2
    rollback_failed="true"
  fi

  if [[ "${rollback_failed}" == "false" ]] && ! curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 3 \
    --max-time 5 \
    --retry 5 \
    --retry-delay 1 \
    --retry-all-errors \
    "http://127.0.0.1:${ACTIVE_API_PORT}/actuator/health" \
    >/dev/null; then
    echo "복구된 기존 Slot의 API Health Check가 실패했습니다." >&2
    rollback_failed="true"
  fi

  if [[ "${rollback_failed}" == "false" ]]; then
    echo "실패한 신규 Slot을 중지합니다: ${TARGET_COLOR}" >&2

    if ! docker compose \
      --env-file "${ENV_FILE}" \
      -f "${TARGET_COMPOSE_FILE}" \
      stop \
      --timeout 40 \
      api web; then
      echo "실패한 신규 Slot을 중지하지 못했습니다: ${TARGET_COLOR}" >&2
      rollback_failed="true"
    fi
  else
    echo "기존 Slot 복구가 완료되지 않아 신규 Slot은 실행 상태로 유지합니다." >&2
  fi

  if [[ "${rollback_failed}" == "false" ]]; then
    if ! target_running_services="$(
      docker compose \
        --env-file "${ENV_FILE}" \
        -f "${TARGET_COMPOSE_FILE}" \
        ps \
        --status running \
        --services
    )"; then
      echo "실패한 신규 Slot의 실행 상태를 확인하지 못했습니다." >&2
      rollback_failed="true"
    elif [[ -n "${target_running_services}" ]]; then
      echo "실패한 신규 Slot에 실행 중인 서비스가 남아 있습니다: ${target_running_services}" >&2
      rollback_failed="true"
    fi
  fi

  ROLLBACK_IN_PROGRESS="false"

  if [[ "${rollback_failed}" == "true" ]]; then
    echo "자동 롤백을 완료하지 못했습니다. 수동 확인이 필요합니다." >&2
    return 1
  fi

  echo "기존 ${ACTIVE_COLOR} Slot으로 자동 롤백을 완료했습니다." >&2
  return 0
}

trap cleanup EXIT

[[ "${EUID}" -eq 0 ]] \
  || fail "Nginx 설정 변경을 위해 root 권한이 필요합니다."

command -v curl >/dev/null 2>&1 \
  || fail "curl이 설치되어 있지 않습니다."

command -v install >/dev/null 2>&1 \
  || fail "install 명령을 찾을 수 없습니다."

command -v nginx >/dev/null 2>&1 \
  || fail "Nginx가 설치되어 있지 않습니다."

command -v systemctl >/dev/null 2>&1 \
  || fail "systemctl 명령을 찾을 수 없습니다."

command -v aws >/dev/null 2>&1 \
  || fail "AWS CLI가 설치되어 있지 않습니다."

command -v docker >/dev/null 2>&1 \
  || fail "Docker가 설치되어 있지 않습니다."

docker info >/dev/null 2>&1 \
  || fail "Docker가 실행 중이 아니거나 현재 사용자에게 Docker 권한이 없습니다."

[[ -f "${BLUE_COMPOSE_FILE}" ]] \
  || fail "Blue Compose 파일이 없습니다: ${BLUE_COMPOSE_FILE}"

[[ -f "${GREEN_COMPOSE_FILE}" ]] \
  || fail "Green Compose 파일이 없습니다: ${GREEN_COMPOSE_FILE}"

[[ -f "${INFRA_COMPOSE_FILE}" ]] \
  || fail "Infra Compose 파일이 없습니다: ${INFRA_COMPOSE_FILE}"

[[ -f "${NGINX_SOURCE_DIR}/upstreams/prod-blue.conf" ]] \
  || fail "Blue upstream 파일이 없습니다."

[[ -f "${NGINX_SOURCE_DIR}/upstreams/prod-green.conf" ]] \
  || fail "Green upstream 파일이 없습니다."

[[ -f "${NGINX_SOURCE_DIR}/conf.d/prod.conf" ]] \
  || fail "prod Nginx 설정 파일이 없습니다."

[[ -f "${ENV_FILE}" ]] \
  || fail "환경변수 파일이 없습니다: ${ENV_FILE}"

if [[ -f "${ACTIVE_COLOR_FILE}" ]]; then
  INITIAL_BLUE_GREEN_DEPLOY="false"
  ORIGINAL_ACTIVE_COLOR_FILE_EXISTS="true"
  ACTIVE_COLOR="$(tr -d '\r\n' < "${ACTIVE_COLOR_FILE}")"
else
  INITIAL_BLUE_GREEN_DEPLOY="true"
  ACTIVE_COLOR="blue"
fi

if [[ -f "${CURRENT_SHA_FILE}" ]]; then
  ORIGINAL_CURRENT_SHA_FILE_EXISTS="true"
  ORIGINAL_CURRENT_SHA="$(tr -d '\r\n' < "${CURRENT_SHA_FILE}")"

  [[ "${ORIGINAL_CURRENT_SHA}" =~ ^[0-9a-f]{40}$ ]] \
    || fail "기존 prod Git SHA가 올바르지 않습니다: ${ORIGINAL_CURRENT_SHA}"
fi

if [[ "${INITIAL_BLUE_GREEN_DEPLOY}" == "true" ]]; then
  [[ -f "${LEGACY_COMPOSE_FILE}" ]] \
    || fail "최초 전환에 필요한 기존 prod Compose 파일이 없습니다: ${LEGACY_COMPOSE_FILE}"
fi

case "${ACTIVE_COLOR}" in
  blue)
    ACTIVE_COMPOSE_FILE="${BLUE_COMPOSE_FILE}"
    ACTIVE_WEB_PORT="3000"
    ACTIVE_API_PORT="8080"
    TARGET_COLOR="green"
    TARGET_COMPOSE_FILE="${GREEN_COMPOSE_FILE}"
    TARGET_WEB_PORT="3002"
    TARGET_API_PORT="8082"
    ;;
  green)
    ACTIVE_COMPOSE_FILE="${GREEN_COMPOSE_FILE}"
    ACTIVE_WEB_PORT="3002"
    ACTIVE_API_PORT="8082"
    TARGET_COLOR="blue"
    TARGET_COMPOSE_FILE="${BLUE_COMPOSE_FILE}"
    TARGET_WEB_PORT="3000"
    TARGET_API_PORT="8080"
    ;;
  *)
    fail "알 수 없는 prod 활성 Color입니다: ${ACTIVE_COLOR}"
    ;;
esac

echo "현재 활성 Slot: ${ACTIVE_COLOR}"
echo "새 배포 대상 Slot: ${TARGET_COLOR}"


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

echo "prod ${TARGET_COLOR} Compose 설정을 검증합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${TARGET_COMPOSE_FILE}" \
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

echo "prod ${TARGET_COLOR} ECR 이미지를 내려받습니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${TARGET_COMPOSE_FILE}" \
  pull api web

echo "prod ${TARGET_COLOR} 컨테이너를 실행하고 정상 상태까지 기다립니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${TARGET_COMPOSE_FILE}" \
  up -d --no-build --pull never \
  --wait \
  --wait-timeout 180

echo "prod PostgreSQL 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${INFRA_COMPOSE_FILE}" \
  ps

echo "prod ${TARGET_COLOR} 컨테이너 상태를 확인합니다."

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${TARGET_COMPOSE_FILE}" \
  ps

echo "prod ${TARGET_COLOR} WEB Health Check를 수행합니다."

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 3 \
  --max-time 5 \
  --retry 30 \
  --retry-delay 2 \
  --retry-all-errors \
  "http://127.0.0.1:${TARGET_WEB_PORT}/health" \
  >/dev/null

echo "prod ${TARGET_COLOR} API Health Check를 수행합니다."

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 3 \
  --max-time 5 \
  --retry 30 \
  --retry-delay 2 \
  --retry-all-errors \
  "http://127.0.0.1:${TARGET_API_PORT}/actuator/health" \
  >/dev/null

echo "prod ${TARGET_COLOR} WEB/API Health Check가 모두 성공했습니다."

echo "Blue/Green Nginx upstream 파일을 설치합니다."

install -d -m 0755 "${NGINX_UPSTREAM_DIR}"

install -m 0644 \
  "${NGINX_SOURCE_DIR}/upstreams/prod-blue.conf" \
  "${NGINX_UPSTREAM_DIR}/prod-blue.conf"

install -m 0644 \
  "${NGINX_SOURCE_DIR}/upstreams/prod-green.conf" \
  "${NGINX_UPSTREAM_DIR}/prod-green.conf"


if [[ -L "${NGINX_ACTIVE_LINK}" ]]; then
  CURRENT_UPSTREAM="$(readlink -f "${NGINX_ACTIVE_LINK}" || true)"

  case "${CURRENT_UPSTREAM}" in
    "${NGINX_UPSTREAM_DIR}/prod-blue.conf" | \
    "${NGINX_UPSTREAM_DIR}/prod-green.conf")
      ;;
    *)
      fail "prod-active.conf 링크가 올바르지 않습니다: ${CURRENT_UPSTREAM}"
      ;;
  esac
elif [[ -e "${NGINX_ACTIVE_LINK}" ]]; then
  fail "prod-active.conf가 심볼릭 링크가 아닙니다."
else
  echo "최초 활성 upstream을 Blue로 초기화합니다."

  ln -sfn \
    "${NGINX_UPSTREAM_DIR}/prod-blue.conf" \
    "${NGINX_ACTIVE_LINK}.next"

  mv -Tf \
    "${NGINX_ACTIVE_LINK}.next" \
    "${NGINX_ACTIVE_LINK}"
fi

echo "Blue/Green 방식의 prod Nginx 설정을 설치합니다."

install -m 0644 \
  "${NGINX_SOURCE_DIR}/conf.d/prod.conf" \
  "${NGINX_PROD_CONF}"

echo "현재 활성 upstream 기준으로 Nginx 문법을 검사합니다."

nginx -t

PREVIOUS_UPSTREAM="$(readlink -f "${NGINX_ACTIVE_LINK}")"
EXPECTED_ACTIVE_UPSTREAM="${NGINX_UPSTREAM_DIR}/prod-${ACTIVE_COLOR}.conf"
TARGET_UPSTREAM="${NGINX_UPSTREAM_DIR}/prod-${TARGET_COLOR}.conf"
NEXT_LINK="${NGINX_ACTIVE_LINK}.next"

[[ "${PREVIOUS_UPSTREAM}" == "${EXPECTED_ACTIVE_UPSTREAM}" ]] \
  || fail "상태 파일과 현재 Nginx upstream이 일치하지 않습니다: ${PREVIOUS_UPSTREAM}"

[[ -f "${TARGET_UPSTREAM}" ]] \
  || fail "전환할 upstream 파일이 없습니다: ${TARGET_UPSTREAM}"

echo "Nginx upstream을 ${ACTIVE_COLOR}에서 ${TARGET_COLOR}(으)로 전환합니다."

ln -sfn \
  "${TARGET_UPSTREAM}" \
  "${NEXT_LINK}"

mv -Tf \
  "${NEXT_LINK}" \
  "${NGINX_ACTIVE_LINK}"

if ! nginx -t; then
  echo "새 upstream의 Nginx 문법 검사에 실패하여 기존 upstream으로 복구합니다."

  ln -sfn \
    "${PREVIOUS_UPSTREAM}" \
    "${NEXT_LINK}"

  mv -Tf \
    "${NEXT_LINK}" \
    "${NGINX_ACTIVE_LINK}"

  nginx -t \
    || fail "기존 upstream 복구 후에도 Nginx 문법 검사가 실패했습니다."

  fail "Nginx upstream 전환에 실패했습니다."
fi

if ! systemctl reload nginx; then
  echo "Nginx Reload에 실패하여 기존 upstream으로 복구합니다."

  ln -sfn \
    "${PREVIOUS_UPSTREAM}" \
    "${NEXT_LINK}"

  mv -Tf \
    "${NEXT_LINK}" \
    "${NGINX_ACTIVE_LINK}"

  nginx -t \
    || fail "기존 upstream 복구 후 Nginx 문법 검사가 실패했습니다."

  systemctl reload nginx \
    || fail "기존 upstream으로 Nginx를 복구하지 못했습니다."

  fail "새 upstream으로 Nginx를 Reload하지 못했습니다."
fi

CURRENT_UPSTREAM="$(readlink -f "${NGINX_ACTIVE_LINK}")"

[[ "${CURRENT_UPSTREAM}" == "${TARGET_UPSTREAM}" ]] \
  || fail "Nginx 활성 upstream 확인에 실패했습니다: ${CURRENT_UPSTREAM}"

TRAFFIC_SWITCHED="true"

echo "Nginx 활성 upstream이 ${TARGET_COLOR}(으)로 전환되었습니다."

EXTERNAL_HEALTH_FAILURE=""

echo "운영 도메인을 통해 WEB Health Check를 수행합니다."

if ! curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 5 \
  --max-time 10 \
  --retry 10 \
  --retry-delay 2 \
  --retry-all-errors \
  -H "Cache-Control: no-cache" \
  "${PROD_BASE_URL}/health" \
  >/dev/null; then
  EXTERNAL_HEALTH_FAILURE="운영 도메인 WEB Health Check 실패"
fi

if [[ -z "${EXTERNAL_HEALTH_FAILURE}" ]]; then
  echo "운영 도메인을 통해 API Health Check를 수행합니다."

  if ! curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time 10 \
    --retry 10 \
    --retry-delay 2 \
    --retry-all-errors \
    -H "Cache-Control: no-cache" \
    "${PROD_BASE_URL}/api/actuator/health" \
    >/dev/null; then
    EXTERNAL_HEALTH_FAILURE="운영 도메인 API Health Check 실패"
  fi
fi

if [[ -n "${EXTERNAL_HEALTH_FAILURE}" ]]; then
  echo "${EXTERNAL_HEALTH_FAILURE}" >&2

  if ! rollback_to_previous_slot "${EXTERNAL_HEALTH_FAILURE}"; then
    fail "외부 Health Check 실패 후 자동 롤백도 완료하지 못했습니다."
  fi

  fail "외부 Health Check가 실패하여 기존 ${ACTIVE_COLOR} Slot으로 자동 롤백했습니다."
fi

echo "운영 도메인의 WEB/API Health Check가 모두 성공했습니다."


if [[ "${ORIGINAL_CURRENT_SHA_FILE_EXISTS}" == "true" ]]; then
  PREVIOUS_SHA="${ORIGINAL_CURRENT_SHA}"
else
  PREVIOUS_SHA=""
fi

DEPLOYED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"


printf '%s\n' "${TARGET_COLOR}" \
  > "${ACTIVE_COLOR_FILE}.next"

printf '%s\n' "${GIT_SHA}" \
  > "${CURRENT_SHA_FILE}.next"

printf '%s\n' "${PREVIOUS_SHA}" \
  > "${PREVIOUS_SHA_FILE}.next"

printf '%s\n' "${DEPLOYED_AT}" \
  > "${LAST_SUCCESS_FILE}.next"

chmod 0644 \
  "${ACTIVE_COLOR_FILE}.next" \
  "${CURRENT_SHA_FILE}.next" \
  "${PREVIOUS_SHA_FILE}.next" \
  "${LAST_SUCCESS_FILE}.next"

mv -Tf \
  "${PREVIOUS_SHA_FILE}.next" \
  "${PREVIOUS_SHA_FILE}"

mv -Tf \
  "${CURRENT_SHA_FILE}.next" \
  "${CURRENT_SHA_FILE}"

mv -Tf \
  "${LAST_SUCCESS_FILE}.next" \
  "${LAST_SUCCESS_FILE}"

mv -Tf \
  "${ACTIVE_COLOR_FILE}.next" \
  "${ACTIVE_COLOR_FILE}"

DEPLOY_COMMITTED="true"

echo "prod 배포 상태 파일 기록을 완료했습니다."
echo "활성 Slot: ${TARGET_COLOR}"
echo "현재 Git SHA: ${GIT_SHA}"
echo "이전 Git SHA: ${PREVIOUS_SHA:-없음}"
echo "배포 성공 시각: ${DEPLOYED_AT}"

echo "기존 Slot의 진행 중인 요청이 종료되도록 ${PROD_DRAIN_SECONDS}초 동안 대기합니다."

sleep "${PROD_DRAIN_SECONDS}"

if [[ "${INITIAL_BLUE_GREEN_DEPLOY}" == "true" ]]; then
  OLD_COMPOSE_FILE="${LEGACY_COMPOSE_FILE}"
  OLD_SLOT_NAME="legacy aml-prod"
else
  OLD_COMPOSE_FILE="${ACTIVE_COMPOSE_FILE}"
  OLD_SLOT_NAME="${ACTIVE_COLOR}"
fi

echo "기존 Slot을 중지합니다: ${OLD_SLOT_NAME}"

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${OLD_COMPOSE_FILE}" \
  stop \
  --timeout 40 \
  api web

OLD_RUNNING_SERVICES="$(
  docker compose \
    --env-file "${ENV_FILE}" \
    -f "${OLD_COMPOSE_FILE}" \
    ps \
    --status running \
    --services
)"

[[ -z "${OLD_RUNNING_SERVICES}" ]] \
  || fail "기존 Slot에 실행 중인 서비스가 남아 있습니다: ${OLD_RUNNING_SERVICES}"

echo "기존 Slot 중지를 확인했습니다: ${OLD_SLOT_NAME}"

echo "기존 Slot 중지 후 새 Slot을 다시 확인합니다."

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 3 \
  --max-time 5 \
  "http://127.0.0.1:${TARGET_WEB_PORT}/health" \
  >/dev/null

curl \
  --fail \
  --silent \
  --show-error \
  --connect-timeout 3 \
  --max-time 5 \
  "http://127.0.0.1:${TARGET_API_PORT}/actuator/health" \
  >/dev/null

echo "기존 Slot 정리 후 prod ${TARGET_COLOR} 상태가 정상입니다."
