#!/usr/bin/env bash
# 用法：scripts/fetch-osm.sh <query.overpassql> <output.json>
# 依序嘗試多個 Overpass 伺服器，失敗會重試。
set -euo pipefail
query="$1"; out="$2"
servers=(
  https://overpass-api.de/api/interpreter
  https://overpass.private.coffee/api/interpreter
  https://overpass.kumi.systems/api/interpreter
)
for attempt in 1 2 3; do
  for s in "${servers[@]}"; do
    echo "→ $s (第 $attempt 次)" >&2
    code=$(curl -s -A "taipei-ramp-sim/0.1" -X POST --data-urlencode "data@$query" "$s" \
      -o "$out.tmp" -w "%{http_code}" --max-time 240 || echo 000)
    if [[ "$code" == 200 ]] && head -c 50 "$out.tmp" | grep -q '{'; then
      mv "$out.tmp" "$out"; echo "✓ 已存到 $out" >&2; exit 0
    fi
    echo "  失敗（HTTP ${code}）" >&2
  done
  sleep $((attempt * 15))
done
rm -f "$out.tmp"; echo "全部伺服器都失敗" >&2; exit 1
