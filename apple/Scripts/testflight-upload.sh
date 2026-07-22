#!/usr/bin/env bash
#
# Archive the Akashic app and upload the build to TestFlight.
#
# Prerequisites (one-time, see ../../APPLE-MIGRATION-RUNBOOK.md §4):
#   * App record created in App Store Connect for bundle id no.akashic.app
#   * App Store Connect API key (role: App Manager) downloaded as a .p8 file
#   * These variables exported (keep them in the repo-root .env, never in git):
#       ASC_KEY_PATH   absolute path to AuthKey_<KEYID>.p8
#       ASC_KEY_ID     the key's Key ID
#       ASC_ISSUER_ID  the team's Issuer ID (Users and Access -> Integrations)
#
# Usage:  ./Scripts/testflight-upload.sh [--archive-only]
#
set -euo pipefail

TEAM_ID="9LVCB72DT8"
SCHEME="Akashic"
CONFIG="Release-CloudKit"
APPLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$APPLE_DIR/build"
ARCHIVE="$BUILD_DIR/Akashic.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"

for var in ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID; do
    if [ -z "${!var:-}" ]; then
        echo "error: $var is not set — see the header of this script." >&2
        exit 1
    fi
done
[ -f "$ASC_KEY_PATH" ] || { echo "error: no key file at $ASC_KEY_PATH" >&2; exit 1; }

cd "$APPLE_DIR"
echo "==> Generating project"
xcodegen generate

echo "==> Archiving ($CONFIG)"
xcodebuild -project Akashic.xcodeproj \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$ASC_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    archive

if [ "${1:-}" = "--archive-only" ]; then
    echo "==> Archive at $ARCHIVE (upload skipped)"
    exit 0
fi

echo "==> Exporting for App Store Connect"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$APPLE_DIR/Scripts/ExportOptions.plist" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$ASC_KEY_PATH" \
    -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"

echo "==> Uploading to TestFlight"
xcrun altool --upload-app \
    --type ios \
    --file "$EXPORT_DIR"/*.ipa \
    --apiKey "$ASC_KEY_ID" \
    --apiIssuer "$ASC_ISSUER_ID"

echo "==> Done. Processing takes ~5-15 min before the build appears in TestFlight."
