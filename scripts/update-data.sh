#!/usr/bin/env bash
# 從 OpenStreetMap 重新抓資料並產生 data/*.geojson
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
scripts/fetch-osm.sh scripts/ramps.overpassql data/raw/overpass.json
node scripts/build-ramps.mjs --surface-query > data/raw/surface.overpassql
scripts/fetch-osm.sh data/raw/surface.overpassql data/raw/surface.json
node scripts/build-ramps.mjs
