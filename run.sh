#!/usr/bin/env bash
# Start Local LLM Box Advisor in the background (idempotent). Re-derives the fleet workload first.
cd "$(dirname "$0")"
PORT=${LLM_ADVISOR_PORT:-4949}
python3 analyze.py >/dev/null
if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "LLM Box Advisor already running: http://127.0.0.1:$PORT"; exit 0
fi
setsid nohup python3 server.py > data/server.log 2>&1 &
sleep 1
echo "LLM Box Advisor started (pid $!): http://127.0.0.1:$PORT"
