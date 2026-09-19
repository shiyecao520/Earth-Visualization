#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python3 -m pip install -r requirements.txt

export MCP_URL="${MCP_URL:-http://10.200.49.5:8001/mcp}"
export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8001}"
exec python3 server.py
