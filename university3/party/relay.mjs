// SIEGE relay — plain-Node stand-in for the PartyKit server (same protocol,
// same /parties/main/<room> path). Run: node relay.mjs [port]
// Expose publicly with: cloudflared tunnel --url http://localhost:1999
import { WebSocketServer } from 'ws';
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2]) || 1999;
const rooms = new Map(); // room -> Set<ws>

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('siege relay ok\n');
});
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const room = decodeURIComponent((req.url || '/').split('/').filter(Boolean).pop() || 'hack6');
    ws.id = crypto.randomUUID().slice(0, 8);
    ws.room = room;
    if (!rooms.has(room)) rooms.set(room, new Set());
    const members = rooms.get(room);
    members.add(ws);

    const others = (fn) => { for (const m of members) if (m !== ws && m.readyState === 1) fn(m); };

    ws.send(JSON.stringify({ t: 'hello', id: ws.id }));
    others(m => m.send(JSON.stringify({ t: 'join', id: ws.id })));
    console.log(`[${room}] ${ws.id} joined (${members.size} online)`);

    ws.on('message', (buf) => {
        let data;
        try { data = JSON.parse(buf.toString()); } catch { return; }
        data.id = ws.id;
        const out = JSON.stringify(data);
        others(m => m.send(out));
    });

    ws.on('close', () => {
        members.delete(ws);
        if (members.size === 0) rooms.delete(room);
        others(m => m.send(JSON.stringify({ t: 'leave', id: ws.id })));
        console.log(`[${room}] ${ws.id} left (${members.size} online)`);
    });
    ws.on('error', () => {});
});

server.listen(PORT, () => console.log(`siege relay listening on :${PORT}`));
