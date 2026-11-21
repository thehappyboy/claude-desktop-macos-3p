#!/usr/bin/env bash
set -euo pipefail

KEYCHAIN="$HOME/Library/Keychains/Claude-3p-CU.keychain-db"
STATE_DIR="$HOME/Library/Application Support/Claude-3p-CU"
PASS_FILE="$STATE_DIR/signing-password"
IDENTITY="Claude 3P CU Local Signing"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/claude-3p-cu-sign.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

if security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -q "$IDENTITY"; then
  echo "[signing] identity already present: $IDENTITY"
  exit 0
fi

if [[ ! -f "$PASS_FILE" ]]; then
  umask 077
  openssl rand -hex 24 > "$PASS_FILE"
fi
PASS="$(cat "$PASS_FILE")"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -subj "/CN=$IDENTITY" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -addext "basicConstraints=critical,CA:FALSE" >/dev/null 2>&1
openssl pkcs12 -export -legacy \
  -out "$TMP/identity.p12" -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -passout "pass:$PASS" >/dev/null 2>&1

if [[ ! -f "$KEYCHAIN" ]]; then
  security create-keychain -p "$PASS" "$KEYCHAIN"
fi
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$PASS" "$KEYCHAIN"
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$PASS" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$PASS" "$KEYCHAIN" >/dev/null
security add-trusted-cert -r trustRoot -k "$KEYCHAIN" "$TMP/cert.pem" >/dev/null

KCS=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%\"}"
  line="${line#\"}"
  [[ -n "$line" ]] && KCS+=("$line")
done < <(security list-keychains -d user)

found=false
for kc in "${KCS[@]}"; do
  [[ "$kc" == "$KEYCHAIN" ]] && found=true
done
if [[ "$found" == false ]]; then
  security list-keychains -d user -s "${KCS[@]}" "$KEYCHAIN"
fi

security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$IDENTITY"
echo "[signing] created identity: $IDENTITY"
echo "[signing] keychain: $KEYCHAIN"
