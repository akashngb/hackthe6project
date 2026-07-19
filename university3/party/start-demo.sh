#!/bin/sh
# Demo-day multiplayer bootstrap: starts the relay (reusing it if already
# running) + a public tunnel, and prints the wss URL. If the URL changed,
# update the relay-url.json asset (id 298997427) from any logged-in
# PlayCanvas editor tab console:
#
#   const fd = new FormData();
#   fd.append('file', new File([JSON.stringify({url:'wss://NEW-URL'})], 'relay-url.json'));
#   fd.append('branchId', config.self.branch.id);
#   await fetch('/api/assets/298997427', { method:'PUT', body: fd });
#
cd "$(dirname "$0")"

if nc -z 127.0.0.1 1999 2>/dev/null; then
  echo "relay already running on :1999 — reusing it"
else
  node relay.mjs 1999 &
  echo "relay started on :1999 (pid $!)"
  sleep 1
fi

echo "starting tunnel…"
cloudflared tunnel --url http://localhost:1999 2>&1 | while read -r line; do
  URL=$(echo "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)
  if [ -n "$URL" ]; then
    echo ""
    echo "  → relay URL: $(echo "$URL" | sed 's|https|wss|')"
    echo "  → update asset 298997427 if this differs from the last run (see header of this script)"
    echo ""
  fi
done
