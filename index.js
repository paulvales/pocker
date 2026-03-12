const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const packageJson = require('./package.json');
const {
    createRoomRegistry,
    normalizeEstimationMode,
    normalizeTaskState,
} = require('./room-registry');

const APP_VERSION = process.env.APP_VERSION || packageJson.version || 'dev';
const APP_BUILD = process.env.APP_BUILD || '';
const APP_VERSION_LABEL = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;
const YOU_TRACK_BASE_URL = (process.env.YOUTRACK_BASE_URL || '').replace(/\/+$/, '');
const YOU_TRACK_TOKEN = process.env.YOUTRACK_TOKEN || '';
const YOU_TRACK_STORY_POINTS_FIELD = process.env.YOUTRACK_STORY_POINTS_FIELD || 'Story points';
const roomRegistry = createRoomRegistry();

function respondJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function renderIndexHtml(template) {
    return template.replace(/__APP_VERSION__/g, APP_VERSION_LABEL);
}

function ensureYouTrackConfig() {
    if (!YOU_TRACK_BASE_URL || !YOU_TRACK_TOKEN) {
        throw new Error('YOUTRACK_NOT_CONFIGURED');
    }
}

function getYouTrackHeaders() {
    return {
        Authorization: `Bearer ${YOU_TRACK_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

function getNumericVotes(players) {
    return Object.values(players || {})
        .map(player => Number(player.vote))
        .filter(vote => Number.isFinite(vote));
}

function calcRoundedAverage(values) {
    if (!values.length) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / values.length);
}

function extractIssueIdReadableFromNote(note) {
    const match = String(note || '').match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
    return match ? match[1].toUpperCase() : null;
}

async function setStoryPointsInYouTrack(issueIdReadable, storyPoints) {
    const response = await fetch(`${YOU_TRACK_BASE_URL}/api/commands`, {
        method: 'POST',
        headers: getYouTrackHeaders(),
        body: JSON.stringify({
            query: `${YOU_TRACK_STORY_POINTS_FIELD} ${storyPoints}`,
            issues: [{ idReadable: issueIdReadable }],
        }),
    });

    if (!response.ok) {
        throw new Error(`YOUTRACK_UPDATE_FAILED_${response.status}`);
    }
}

const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const { pathname } = requestUrl;

    if (pathname === '/health') {
        respondJson(res, 200, {
            status: 'ok',
            version: APP_VERSION,
            build: APP_BUILD || null,
        });
        return;
    }

    if (pathname === '/version') {
        respondJson(res, 200, {
            version: APP_VERSION,
            build: APP_BUILD || null,
            label: APP_VERSION_LABEL,
        });
        return;
    }

    if (pathname === '/' || pathname === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderIndexHtml(data.toString('utf8')));
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

function emitPlayersUpdate(roomId) {
    const snapshot = roomRegistry.getSnapshot(roomId);
    io.to(roomId).emit('players_update', snapshot.players);
    return snapshot;
}

function removeSocketFromRoom(socket, { roomId = socket.data.currentRoomId, emitLeaveEvent = true } = {}) {
    if (!roomId) {
        return null;
    }

    const leaveResult = roomRegistry.leaveRoom({
        roomId,
        socketId: socket.id,
    });
    if (!leaveResult) {
        if (socket.data.currentRoomId === roomId) {
            delete socket.data.currentRoomId;
        }
        return null;
    }

    socket.leave(roomId);
    delete socket.data.currentRoomId;
    io.to(roomId).emit('players_update', Object.values(leaveResult.roomState.players));

    if (emitLeaveEvent) {
        io.to(roomId).emit('user_event', {
            message: `${leaveResult.player.name} отключился`,
            type: 'error',
        });
    }

    return leaveResult;
}

io.on('connection', socket => {
    socket.on('create_room', ({ roomSuffix } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const createResult = roomRegistry.createRoom({ roomSuffix });
            respond({
                ok: true,
                room: createResult.room,
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('note_update', ({ roomId, note } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const nextNote = roomRegistry.updateNote(roomId, note);
            socket.to(roomId).emit('note_update', nextNote);
            respond({ ok: true });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('join', ({ roomId, name, isAdmin } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const joinResult = roomRegistry.joinRoom({
                roomId,
                socketId: socket.id,
                name,
                isAdmin,
            });
            const previousRoomId = socket.data.currentRoomId;

            if (previousRoomId && previousRoomId !== joinResult.roomId) {
                removeSocketFromRoom(socket, {
                    roomId: previousRoomId,
                    emitLeaveEvent: false,
                });
            }

            socket.join(joinResult.roomId);
            socket.data.currentRoomId = joinResult.roomId;
            const snapshot = emitPlayersUpdate(joinResult.roomId);

            respond({
                ok: true,
                room: snapshot.room,
                players: snapshot.players,
                revealed: snapshot.revealed,
                note: snapshot.note,
                taskState: snapshot.taskState,
                estimationMode: snapshot.estimationMode,
            });

            io.to(joinResult.roomId).emit('user_event', {
                message: `${joinResult.player.name} подключился`,
                type: 'success',
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('task_list_update', ({ roomId, items } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const updateResult = roomRegistry.updateTaskList(roomId, items);
            io.to(roomId).emit('task_state_update', updateResult.taskState);
            io.to(roomId).emit('estimation_mode_update', updateResult.estimationMode);
            respond({
                ok: true,
                taskState: updateResult.taskState,
                estimationMode: updateResult.estimationMode,
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('set_estimation_mode', ({ roomId, mode } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const estimationMode = roomRegistry.setEstimationMode(roomId, mode);
            io.to(roomId).emit('estimation_mode_update', estimationMode);
            respond({ ok: true, estimationMode });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('task_select', ({ roomId, direction } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const selectResult = roomRegistry.selectTask(roomId, direction);
            io.to(roomId).emit('task_state_update', selectResult.taskState);
            io.to(roomId).emit('estimation_mode_update', selectResult.estimationMode);
            respond({
                ok: true,
                taskState: selectResult.taskState,
                estimationMode: selectResult.estimationMode,
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('vote', ({ roomId, value } = {}) => {
        try {
            roomRegistry.assertMembership(roomId, socket.id);
            const players = roomRegistry.recordVote(roomId, socket.id, value);
            io.to(roomId).emit('votes_update', players);
        } catch (error) {
            // ignore unauthorized vote attempts
        }
    });

    socket.on('reveal', roomId => {
        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const revealed = roomRegistry.revealVotes(roomId);
            io.to(roomId).emit('reveal_update', revealed);
        } catch (error) {
            // ignore unauthorized reveal attempts
        }
    });

    socket.on('reset', roomId => {
        try {
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const resetResult = roomRegistry.resetRoom(roomId);
            io.to(roomId).emit('votes_update', resetResult.players);
            io.to(roomId).emit('reveal_update', resetResult.revealed);
            io.to(roomId).emit('note_update', resetResult.note);
        } catch (error) {
            // ignore unauthorized reset attempts
        }
    });

    socket.on('set_story_points', async ({ roomId } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            ensureYouTrackConfig();
            const membership = roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const average = calcRoundedAverage(getNumericVotes(membership.roomState.players));
            if (average === null) {
                throw new Error('NO_VOTES');
            }

            const taskState = normalizeTaskState(membership.roomState.taskState);
            const currentTask = taskState.items[taskState.selectedIndex] || '';
            const issueIdReadable = extractIssueIdReadableFromNote(currentTask)
                || extractIssueIdReadableFromNote(membership.roomState.note);

            if (!issueIdReadable) {
                throw new Error('ISSUE_NOT_FOUND_IN_NOTE');
            }

            await setStoryPointsInYouTrack(issueIdReadable, average);
            respond({
                ok: true,
                average,
                issueIdReadable,
                issueSummary: '',
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('disconnect', () => {
        removeSocketFromRoom(socket);
    });

    socket.on('get_players', roomId => {
        try {
            roomRegistry.assertMembership(roomId, socket.id);
            emitPlayersUpdate(roomId);
        } catch (error) {
            // ignore unauthorized requests
        }
    });

    socket.on('request_admin_status', (roomId, callback) => {
        if (typeof callback !== 'function') {
            return;
        }

        try {
            const snapshot = roomRegistry.getSnapshot(roomId, { allowMissing: true });
            const alreadyHasAdmin = snapshot.players.some(player => player.isAdmin);
            callback(!alreadyHasAdmin);
        } catch (error) {
            callback(false);
        }
    });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Socket.IO server running on port ${PORT}`);
    });
}

module.exports = {
    io,
    server,
    roomRegistry,
    normalizeEstimationMode,
};
