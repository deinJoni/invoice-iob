#!/usr/bin/env bash
# Fetch the official CEN EN 16931 Schematron (compiled to XSLT) + Saxon-HE + xmlresolver into
# .validators/, for the `en16931` gate (scripts/en16931-check.mjs). PINNED versions:
#   • CEN validation artefacts: ConnectingEurope/eInvoicing-EN16931  tag validation-1.3.16
#   • Saxon-HE 12.9 + xmlresolver 5.3.3 (+data) from Maven Central
#     (Saxon 12.x throws NoClassDefFoundError org/xmlresolver/Resolver without xmlresolver — so it
#      goes on the CLASSPATH, and the check runs `java -cp … net.sf.saxon.Transform`, never -jar.)
#
# Asset URLs for the CEN zips are version-stamped and rot per release, so we resolve them via the
# GitHub Releases API when `gh` is available (pinning the TAG), and fall back to the literal URLs
# otherwise (so this also runs locally without gh). Progress → stderr; KEY=VALUE → stdout, so CI can:
#   bash scripts/ci/fetch-en16931.sh >> "$GITHUB_ENV"
set -euo pipefail

EN16931_TAG="${EN16931_TAG:-validation-1.3.16}"
SAXON_VER="${SAXON_VER:-12.9}"
XMLRESOLVER_VER="${XMLRESOLVER_VER:-5.3.3}"
VALIDATORS_DIR="${VALIDATORS_DIR:-.validators}"

mkdir -p "$VALIDATORS_DIR"
DIR="$(cd "$VALIDATORS_DIR" && pwd)"
log() { echo "$@" >&2; }

# Resolve a release asset's download URL via the GitHub API (pinned tag), with a literal fallback.
asset_url() { # <repo> <tag> <name-regex> <fallback>
  local url=""
  if command -v gh >/dev/null 2>&1; then
    url="$(gh api "repos/$1/releases/tags/$2" --jq ".assets[] | select(.name|test(\"$3\")) | .browser_download_url" 2>/dev/null | head -n1 || true)"
  fi
  echo "${url:-$4}"
}

log "EN 16931 Schematron — CEN tag $EN16931_TAG, Saxon-HE $SAXON_VER, xmlresolver $XMLRESOLVER_VER"

UBL_URL="$(asset_url ConnectingEurope/eInvoicing-EN16931 "$EN16931_TAG" 'ubl.*\.zip$' \
  "https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/${EN16931_TAG}/en16931-ubl-${EN16931_TAG#validation-}.zip")"
CII_URL="$(asset_url ConnectingEurope/eInvoicing-EN16931 "$EN16931_TAG" 'cii.*\.zip$' \
  "https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/download/${EN16931_TAG}/en16931-cii-${EN16931_TAG#validation-}.zip")"

log "  ubl schematron: $UBL_URL"
curl -fsSL "$UBL_URL" -o "$DIR/en16931-ubl.zip"
log "  cii schematron: $CII_URL"
curl -fsSL "$CII_URL" -o "$DIR/en16931-cii.zip"

# Each zip ships a single, self-contained xslt/EN16931-<SYNTAX>-validation.xslt (no sibling imports).
rm -rf "$DIR/cen-ubl" "$DIR/cen-cii"
unzip -o -q "$DIR/en16931-ubl.zip" 'xslt/EN16931-UBL-validation.xslt' -d "$DIR/cen-ubl"
unzip -o -q "$DIR/en16931-cii.zip" 'xslt/EN16931-CII-validation.xslt' -d "$DIR/cen-cii"

MVN="https://repo1.maven.org/maven2"
log "  saxon:       Saxon-HE-${SAXON_VER}.jar"
curl -fsSL "$MVN/net/sf/saxon/Saxon-HE/${SAXON_VER}/Saxon-HE-${SAXON_VER}.jar" -o "$DIR/saxon-he.jar"
log "  xmlresolver: xmlresolver-${XMLRESOLVER_VER}.jar (+data)"
curl -fsSL "$MVN/org/xmlresolver/xmlresolver/${XMLRESOLVER_VER}/xmlresolver-${XMLRESOLVER_VER}.jar" -o "$DIR/xmlresolver.jar"
curl -fsSL "$MVN/org/xmlresolver/xmlresolver/${XMLRESOLVER_VER}/xmlresolver-${XMLRESOLVER_VER}-data.jar" -o "$DIR/xmlresolver-data.jar"

for f in saxon-he.jar xmlresolver.jar; do
  test -s "$DIR/$f" || { log "✗ $f download empty"; exit 1; }
done

# stdout: env for scripts/en16931-check.mjs (and CI's $GITHUB_ENV).
echo "SAXON_CP=$DIR/saxon-he.jar:$DIR/xmlresolver.jar:$DIR/xmlresolver-data.jar"
echo "EN16931_UBL_XSLT=$DIR/cen-ubl/xslt/EN16931-UBL-validation.xslt"
echo "EN16931_CII_XSLT=$DIR/cen-cii/xslt/EN16931-CII-validation.xslt"
log "✓ EN 16931 validator ready in $DIR"
