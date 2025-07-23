const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// HTTP-сервер с отдачей index.html
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

// 💬 Твой socket.io код — без изменений:
const rooms = {};
const notes = {};
io.on('connection', (socket) => {
    socket.on('note_update', ({ roomId, note }) => {
        notes[roomId] = note;
        socket.to(roomId).emit('note_update', note);
    });

    socket.on('join', ({ roomId, name, isAdmin }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: {}, revealed: false };
        }

        const alreadyHasAdmin = Object.values(rooms[roomId].players).some(p => p.isAdmin);
        if (isAdmin && alreadyHasAdmin) {
            isAdmin = false;
        }

        rooms[roomId].players[socket.id] = { id: socket.id, name, vote: null, isAdmin };
        io.to(roomId).emit('players_update', Object.values(rooms[roomId].players));

        if (notes[roomId]) {
            socket.emit('note_update', notes[roomId]);
        }
        io.to(roomId).emit('user_event', { message: `${name} подключился`, type: 'success' });
    });

    socket.on('vote', ({ roomId, value }) => {
        const player = rooms[roomId]?.players?.[socket.id];
        if (player) {
            player.vote = value;
            io.to(roomId).emit('votes_update', Object.values(rooms[roomId].players));
        }
    });

    socket.on('reveal', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].revealed = true;
            io.to(roomId).emit('reveal_update', true);
        }
    });

    socket.on('reset', (roomId) => {
        if (rooms[roomId]) {
            Object.values(rooms[roomId].players).forEach(p => p.vote = null);
            rooms[roomId].revealed = false;
            notes[roomId] = '';
            io.to(roomId).emit('votes_update', Object.values(rooms[roomId].players));
            io.to(roomId).emit('reveal_update', false);
            io.to(roomId).emit('note_update', '');
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                const username = room.players[socket.id].name;
                delete room.players[socket.id];
                io.to(roomId).emit('players_update', Object.values(room.players));
                io.to(roomId).emit('user_event', { message: `${username} отключился`, type: 'error' });
            }
        }
    });

    socket.on('get_players', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            io.to(roomId).emit('players_update', Object.values(room.players));
        }
    });

    socket.on('request_admin_status', (roomId, callback) => {
        const alreadyHasAdmin = rooms[roomId] && Object.values(rooms[roomId].players).some(p => p.isAdmin);
        callback(!alreadyHasAdmin);
    });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Socket.IO server running on port ${PORT}`);
    });
}

module.exports = { io, server };