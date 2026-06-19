#!/usr/bin/env bash
# Fetch the Mustangproject CLI into .validators/, for the `mustang` hybrid gate
# (scripts/mustang-check.mjs) and the embedded-XML extraction (--action extract). PINNED to the
# exact release asset (verified: tag core-2.24.0 → Mustang-CLI-2.24.0.jar), so no API/jq needed.
# Mustang's `--action validate` embeds veraPDF (PDF/A-3b) and validates the Factur-X container +
# embedded factur-x.xml across every profile.
#
# Progress → stderr; KEY=VALUE → stdout:  bash scripts/ci/fetch-mustang.sh >> "$GITHUB_ENV"
set -euo pipefail

MUSTANG_VER="${MUSTANG_VER:-2.24.0}"
VALIDATORS_DIR="${VALIDATORS_DIR:-.validators}"

mkdir -p "$VALIDATORS_DIR"
DIR="$(cd "$VALIDATORS_DIR" && pwd)"
log() { echo "$@" >&2; }

JAR_URL="https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VER}/Mustang-CLI-${MUSTANG_VER}.jar"
log "Mustangproject CLI $MUSTANG_VER"
log "  jar: $JAR_URL"
curl -fsSL "$JAR_URL" -o "$DIR/mustang-cli.jar"
test -s "$DIR/mustang-cli.jar" || { log "✗ Mustang CLI jar download empty"; exit 1; }

echo "MUSTANG_JAR=$DIR/mustang-cli.jar"
log "✓ Mustang CLI ready in $DIR"
