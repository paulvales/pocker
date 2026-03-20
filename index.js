if (!process.env.JEST_WORKER_ID) {
    require('dotenv').config();
}

const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const packageJson = require('./package.json');
const { createEstimationHistoryStore } = require('./estimation-history-store');
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
const historyStoreOptions = global.__POCKER_HISTORY_STORE_OPTIONS__ || {};
const estimationHistoryStore = createEstimationHistoryStore(historyStoreOptions);

function respondJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function renderHtmlTemplate(template) {
    return template.replace(/__APP_VERSION__/g, APP_VERSION_LABEL);
}

function extractRoomIdFromPathname(pathname) {
    const segments = String(pathname || '/')
        .split('/')
        .filter(Boolean);
    if (segments.length !== 1) {
        return '';
    }

    try {
        return decodeURIComponent(segments[0]);
    } catch (error) {
        return segments[0];
    }
}

function serveHtmlFile(res, fileName) {
    const filePath = path.join(__dirname, fileName);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error loading ${fileName}`);
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlTemplate(data.toString('utf8')));
    });
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

function getCurrentTaskReference(roomState) {
    const taskState = normalizeTaskState(roomState?.taskState);
    return taskState.items[taskState.selectedIndex]
        || String(roomState?.note || '').trim()
        || '';
}

function getHistoryTaskId(roomState) {
    const currentTaskReference = String(getCurrentTaskReference(roomState) || '').trim();
    return extractIssueIdReadableFromNote(currentTaskReference) || currentTaskReference;
}

function buildHistoryEntries(roomState) {
    const recordedAt = new Date().toISOString();
    const roomId = String(roomState?.room?.id || '').trim();
    const taskId = getHistoryTaskId(roomState);
    const estimateType = normalizeEstimationMode(roomState?.estimationMode);

    return Object.values(roomState?.players || {})
        .filter(player => player && player.vote !== null && typeof player.vote !== 'undefined')
        .map(player => ({
            roomId,
            taskId,
            participantName: player.name,
            estimate: String(player.vote),
            estimateType,
            recordedAt,
        }));
}

function getHistoryFilters(searchParams) {
    const parsedPage = Number.parseInt(String(searchParams.get('page') || ''), 10);
    const parsedPageSize = Number.parseInt(String(searchParams.get('pageSize') || ''), 10);

    return {
        roomId: String(searchParams.get('roomId') || '').trim(),
        taskId: String(searchParams.get('taskId') || '').trim(),
        participantName: String(searchParams.get('participantName') || '').trim(),
        estimate: String(searchParams.get('estimate') || '').trim(),
        estimateType: String(searchParams.get('estimateType') || '').trim(),
        recordedOn: String(searchParams.get('recordedOn') || '').trim(),
        page: Number.isFinite(parsedPage) ? parsedPage : 1,
        pageSize: Number.isFinite(parsedPageSize) ? parsedPageSize : 25,
    };
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
    void (async () => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const { pathname } = requestUrl;
        const roomIdFromPath = extractRoomIdFromPathname(pathname);

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

        if (pathname === '/history') {
            res.writeHead(302, { Location: '/history/' });
            res.end();
            return;
        }

        if (pathname === '/history/' || pathname === '/history.html') {
            serveHtmlFile(res, 'history.html');
            return;
        }

        if (pathname === '/api/estimation-history') {
            try {
                const filters = getHistoryFilters(requestUrl.searchParams);
                const [historyResult, meta] = await Promise.all([
                    estimationHistoryStore.list(filters),
                    estimationHistoryStore.listMeta(),
                ]);

                respondJson(res, 200, {
                    items: historyResult.items,
                    meta: {
                        ...meta,
                        pagination: historyResult.pagination,
                    },
                });
            } catch (error) {
                respondJson(res, 500, {
                    error: error.message || 'HISTORY_READ_FAILED',
                });
            }
            return;
        }

        if (pathname === '/' || pathname === '/index.html') {
            serveHtmlFile(res, 'index.html');
            return;
        }

        if (roomIdFromPath && roomRegistry.isValidRoomId(roomIdFromPath)) {
            if (!pathname.endsWith('/')) {
                const normalizedRoomId = roomRegistry.getPublicRoom(roomIdFromPath).id;
                res.writeHead(302, {
                    Location: `/${encodeURIComponent(normalizedRoomId)}/`,
                });
                res.end();
                return;
            }

            serveHtmlFile(res, 'index.html');
            return;
        }

        res.writeHead(404);
        res.end('Not found');
    })().catch(error => {
        respondJson(res, 500, {
            error: error.message || 'INTERNAL_SERVER_ERROR',
        });
    });
});

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});
const REACTION_TTL_MS = 3000;
const reactionClearTimers = new Map();

function emitPlayersUpdate(roomId) {
    const snapshot = roomRegistry.getSnapshot(roomId);
    io.to(roomId).emit('players_update', snapshot.players);
    return snapshot;
}

function getReactionTimerKey(roomId, socketId) {
    return `${roomId}:${socketId}`;
}

function clearReactionTimer(roomId, socketId) {
    const timerKey = getReactionTimerKey(roomId, socketId);
    const timer = reactionClearTimers.get(timerKey);
    if (timer) {
        clearTimeout(timer);
        reactionClearTimers.delete(timerKey);
    }
}

function scheduleReactionClear(roomId, socketId) {
    clearReactionTimer(roomId, socketId);
    const timerKey = getReactionTimerKey(roomId, socketId);
    const timer = setTimeout(() => {
        reactionClearTimers.delete(timerKey);

        try {
            const players = roomRegistry.recordReaction(roomId, socketId, null);
            io.to(roomId).emit('reactions_update', players);
        } catch (error) {
            // ignore cleanup for sockets that already left the room
        }
    }, REACTION_TTL_MS);

    reactionClearTimers.set(timerKey, timer);
}

function removeSocketFromRoom(socket, { roomId = socket.data.currentRoomId, emitLeaveEvent = true } = {}) {
    if (!roomId) {
        return null;
    }

    clearReactionTimer(roomId, socket.id);

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
            const updateResult = roomRegistry.setEstimationMode(roomId, mode);
            if (updateResult.modeChanged) {
                io.to(roomId).emit('estimation_mode_update', updateResult.estimationMode);
                if (updateResult.revealChanged) {
                    io.to(roomId).emit('reveal_update', updateResult.revealed);
                }
                io.to(roomId).emit('votes_update', updateResult.players);
            }
            respond({ ok: true, estimationMode: updateResult.estimationMode });
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

    socket.on('set_reaction', ({ roomId, value } = {}, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            roomRegistry.assertMembership(roomId, socket.id);
            const players = roomRegistry.recordReaction(roomId, socket.id, value);
            const currentPlayer = players.find(player => player.id === socket.id);
            if (currentPlayer?.reaction) {
                scheduleReactionClear(roomId, socket.id);
            } else {
                clearReactionTimer(roomId, socket.id);
            }
            io.to(roomId).emit('reactions_update', players);
            respond({
                ok: true,
                reaction: currentPlayer ? currentPlayer.reaction : null,
            });
        } catch (error) {
            respond({
                ok: false,
                error: error.message || 'UNKNOWN_ERROR',
            });
        }
    });

    socket.on('reveal', async roomId => {
        try {
            const membership = roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const shouldRecordHistory = !membership.roomState.revealed;
            const historyEntries = shouldRecordHistory ? buildHistoryEntries(membership.roomState) : [];

            if (shouldRecordHistory && historyEntries.length) {
                try {
                    await estimationHistoryStore.append(historyEntries);
                } catch (error) {
                    console.error('Failed to persist estimation history', error);
                }
            }

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
    estimationHistoryStore.initialize()
        .then(() => {
            server.listen(PORT, '0.0.0.0', () => {
                console.log(`Socket.IO server running on port ${PORT}`);
            });
        })
        .catch(error => {
            console.error('Failed to initialize estimation history store', error);
            process.exit(1);
        });
}

module.exports = {
    estimationHistoryStore,
    io,
    server,
    roomRegistry,
    normalizeEstimationMode,
};
