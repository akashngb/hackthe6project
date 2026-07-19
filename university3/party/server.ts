// SIEGE relay — a PartyKit room that rebroadcasts every message to the
// other members, stamping the sender's connection id.
import type * as Party from "partykit/server";

export default class SiegeRelay implements Party.Server {
    constructor(readonly room: Party.Room) {}

    onConnect(conn: Party.Connection) {
        conn.send(JSON.stringify({ t: "hello", id: conn.id }));
        this.room.broadcast(JSON.stringify({ t: "join", id: conn.id }), [conn.id]);
    }

    onMessage(message: string, sender: Party.Connection) {
        let data: any;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }
        data.id = sender.id;
        this.room.broadcast(JSON.stringify(data), [sender.id]);
    }

    onClose(conn: Party.Connection) {
        this.room.broadcast(JSON.stringify({ t: "leave", id: conn.id }));
    }
}
