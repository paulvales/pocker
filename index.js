if (!process.env.JEST_WORKER_ID) {
    require('dotenv').config();
}

const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const packageJson = require('./package.json');
const {
    ERROR_CODES,
    HTTP_ROUTES,
    SOCKET_EVENT_NAMES,
    createHealthPayload,
    createHistoryResponse,
    createRoomSnapshotPayload,
    createSocketAckError,
    createSocketAckSuccess,
    createVersionPayload,
    getErrorCode,
    parseCreateRoomPayload,
    parseHistoryFilters,
    parseJoinPayload,
    parseNoteUpdatePayload,
    parseRoomIdPayload,
    parseSetEstimationModePayload,
    parseSetReactionPayload,
    parseSetStoryPointsPayload,
    parseTaskListUpdatePayload,
    parseTaskSelectPayload,
    parseVotePayload,
} = require('./packages/contracts');
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
const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const SOCKET_SERVER_EVENTS = SOCKET_EVENT_NAMES.server;

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
        throw new Error(ERROR_CODES.youTrackNotConfigured);
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

        if (pathname === HTTP_ROUTES.health) {
            respondJson(res, 200, createHealthPayload({
                version: APP_VERSION,
                build: APP_BUILD || null,
            }));
            return;
        }

        if (pathname === HTTP_ROUTES.version) {
            respondJson(res, 200, createVersionPayload({
                version: APP_VERSION,
                build: APP_BUILD || null,
                label: APP_VERSION_LABEL,
            }));
            return;
        }

        if (pathname === HTTP_ROUTES.history) {
            res.writeHead(302, { Location: HTTP_ROUTES.historyPage });
            res.end();
            return;
        }

        if (pathname === HTTP_ROUTES.historyPage || pathname === HTTP_ROUTES.historyHtml) {
            serveHtmlFile(res, 'history.html');
            return;
        }

        if (pathname === HTTP_ROUTES.estimationHistory) {
            try {
                const filters = parseHistoryFilters(requestUrl.searchParams);
                const [historyResult, meta] = await Promise.all([
                    estimationHistoryStore.list(filters),
                    estimationHistoryStore.listMeta(),
                ]);

                respondJson(res, 200, createHistoryResponse({
                    items: historyResult.items,
                    meta: {
                        ...meta,
                        pagination: historyResult.pagination,
                    },
                }));
            } catch (error) {
                respondJson(res, 500, {
                    error: getErrorCode(error, ERROR_CODES.historyReadFailed),
                });
            }
            return;
        }

        if (pathname === HTTP_ROUTES.home || pathname === HTTP_ROUTES.homeHtml) {
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
            error: getErrorCode(error, ERROR_CODES.internalServerError),
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
    io.to(roomId).emit(SOCKET_SERVER_EVENTS.playersUpdate, snapshot.players);
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
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.reactionsUpdate, players);
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
    io.to(roomId).emit(
        SOCKET_SERVER_EVENTS.playersUpdate,
        Object.values(leaveResult.roomState.players),
    );

    if (emitLeaveEvent) {
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.userEvent, {
            message: `${leaveResult.player.name} отключился`,
            type: 'error',
        });
    }

    return leaveResult;
}

