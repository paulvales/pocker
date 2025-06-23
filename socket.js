const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer();
const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join', ({ roomId, name }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { players: {}, revealed: false };
        }

        rooms[roomId].players[socket.id] = { name, vote: null };
        io.to(roomId).emit('players_update', Object.values(rooms[roomId].players));
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
            io.to(roomId).emit('votes_update', Object.values(rooms[roomId].players));
            io.to(roomId).emit('reveal_update', false);
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                io.to(roomId).emit('players_update', Object.values(room.players));
            }
        }
    });

    socket.on('get_players', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            io.to(roomId).emit('players_update', Object.values(room.players));
        }
    });

});

server.listen(3000, () => {
    console.log('Socket.IO server running at http://localhost:3000/');
});
