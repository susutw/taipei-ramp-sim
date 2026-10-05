#!/usr/bin/env bash
# 抓取並建立所有區域的 3D 場景（data/regions.json 列出的每一區）。
#   scripts/update-scenes.sh            只抓還沒抓過的區域
#   scripts/update-scenes.sh --force    全部重抓
set -euo pipefail
cd "$(dirname "$0")/.."
force=${1:-}
for name in $(node -e 'console.log(Object.keys(require("./data/regions.json")).join(" "))'); do
  raw="data/raw/scene-$name.json"
  if [[ "$force" == "--force" || ! -s "$raw" ]]; then
    scripts/fetch-osm.sh "data/raw/scene-$name.overpassql" "$raw"
    sleep 5 # 對 Overpass 客氣一點
  fi
  node scripts/build-scene.mjs "$name"
done
