#!/usr/bin/env bash
# Fetch the KoSIT validator + validator-configuration-xrechnung into .validators/, for the `kosit`
# gate (scripts/kosit-check.mjs). PINNED: validator v1.6.2, config v2026-01-31 (XRechnung 3.0.2 /
# Schematron 2.4.0). Release-asset paths rot, so we resolve them via the GitHub Releases API when
# `gh` is available (pinning the TAG) and fall back to the literal URLs otherwise (local runs).
#
# Note: the validator-configuration-xrechnung scenarios.xml ALSO carries generic EN 16931 scenarios
# (UBL Invoice/CreditNote + CII, keyed on CustomizationID urn:cen.eu:en16931:2017), so this same
# config can validate generic ubl/cii as a cross-check — see docs/CI.md.
#
# Progress → stderr; KEY=VALUE → stdout:  bash scripts/ci/fetch-kosit.sh >> "$GITHUB_ENV"
set -euo pipefail

VALIDATOR_TAG="${VALIDATOR_TAG:-v1.6.2}"
CONFIG_TAG="${CONFIG_TAG:-v2026-01-31}"
VALIDATORS_DIR="${VALIDATORS_DIR:-.validators}"

mkdir -p "$VALIDATORS_DIR"
DIR="$(cd "$VALIDATORS_DIR" && pwd)"
log() { echo "$@" >&2; }

asset_url() { # <repo> <tag> <name-regex> <fallback>
  local url=""
  if command -v gh >/dev/null 2>&1; then
    url="$(gh api "repos/$1/releases/tags/$2" --jq ".assets[] | select(.name|test(\"$3\")) | .browser_download_url" 2>/dev/null | head -n1 || true)"
  fi
  echo "${url:-$4}"
}

log "KoSIT validator $VALIDATOR_TAG + validator-configuration-xrechnung $CONFIG_TAG"

JAR_URL="$(asset_url itplr-kosit/validator "$VALIDATOR_TAG" 'standalone.*\.jar$' \
  "https://github.com/itplr-kosit/validator/releases/download/${VALIDATOR_TAG}/validator-${VALIDATOR_TAG#v}-standalone.jar")"
log "  validator jar: $JAR_URL"
curl -fsSL "$JAR_URL" -o "$DIR/validator-standalone.jar"

CFG_URL="$(asset_url itplr-kosit/validator-configuration-xrechnung "$CONFIG_TAG" '\.zip$' \
  "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/${CONFIG_TAG}/xrechnung-3.0.2-validator-configuration-2026-01-31.zip")"
log "  config zip:    $CFG_URL"
curl -fsSL "$CFG_URL" -o "$DIR/kosit-config.zip"
rm -rf "$DIR/config"
unzip -q "$DIR/kosit-config.zip" -d "$DIR/config"

# scenarios.xml sits near the root of the extracted configuration; the validator resolves the
# Schematron/XSD relative to its directory (kosit-check.mjs derives the -r repository dir).
SCENARIOS="$(find "$DIR/config" -maxdepth 2 -name scenarios.xml | head -n1)"
test -n "$SCENARIOS" || { log "✗ scenarios.xml not found in the configuration zip"; exit 1; }
test -s "$DIR/validator-standalone.jar" || { log "✗ validator jar download empty"; exit 1; }

echo "KOSIT_JAR=$DIR/validator-standalone.jar"
echo "KOSIT_SCENARIOS=$SCENARIOS"
log "✓ KoSIT validator ready in $DIR"
