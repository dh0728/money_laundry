#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/../deploy.py" --role backend --environment prod \
  --action rollback --deployment-id "${1:?deployment ID to roll back required}" \
  --account-id "${2:?AWS account ID required}"
