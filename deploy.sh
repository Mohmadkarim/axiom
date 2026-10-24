#!/bin/sh
# Build and publish to GitHub Pages (served from /docs on main)
set -e
cd "$(dirname "$0")"
node build.mjs
rm -rf docs && mkdir docs
cp dist/index.html dist/sw.js dist/manifest.webmanifest dist/*.png docs/
cp -R dist/vendor docs/vendor
touch docs/.nojekyll
git add -A
git commit -m "${1:-Update Axiom}" || echo "Nothing new to commit"
git push
