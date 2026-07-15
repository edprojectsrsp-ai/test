#!/bin/sh
set -eu

cd "$(dirname "$0")"
PORT="${PPE_PORT:-8004}"

if [ ! -x .venv/bin/python ]; then
  echo "Missing .venv. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
