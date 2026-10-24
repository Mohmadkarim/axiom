#!/bin/sh
# Build and publish to GitHub Pages (served from /docs on main)
set -e
cd "$(dirname "$0")"
# only the stable line goes live; experiments on other branches stay private
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then echo "Not on main: not deploying (switch with: git checkout main)"; exit 1; fi
node build.mjs
rm -rf docs && mkdir docs
cp dist/index.html dist/sw.js dist/manifest.webmanifest dist/*.png docs/
cp -R dist/vendor docs/vendor
touch docs/.nojekyll
git add -A
git commit -m "${1:-Update Axiom}" || echo "Nothing new to commit"
git push