io.on('connection', socket => {
    socket.on(SOCKET_CLIENT_EVENTS.createRoom, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomSuffix } = parseCreateRoomPayload(payload);
            const createResult = roomRegistry.createRoom({ roomSuffix });
            respond(createSocketAckSuccess({
                room: createResult.room,
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.noteUpdate, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, note } = parseNoteUpdatePayload(payload);
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const nextNote = roomRegistry.updateNote(roomId, note);
            socket.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, nextNote);
            respond(createSocketAckSuccess());
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.join, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, name, isAdmin } = parseJoinPayload(payload);
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

            respond(createSocketAckSuccess(createRoomSnapshotPayload(snapshot)));

            io.to(joinResult.roomId).emit(SOCKET_SERVER_EVENTS.userEvent, {
                message: `${joinResult.player.name} подключился`,
                type: 'success',
            });
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.taskListUpdate, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, items } = parseTaskListUpdatePayload(payload);
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const updateResult = roomRegistry.updateTaskList(roomId, items);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.taskStateUpdate, updateResult.taskState);
            io.to(roomId).emit(
                SOCKET_SERVER_EVENTS.estimationModeUpdate,
                updateResult.estimationMode,
            );
            respond(createSocketAckSuccess({
                taskState: updateResult.taskState,
                estimationMode: updateResult.estimationMode,
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.setEstimationMode, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, mode } = parseSetEstimationModePayload(payload);
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const updateResult = roomRegistry.setEstimationMode(roomId, mode);
            if (updateResult.modeChanged) {
                io.to(roomId).emit(
                    SOCKET_SERVER_EVENTS.estimationModeUpdate,
                    updateResult.estimationMode,
                );
                if (updateResult.revealChanged) {
                    io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, updateResult.revealed);
                }
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, updateResult.players);
            }
            respond(createSocketAckSuccess({
                estimationMode: updateResult.estimationMode,
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.taskSelect, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, direction } = parseTaskSelectPayload(payload);
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const selectResult = roomRegistry.selectTask(roomId, direction);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.taskStateUpdate, selectResult.taskState);
            io.to(roomId).emit(
                SOCKET_SERVER_EVENTS.estimationModeUpdate,
                selectResult.estimationMode,
            );
            respond(createSocketAckSuccess({
                taskState: selectResult.taskState,
                estimationMode: selectResult.estimationMode,
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.vote, payload => {
        try {
            const { roomId, value } = parseVotePayload(payload);
            roomRegistry.assertMembership(roomId, socket.id);
            const players = roomRegistry.recordVote(roomId, socket.id, value);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, players);
        } catch (error) {
            // ignore unauthorized vote attempts
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.setReaction, (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId, value } = parseSetReactionPayload(payload);
            roomRegistry.assertMembership(roomId, socket.id);
            const players = roomRegistry.recordReaction(roomId, socket.id, value);
            const currentPlayer = players.find(player => player.id === socket.id);
            if (currentPlayer?.reaction) {
                scheduleReactionClear(roomId, socket.id);
            } else {
                clearReactionTimer(roomId, socket.id);
            }
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.reactionsUpdate, players);
            respond(createSocketAckSuccess({
                reaction: currentPlayer ? currentPlayer.reaction : null,
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.reveal, async payload => {
        try {
            const roomId = parseRoomIdPayload(payload);
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
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, revealed);
        } catch (error) {
            // ignore unauthorized reveal attempts
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.reset, payload => {
        try {
            const roomId = parseRoomIdPayload(payload);
            roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const resetResult = roomRegistry.resetRoom(roomId);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, resetResult.players);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, resetResult.revealed);
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, resetResult.note);
        } catch (error) {
            // ignore unauthorized reset attempts
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.setStoryPoints, async (payload, callback) => {
        const respond = typeof callback === 'function' ? callback : () => {};

        try {
            const { roomId } = parseSetStoryPointsPayload(payload);
            ensureYouTrackConfig();
            const membership = roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
            const average = calcRoundedAverage(getNumericVotes(membership.roomState.players));
            if (average === null) {
                throw new Error(ERROR_CODES.noVotes);
            }

            const taskState = normalizeTaskState(membership.roomState.taskState);
            const currentTask = taskState.items[taskState.selectedIndex] || '';
            const issueIdReadable = extractIssueIdReadableFromNote(currentTask)
                || extractIssueIdReadableFromNote(membership.roomState.note);

            if (!issueIdReadable) {
                throw new Error(ERROR_CODES.issueNotFoundInNote);
            }

            await setStoryPointsInYouTrack(issueIdReadable, average);
            respond(createSocketAckSuccess({
                average,
                issueIdReadable,
                issueSummary: '',
            }));
        } catch (error) {
            respond(createSocketAckError(error));
        }
    });

    socket.on('disconnect', () => {
        removeSocketFromRoom(socket);
    });

    socket.on(SOCKET_CLIENT_EVENTS.getPlayers, payload => {
        try {
            const roomId = parseRoomIdPayload(payload);
            roomRegistry.assertMembership(roomId, socket.id);
            emitPlayersUpdate(roomId);
        } catch (error) {
            // ignore unauthorized requests
        }
    });

    socket.on(SOCKET_CLIENT_EVENTS.requestAdminStatus, (payload, callback) => {
        if (typeof callback !== 'function') {
            return;
        }

        try {
            const roomId = parseRoomIdPayload(payload);
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
