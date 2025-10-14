// _worker.js — Cloudflare Pages Functions + WebSocket
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // ==== In-memory состояние (эпhemeral). Для прод лучше Durable Objects. ====
        env.ROOMS ||= new Map();   // roomId -> { clients: Set<WebSocket>, players: Map<ws,{id,name,vote,isAdmin}>, revealed: bool }
        env.NOTES ||= new Map();   // roomId -> note

        if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            server.accept();

            // удобные функции
            const send = (ws, type, payload) => ws.send(JSON.stringify({ type, payload }));
            const broadcast = (roomId, type, payload, exceptWs = null) => {
                const room = env.ROOMS.get(roomId);
                if (!room) return;
                for (const ws of room.clients) {
                    if (ws !== exceptWs) send(ws, type, payload);
                }
            };

            const ensureRoom = (roomId) => {
                if (!env.ROOMS.has(roomId)) {
                    env.ROOMS.set(roomId, { clients: new Set(), players: new Map(), revealed: false });
                }
                return env.ROOMS.get(roomId);
            };

            // текущее соединение
            let joinedRoomId = null;

            server.addEventListener('message', (evt) => {
                let msg;
                try { msg = JSON.parse(evt.data); } catch { return; }
                const { type, payload } = msg || {};

                if (type === 'join') {
                    const { roomId, name, isAdmin } = payload;
                    joinedRoomId = roomId;
                    const room = ensureRoom(roomId);
                    room.clients.add(server);

                    // единственный админ
                    let admin = !!isAdmin;
                    if (admin) {
                        for (const p of room.players.values()) {
                            if (p.isAdmin) { admin = false; break; }
                        }
                    }

                    room.players.set(server, { id: crypto.randomUUID(), name, vote: null, isAdmin: admin });
                    // отправить текущее состояние
                    send(server, 'players_update', [...room.players.values()]);
                    send(server, 'reveal_update', room.revealed);
                    const note = env.NOTES.get(roomId) || '';
                    if (note) send(server, 'note_update', note);
                    broadcast(roomId, 'user_event', { message: `${name} подключился`, type: 'success' }, server);
                    broadcast(roomId, 'players_update', [...room.players.values()]);
                    return;
                }

                if (!joinedRoomId) return;
                const room = env.ROOMS.get(joinedRoomId);
                if (!room) return;

                if (type === 'note_update') {
                    const { roomId, note } = payload;
                    env.NOTES.set(roomId, note);
                    broadcast(roomId, 'note_update', note, server);
                }

                if (type === 'vote') {
                    const { roomId, value } = payload;
                    const player = room.players.get(server);
                    if (player) {
                        player.vote = value;
                        broadcast(roomId, 'votes_update', [...room.players.values()]);
                    }
                }

                if (type === 'reveal') {
                    const roomId = payload;
                    if (env.ROOMS.has(roomId)) {
                        env.ROOMS.get(roomId).revealed = true;
                        broadcast(roomId, 'reveal_update', true);
                    }
                }

                if (type === 'reset') {
                    const roomId = payload;
                    const r = env.ROOMS.get(roomId);
                    if (r) {
                        for (const p of r.players.values()) p.vote = null;
                        r.revealed = false;
                        env.NOTES.set(roomId, '');
                        broadcast(roomId, 'votes_update', [...r.players.values()]);
                        broadcast(roomId, 'reveal_update', false);
                        broadcast(roomId, 'note_update', '');
                    }
                }

                if (type === 'get_players') {
                    const roomId = payload;
                    const r = env.ROOMS.get(roomId);
                    if (r) broadcast(roomId, 'players_update', [...r.players.values()]);
                }

                if (type === 'request_admin_status') {
                    const roomId = payload;
                    const r = env.ROOMS.get(roomId);
                    const already = r && [...r.players.values()].some(p => p.isAdmin);
                    send(server, 'request_admin_status_result', !already);
                }
            });

            server.addEventListener('close', () => {
                if (!joinedRoomId) return;
                const room = env.ROOMS.get(joinedRoomId);
                if (!room) return;
                const p = room.players.get(server);
                if (p) {
                    room.players.delete(server);
                    room.clients.delete(server);
                    broadcast(joinedRoomId, 'players_update', [...room.players.values()]);
                    broadcast(joinedRoomId, 'user_event', { message: `${p.name} отключился`, type: 'error' });
                }
            });

            return new Response(null, { status: 101, webSocket: client });
        }

        // статику отдаст Pages (если используешь /public)
        return env.ASSETS ? env.ASSETS.fetch(request) : new Response('OK');
    }
}
