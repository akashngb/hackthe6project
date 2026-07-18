#!/bin/sh
# Rebuild the walk-collision bundle from the adapter source.
# Requires esbuild (any recent version): npm i -g esbuild, or use npx.
cd "$(dirname "$0")"
npx esbuild gta6-adapter.ts \
  --bundle --format=iife --target=es2020 \
  --alias:playcanvas=./pc-shim.js \
  --outfile=../scripts/walk-collision.bundle.js
