#!/usr/bin/env bash
# Render screenshots of the running app (and offline snapshot for 00-best-home).
# Usage: ./screenshot.sh            (all tabs + best home)
#        ./screenshot.sh name "tab=cost&hw=strix"
set -euo pipefail
cd "$(dirname "$0")"
PORT=${LLM_ADVISOR_PORT:-4949}
CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
mkdir -p screenshots dist
shot() {
  local name="$1" qs="${2:-}" size="${3:-1440,900}" url
  if [[ "$qs" == file://* ]]; then url="$qs"; else url="http://127.0.0.1:$PORT/?$qs"; fi
  local prof; prof="$(mktemp -d /tmp/llm-advisor-chrome.XXXX)"
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --run-all-compositor-stages-before-draw --virtual-time-budget=10000 \
    --window-size="$size" --user-data-dir="$prof" \
    --screenshot="screenshots/$name.png" "$url" >/dev/null 2>&1 || true
  rm -rf "$prof"
  echo "screenshots/$name.png ($(wc -c < "screenshots/$name.png" 2>/dev/null || echo 0) bytes)"
}
if [ -n "${1:-}" ]; then shot "$1" "${2:-}"; exit; fi
# Best home: prefer offline snapshot (data inlined; avoids fetch race; count-ups finish in budget)
if [ -f dist/llm-box-advisor-snapshot.html ]; then
  shot "00-best-home" "file://$PWD/dist/llm-box-advisor-snapshot.html?shot=1" "1440,1100"
else
  shot "00-best-home" "tab=overview" "1440,1100"
fi
i=1
for t in overview workload sizing hardware cost matrix kpd sources; do
  shot "$(printf %02d $i)-$t" "tab=$t&shot=1"
  i=$((i+1))
done
# Deep-link extras
shot "09-sizing-gptoss120b" "tab=sizing&model=gptoss120&shot=1"
shot "10-cost-strix" "tab=cost&hw=strix&shot=1"
