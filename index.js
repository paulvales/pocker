const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const packageJson = require('./package.json');

const APP_VERSION = process.env.APP_VERSION || packageJson.version || 'dev';
const APP_BUILD = process.env.APP_BUILD || '';
const APP_VERSION_LABEL = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;

function respondJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function renderIndexHtml(template) {
    return template.replace(/__APP_VERSION__/g, APP_VERSION_LABEL);
}

// HTTP-сервер с отдачей index.html
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        respondJson(res, 200, {
            status: 'ok',
            version: APP_VERSION,
            build: APP_BUILD || null,
        });
        return;
    }

    if (req.url === '/version') {
        respondJson(res, 200, {
            version: APP_VERSION,
            build: APP_BUILD || null,
            label: APP_VERSION_LABEL,
        });
        return;
    }

    if (req.url === '/' || req.url === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(renderIndexHtml(data.toString('utf8')));
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
const YOU_TRACK_BASE_URL = (process.env.YOUTRACK_BASE_URL || '').replace(/\/+$/, '');
const YOU_TRACK_TOKEN = process.env.YOUTRACK_TOKEN || '';
const YOU_TRACK_STORY_POINTS_FIELD = process.env.YOUTRACK_STORY_POINTS_FIELD || 'Story points';

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

function normalizeTaskState(taskState = {}) {
    const items = [...new Set((Array.isArray(taskState.items) ? taskState.items : [])
        .map(item => String(item || '').trim())
        .filter(Boolean))];
    const rawIndex = Number(taskState.selectedIndex);
    const safeIndex = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
    const maxIndex = items.length ? items.length - 1 : 0;

    return {
        items,
        selectedIndex: items.length ? Math.max(0, Math.min(safeIndex, maxIndex)) : 0,
    };
}

function normalizeEstimationMode(mode) {
    return mode === 'hours' ? 'hours' : 'points';
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

// 💬 Твой socket.io код — без изменений:
const rooms = {};
const notes = {};
const taskLists = {};
const estimationModes = {};
io.on('connection', (socket) => {
    socket.on('note_update', ({ roomId, note }) => {
        notes[roomId] = note;
        socket.to(roomId).emit('note_update', note);
    });

    socket.on('join', ({ roomId, name, isAdmin }, callback) => {
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

        if (typeof callback === 'function') {
            callback({
                players: Object.values(rooms[roomId].players),
                revealed: rooms[roomId].revealed,
                note: notes[roomId] || '',
                taskState: normalizeTaskState(taskLists[roomId]),
                estimationMode: normalizeEstimationMode(estimationModes[roomId]),
            });
        }

        if (notes[roomId]) {
            socket.emit('note_update', notes[roomId]);
        }
        io.to(roomId).emit('user_event', { message: `${name} подключился`, type: 'success' });
    });

    socket.on('task_list_update', ({ roomId, items } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const room = rooms[roomId];
            const player = room?.players?.[socket.id];
            if (!room || !player || !player.isAdmin) {
                throw new Error('FORBIDDEN');
            }

            const taskState = normalizeTaskState({ items, selectedIndex: 0 });
            taskLists[roomId] = taskState;
            estimationModes[roomId] = 'points';
            io.to(roomId).emit('task_state_update', taskState);
            io.to(roomId).emit('estimation_mode_update', 'points');
            respond({ ok: true, taskState, estimationMode: 'points' });
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
            const room = rooms[roomId];
            const player = room?.players?.[socket.id];
            if (!room || !player || !player.isAdmin) {
                throw new Error('FORBIDDEN');
            }

            const estimationMode = normalizeEstimationMode(mode);
            estimationModes[roomId] = estimationMode;
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
            const room = rooms[roomId];
            const player = room?.players?.[socket.id];
            if (!room || !player || !player.isAdmin) {
                throw new Error('FORBIDDEN');
            }

            const currentTaskState = normalizeTaskState(taskLists[roomId]);
            if (!currentTaskState.items.length) {
                throw new Error('TASK_LIST_EMPTY');
            }

            const step = Number(direction) < 0 ? -1 : 1;
            const taskState = normalizeTaskState({
                items: currentTaskState.items,
                selectedIndex: currentTaskState.selectedIndex + step,
            });
            taskLists[roomId] = taskState;
            estimationModes[roomId] = 'points';
            io.to(roomId).emit('task_state_update', taskState);
            io.to(roomId).emit('estimation_mode_update', 'points');
            respond({ ok: true, taskState, estimationMode: 'points' });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
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
    socket.on('set_story_points', async ({ roomId } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            ensureYouTrackConfig();
            const room = rooms[roomId];
            const player = room?.players?.[socket.id];
            if (!room || !player || !player.isAdmin) {
                throw new Error('FORBIDDEN');
            }

            const average = calcRoundedAverage(getNumericVotes(room.players));
            if (average === null) {
                throw new Error('NO_VOTES');
            }

            const taskState = normalizeTaskState(taskLists[roomId]);
            const currentTask = taskState.items[taskState.selectedIndex] || '';
            const issueIdReadable = extractIssueIdReadableFromNote(currentTask) || extractIssueIdReadableFromNote(notes[roomId]);
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
