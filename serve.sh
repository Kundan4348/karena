#!/usr/bin/env bash
# Serve Lumina Clock locally on a secure (localhost) origin.
PORT="${1:-8099}"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Lumina Clock → http://localhost:${PORT}"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${DIR}"
