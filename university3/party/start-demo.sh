#!/bin/sh
# Demo-day multiplayer bootstrap: starts the relay + a public tunnel and
# prints the wss URL. If the URL changed since last time, update the
# relay-url.json asset (id 298997427) in the PlayCanvas editor — from any
# logged-in editor tab console:
#
#   const fd = new FormData();
#   fd.append('file', new File([JSON.stringify({url:'wss://NEW-URL'})], 'relay-url.json'));
#   fd.append('branchId', config.self.branch.id);
#   await fetch('/api/assets/298997427', { method:'PUT', body: fd });
#
cd "$(dirname "$0")"
node relay.mjs 1999 &
RELAY=$!
cloudflared tunnel --url http://localhost:1999 2>&1 | while read -r line; do
  echo "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1 | sed 's|https|→ relay URL: wss|'
  echo "$line" > /dev/null
done
kill $RELAY 2>/dev/null
