#!/bin/bash
# Stores your reclaude.ai password in macOS Keychain so claude-hud can
# auto-refresh the rc_sid cookie when it expires.
#
# Usage:
#   scripts/set-reclaude-password.sh you@example.com [service-name]
#
# - service-name defaults to "claude-hud-reclaude" (matches default config).
# - The password is read interactively (no echo).
# - Existing entry is overwritten with -U.

set -euo pipefail

if [[ "${OSTYPE:-}" != darwin* ]]; then
  echo "Error: this script only works on macOS (uses Keychain)." >&2
  exit 1
fi

if [[ -z "${1:-}" ]]; then
  echo "Usage: $(basename "$0") <email> [service-name]" >&2
  echo "  service-name defaults to: claude-hud-reclaude" >&2
  exit 2
fi

ACCOUNT="$1"
SERVICE="${2:-claude-hud-reclaude}"

printf "Password for %s (will not echo): " "$ACCOUNT" >&2
read -rs PASSWORD
echo "" >&2

if [[ -z "$PASSWORD" ]]; then
  echo "Error: empty password, aborting." >&2
  exit 3
fi

security add-generic-password \
  -U \
  -a "$ACCOUNT" \
  -s "$SERVICE" \
  -w "$PASSWORD" \
  -j "claude-hud reclaude.ai auto-refresh credential"

echo "✓ Stored in Keychain as service='$SERVICE' account='$ACCOUNT'" >&2
echo "Verify with: security find-generic-password -a '$ACCOUNT' -s '$SERVICE'" >&2
