const { buildHistoryEntries } = require('../utils/helpers');
const { createChildLogger } = require('../utils/logger');

function createSocketHandler({
    io,
    roomRegistry,
    estimationHistoryStore,
    YOU_TRACK_BASE_URL,
    YOU_TRACK_TOKEN,
    YOU_TRACK_STORY_POINTS_FIELD,
}) {
    const { normalizeTaskState } = require('../../room-registry');
    const log = createChildLogger({ module: 'socket' });
    const REACTION_TTL_MS = 3000;
    const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
    const DEFAULT_STALE_PLAYER_TTL_MS = 120000;
    const DEFAULT_STALE_CLEANUP_INTERVAL_MS = 30000;
    const reactionClearTimers = new Map();

    function parseEnvMilliseconds(rawValue, fallback, minimum) {
        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isFinite(parsed) || parsed < minimum) {
            return fallback;
        }
        return parsed;
    }

    const HEARTBEAT_INTERVAL_MS = parseEnvMilliseconds(
        process.env.PLAYER_HEARTBEAT_INTERVAL_MS,
        DEFAULT_HEARTBEAT_INTERVAL_MS,
        5000,
    );
    const STALE_PLAYER_TTL_MS = parseEnvMilliseconds(
        process.env.STALE_PLAYER_TTL_MS,
        DEFAULT_STALE_PLAYER_TTL_MS,
        HEARTBEAT_INTERVAL_MS * 2,
    );
    const STALE_CLEANUP_INTERVAL_MS = parseEnvMilliseconds(
        process.env.STALE_CLEANUP_INTERVAL_MS,
        DEFAULT_STALE_CLEANUP_INTERVAL_MS,
        10000,
    );

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

    function calcRoundedAverage(values) {
        if (!values.length) return null;
        const sum = values.reduce((acc, value) => acc + value, 0);
        return Math.round(sum / values.length);
    }

    function getNumericVotes(players) {
        return Object.values(players || {})
            .map(player => Number(player.vote))
            .filter(vote => Number.isFinite(vote));
    }

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

    function runStalePlayerCleanup() {
        let removedPlayers = [];
        try {
            removedPlayers = roomRegistry.removeStalePlayers({
                ttlMs: STALE_PLAYER_TTL_MS,
                isSocketActive: socketId => {
                    const trackedSocket = io.sockets.sockets.get(socketId);
                    return Boolean(trackedSocket && trackedSocket.connected);
                },
            });
        } catch (error) {
            log.error({ err: error }, 'Failed to cleanup stale players');
            return;
        }

        removedPlayers.forEach(({ roomId, roomState, player }) => {
            clearReactionTimer(roomId, player.id);
            io.to(roomId).emit('players_update', Object.values(roomState.players));
            io.to(roomId).emit('user_event', {
                message: `${player.name} отключился (таймаут соединения)`,
                type: 'warning',
            });
        });
    }

    const staleCleanupTimer = setInterval(runStalePlayerCleanup, STALE_CLEANUP_INTERVAL_MS);
    if (typeof staleCleanupTimer.unref === 'function') {
        staleCleanupTimer.unref();
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

    function registerSocketHandlers(socket) {
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

        socket.on('join', ({ roomId, name, isAdmin, sessionId } = {}, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};

            try {
                const joinResult = roomRegistry.joinRoom({
                    roomId,
                    socketId: socket.id,
                    name,
                    isAdmin,
                    sessionId,
                });
                const previousRoomId = socket.data.currentRoomId;

                if (Array.isArray(joinResult.replacedSocketIds)) {
                    joinResult.replacedSocketIds.forEach(replacedSocketId => {
                        clearReactionTimer(joinResult.roomId, replacedSocketId);
                        const previousSocket = io.sockets.sockets.get(replacedSocketId);
                        if (previousSocket) {
                            previousSocket.leave(joinResult.roomId);
                            delete previousSocket.data.currentRoomId;
                        }
                    });
                }

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
                    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
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

        socket.on('heartbeat', ({ roomId } = {}, callback) => {
            const respond = typeof callback === 'function' ? callback : null;

            try {
                roomRegistry.recordHeartbeat(roomId, socket.id);
                if (respond) {
                    respond({ ok: true });
                }
            } catch (error) {
                if (respond) {
                    respond({
                        ok: false,
                        error: error.message || 'UNKNOWN_ERROR',
                    });
                }
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

        socket.on('vote', ({ roomId, value } = {}, callback) => {
            const respond = typeof callback === 'function' ? callback : () => {};

            try {
                roomRegistry.assertMembership(roomId, socket.id);
                const players = roomRegistry.recordVote(roomId, socket.id, value);
                io.to(roomId).emit('votes_update', players);
                respond({
                    ok: true,
                    players,
                    value,
                });
            } catch (error) {
                respond({
                    ok: false,
                    error: error.message || 'UNKNOWN_ERROR',
                });
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
                        log.error({ err: error }, 'Failed to persist estimation history');
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
    }

    return { registerSocketHandlers };
}

module.exports = { createSocketHandler };
