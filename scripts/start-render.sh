#!/bin/sh
set -eu

export AI_SERVICE_URL="${AI_SERVICE_URL:-http://127.0.0.1:8002}"

cd /srv/ai_service
uvicorn app.main:app --host 127.0.0.1 --port 8002 &
AI_PID="$!"

cleanup() {
  kill "$AI_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

cd /srv/project-brain-backend
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
