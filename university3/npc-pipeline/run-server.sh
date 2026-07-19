#!/bin/sh
# Start the photo->NPC pipeline server (kills the mock if it holds :8799).
# Needs MESHY_API_KEY in the environment or in .env.
cd "$(dirname "$0")"
[ -f .env ] && export $(grep -v '^#' .env | xargs)
if [ -z "$MESHY_API_KEY" ]; then
  echo "MESHY_API_KEY not set — put it in .env (see .env.example)"; exit 1
fi
exec ./.venv/bin/python meshy/server.py 8799
