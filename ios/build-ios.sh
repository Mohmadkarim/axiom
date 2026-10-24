#!/bin/sh
# Bundle the latest web build into the iPad app and build it.
#   ./build-ios.sh sim            → build for the iPad simulator
#   ./build-ios.sh device TEAMID  → build + sign for a connected iPad
set -e
cd "$(dirname "$0")"
(cd .. && node build.mjs >/dev/null)
rm -rf web && mkdir web && cp ../dist/index.html ../dist/*.png web/ && cp -R ../dist/vendor web/vendor
"$HOME/.local/share/xcodegen/xcodegen/bin/xcodegen" generate --quiet
if [ "$1" = "device" ]; then
  xcodebuild -project Axiom.xcodeproj -scheme Axiom -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath build DEVELOPMENT_TEAM="$2" -allowProvisioningUpdates -quiet build
  echo "$(pwd)/build/Build/Products/Release-iphoneos/Axiom.app"
else
  xcodebuild -project Axiom.xcodeproj -scheme Axiom -configuration Debug -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath build CODE_SIGNING_ALLOWED=NO -quiet build
  echo "$(pwd)/build/Build/Products/Debug-iphonesimulator/Axiom.app"
fi
