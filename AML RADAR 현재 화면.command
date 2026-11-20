#!/bin/bash
set -eu
export PATH="${PNPM_HOME:+$PNPM_HOME:}/opt/homebrew/bin:/usr/local/bin:$PATH"
root="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22.12 이상과 pnpm 11.24.0을 설치해 주세요.'
elif node "$root/frontend/implementation/1.14.0/web-app/scripts/open-aml-radar.mjs"; then
  exit 0
fi
printf '%s\n' 'Enter 키를 누르면 닫힙니다.'
read -r _ || true
exit 1
