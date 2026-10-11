#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/../deploy.py" --role front --environment prod \
  --action deploy --sha "${1:?full Git SHA required}" \
  --deployment-id "${2:?deployment ID required}" --account-id "${3:?AWS account ID required}"
