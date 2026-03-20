const {
    ERROR_CODES,
    SOCKET_EVENT_NAMES,
    createRoomSnapshotPayload,
    createSocketAckError,
    createSocketAckSuccess,
    getErrorCode,
    parseCreateRoomPayload,
    parseJoinPayload,
    parseNoteUpdatePayload,
    parseRoomIdPayload,
    parseSetEstimationModePayload,
    parseSetReactionPayload,
    parseSetStoryPointsPayload,
    parseTaskListUpdatePayload,
    parseTaskSelectPayload,
    parseVotePayload,
} = require('../../../../packages/contracts');
const { createYouTrackClient } = require('../integrations/create-youtrack-client');
const {
    buildHistoryEntries,
    calcRoundedAverage,
    extractIssueIdReadableFromNote,
    getCurrentTaskReference,
    getNumericVotes,
} = require('../services/room-estimation-service');
const { createRateLimiter } = require('../security/create-rate-limiter');

const REACTION_TTL_MS = 3000;
const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const SOCKET_SERVER_EVENTS = SOCKET_EVENT_NAMES.server;
const EXPECTED_SOCKET_ERROR_CODES = new Set([
    ERROR_CODES.forbidden,
    ERROR_CODES.unauthorized,
    ERROR_CODES.rateLimited,
    ERROR_CODES.roomNotFound,
    ERROR_CODES.roomAlreadyExists,
    ERROR_CODES.roomSuffixRequired,
    ERROR_CODES.roomSuffixInvalid,
    ERROR_CODES.nameRequired,
    ERROR_CODES.adminAlreadyExists,
    ERROR_CODES.taskListEmpty,
    ERROR_CODES.reactionInvalid,
    ERROR_CODES.noVotes,
    ERROR_CODES.issueNotFoundInNote,
    ERROR_CODES.youTrackNotConfigured,
]);

function createAckResponder(callback) {
    return typeof callback === 'function' ? callback : () => {};
}

function getSocketRoomSize(io, roomId) {
    return io.sockets.adapter.rooms.get(roomId)?.size || 0;
}

function getExplicitActorId(socket) {
    const authActorId = String(socket?.handshake?.auth?.actorId || '').trim();
    if (authActorId) {
        return authActorId;
    }

    const headerActorId = String(
        socket?.handshake?.headers?.['x-pocker-actor-id'] || '',
    ).trim();
    return headerActorId || null;
}

function getSocketClientIdentity(socket) {
    const actorId = getExplicitActorId(socket);
    if (actorId) {
        return `actor:${actorId}`;
    }

    const forwardedForHeader = String(
        socket?.handshake?.headers?.['x-forwarded-for'] || '',
    ).trim();
    if (forwardedForHeader) {
        const forwardedAddress = forwardedForHeader
            .split(',')
            .map(item => String(item || '').trim())
            .find(Boolean);
        if (forwardedAddress) {
            return `ip:${forwardedAddress}`;
        }
    }

    const remoteAddress = String(socket?.handshake?.address || '').trim();
    if (remoteAddress) {
        return `ip:${remoteAddress}`;
    }

    return `socket:${String(socket?.id || '').trim() || 'unknown'}`;
}

function buildRateLimitKey(socket, actionName, roomId = '') {
    return [
        getSocketClientIdentity(socket),
        String(actionName || '').trim(),
        String(roomId || '').trim(),
    ].join(':');
}

function registerRoomHandlers({
    auditLogStore,
    io,
    roomRegistry,
    estimationHistoryStore,
    config,
    errorMonitor,
    logger,
    saasFoundationService,
}) {
    const youTrackClient = createYouTrackClient(config.integrations.youTrack);
    const rateLimiter = createRateLimiter();
    const reactionClearTimers = new Map();
    const socketLogger = logger.child({ component: 'socket' });

    async function writeAuditEvent(saasContext, {
        eventType,
        roomId = null,
        outcome = 'success',
        metadata = {},
    }) {
        try {
            await auditLogStore.append({
                eventType,
                actorId: saasContext?.actor?.id || null,
                actorKind: saasContext?.actor?.kind || null,
                workspaceId: saasContext?.workspace?.id || null,
                roomId,
                outcome,
                metadata,
            });
        } catch (error) {
            errorMonitor.capture(error, {
                event: 'audit.write_failed',
                auditEventType: eventType,
                roomId,
            });
        }
    }

    function applyRateLimit(socket, {
        actionName,
        limitConfig,
        callback = null,
        roomId = socket.data.currentRoomId || null,
    }) {
        const result = rateLimiter.consume({
            key: buildRateLimitKey(socket, actionName, roomId),
            limit: limitConfig.limit,
            windowMs: limitConfig.windowMs,
        });

        if (result.allowed) {
            return false;
        }

        socketLogger.warn('socket.rate_limited', {
            actionName,
            clientIdentity: getSocketClientIdentity(socket),
            socketId: socket.id,
            roomId,
            resetAt: new Date(result.resetAt).toISOString(),
        });

        if (typeof callback === 'function') {
            callback(createSocketAckError(new Error(ERROR_CODES.rateLimited)));
        }

        return true;
    }

    function logSocketFailure(actionName, error, socket, roomId = null) {
        const errorCode = getErrorCode(error, ERROR_CODES.unknown);
        const logMethod = EXPECTED_SOCKET_ERROR_CODES.has(errorCode)
            ? 'warn'
            : 'error';

        socketLogger[logMethod]('socket.action.failed', {
            actionName,
            errorCode,
            socketId: socket.id,
            roomId,
        });

        if (logMethod === 'error') {
            errorMonitor.capture(error, {
                event: 'socket.action.failed',
                actionName,
                socketId: socket.id,
                roomId,
            });
        }
    }

    async function emitPlayersUpdate(roomId) {
        const snapshot = await roomRegistry.getSnapshot(roomId, { allowMissing: true });
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.playersUpdate, snapshot.players);
        return snapshot;
    }

    async function emitRemoteRoomState(roomId) {
        if (!getSocketRoomSize(io, roomId)) {
            return null;
        }

        const snapshot = await roomRegistry.getSnapshot(roomId, { allowMissing: true });
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.playersUpdate, snapshot.players);
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, snapshot.players);
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, snapshot.note);
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.taskStateUpdate, snapshot.taskState);
        io.to(roomId).emit(
            SOCKET_SERVER_EVENTS.estimationModeUpdate,
            snapshot.estimationMode,
        );
        io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, snapshot.revealed);
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

            void (async () => {
                try {
                    const players = await roomRegistry.recordReaction(roomId, socketId, null);
                    io.to(roomId).emit(SOCKET_SERVER_EVENTS.reactionsUpdate, players);
                } catch (error) {
                    // Ignore cleanup for sockets that already left the room.
                }
            })();
        }, REACTION_TTL_MS);

        reactionClearTimers.set(timerKey, timer);
    }

    async function removeSocketFromRoom(socket, {
        roomId = socket.data.currentRoomId,
        emitLeaveEvent = true,
    } = {}) {
        if (!roomId) {
            return null;
        }

        clearReactionTimer(roomId, socket.id);

        const leaveResult = await roomRegistry.leaveRoom({
            roomId,
            socketId: socket.id,
        });
        if (!leaveResult) {
            if (socket.data.currentRoomId === roomId) {
                delete socket.data.currentRoomId;
                delete socket.data.currentSessionId;
            }
            return null;
        }

        socket.leave(roomId);
        delete socket.data.currentRoomId;
        delete socket.data.currentSessionId;
        io.to(roomId).emit(
            SOCKET_SERVER_EVENTS.playersUpdate,
            leaveResult.roomState.players,
        );

        if (emitLeaveEvent) {
            io.to(roomId).emit(SOCKET_SERVER_EVENTS.userEvent, {
                message: `${leaveResult.player.name} disconnected`,
                type: 'error',
            });
        }

        socketLogger.info('room.left', {
            roomId,
            socketId: socket.id,
            playerId: leaveResult.player.id,
        });

        return leaveResult;
    }

    roomRegistry.subscribe((payload) => {
        if (payload?.source !== 'remote') {
            return;
        }

        socketLogger.info('room.remote_event.replicated', {
            roomId: payload.roomId,
            eventType: payload.eventType,
            revision: payload.revision,
        });
        void emitRemoteRoomState(payload.roomId).catch((error) => {
            errorMonitor.capture(error, {
                event: 'room.remote_event.replicated_failed',
                roomId: payload.roomId,
            });
        });
    });

    io.on('connection', socket => {
        function resolveSaasContext() {
            return saasFoundationService.resolveSocketContext(socket);
        }

        const connectionContext = resolveSaasContext();
        socketLogger.info('socket.connected', {
            socketId: socket.id,
            actorId: connectionContext.actor.id,
            actorKind: connectionContext.actor.kind,
            workspaceId: connectionContext.workspace.id,
        });

        socket.on(SOCKET_CLIENT_EVENTS.createRoom, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.createRoom,
                    limitConfig: config.security.rateLimits.createRoom,
                    callback: respond,
                })) {
                    return;
                }

                const saasContext = resolveSaasContext();
                saasFoundationService.assertCanCreateRoom(saasContext);
                const { roomSuffix } = parseCreateRoomPayload(payload);
                const createResult = await roomRegistry.createRoom({ roomSuffix });
                saasFoundationService.registerRoom(saasContext, {
                    roomId: createResult.room.id,
                    createdAt: createResult.room.createdAt,
                });
                respond(createSocketAckSuccess({
                    room: createResult.room,
                }));
                socketLogger.info('room.created', {
                    roomId: createResult.room.id,
                    socketId: socket.id,
                });
                await writeAuditEvent(saasContext, {
                    eventType: 'room.created',
                    roomId: createResult.room.id,
                    metadata: {
                        roomSuffix,
                    },
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.createRoom, error, socket);
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.noteUpdate, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, note } = parseNoteUpdatePayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.noteUpdate,
                    limitConfig: config.security.rateLimits.mutation,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const nextNote = await roomRegistry.updateNote(roomId, note);
                socket.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, nextNote);
                respond(createSocketAckSuccess());
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.note.updated',
                    roomId,
                    metadata: {
                        noteLength: String(nextNote).length,
                    },
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.noteUpdate, error, socket, payload?.roomId);
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.join, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, name, isAdmin } = parseJoinPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.join,
                    limitConfig: config.security.rateLimits.join,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                const saasContext = resolveSaasContext();
                saasFoundationService.assertCanJoinRoom(saasContext, {
                    roomId,
                    isAdmin,
                });
                const joinResult = await roomRegistry.joinRoom({
                    roomId,
                    socketId: socket.id,
                    name,
                    isAdmin,
                    actorId: getExplicitActorId(socket),
                    sessionId: socket.data.currentSessionId || null,
                });
                const previousRoomId = joinResult.previousJoinState?.roomId
                    || socket.data.currentRoomId;

                if (previousRoomId && previousRoomId !== joinResult.roomId) {
                    clearReactionTimer(previousRoomId, socket.id);
                    socket.leave(previousRoomId);
                    await emitPlayersUpdate(previousRoomId);
                }

                socket.join(joinResult.roomId);
                socket.data.currentRoomId = joinResult.roomId;
                socket.data.currentSessionId = joinResult.session.sessionId;
                saasFoundationService.registerRoom(saasContext, {
                    roomId: joinResult.room.id,
                    createdAt: joinResult.room.createdAt,
                });
                const snapshot = await emitPlayersUpdate(joinResult.roomId);

                respond(createSocketAckSuccess(createRoomSnapshotPayload(snapshot)));

                io.to(joinResult.roomId).emit(SOCKET_SERVER_EVENTS.userEvent, {
                    message: `${joinResult.player.name} joined`,
                    type: 'success',
                });
                socketLogger.info('room.joined', {
                    roomId: joinResult.roomId,
                    socketId: socket.id,
                    actorId: saasContext.actor.id,
                    isAdmin: Boolean(isAdmin),
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.join, error, socket, payload?.roomId);
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.taskListUpdate, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, items } = parseTaskListUpdatePayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.taskListUpdate,
                    limitConfig: config.security.rateLimits.mutation,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const updateResult = await roomRegistry.updateTaskList(roomId, items);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.taskStateUpdate, updateResult.taskState);
                io.to(roomId).emit(
                    SOCKET_SERVER_EVENTS.estimationModeUpdate,
                    updateResult.estimationMode,
                );
                respond(createSocketAckSuccess({
                    taskState: updateResult.taskState,
                    estimationMode: updateResult.estimationMode,
                }));
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.task_list.updated',
                    roomId,
                    metadata: {
                        itemCount: updateResult.taskState.items.length,
                    },
                });
            } catch (error) {
                logSocketFailure(
                    SOCKET_CLIENT_EVENTS.taskListUpdate,
                    error,
                    socket,
                    payload?.roomId,
                );
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setEstimationMode, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, mode } = parseSetEstimationModePayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.setEstimationMode,
                    limitConfig: config.security.rateLimits.mutation,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const updateResult = await roomRegistry.setEstimationMode(roomId, mode);
                if (updateResult.modeChanged) {
                    io.to(roomId).emit(
                        SOCKET_SERVER_EVENTS.estimationModeUpdate,
                        updateResult.estimationMode,
                    );
                    if (updateResult.revealChanged) {
                        io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, updateResult.revealed);
                    }
                    io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, updateResult.players);
                    await writeAuditEvent(resolveSaasContext(), {
                        eventType: 'room.estimation_mode.updated',
                        roomId,
                        metadata: {
                            estimationMode: updateResult.estimationMode,
                        },
                    });
                }
                respond(createSocketAckSuccess({
                    estimationMode: updateResult.estimationMode,
                }));
            } catch (error) {
                logSocketFailure(
                    SOCKET_CLIENT_EVENTS.setEstimationMode,
                    error,
                    socket,
                    payload?.roomId,
                );
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.taskSelect, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, direction } = parseTaskSelectPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.taskSelect,
                    limitConfig: config.security.rateLimits.mutation,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const selectResult = await roomRegistry.selectTask(roomId, direction);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.taskStateUpdate, selectResult.taskState);
                io.to(roomId).emit(
                    SOCKET_SERVER_EVENTS.estimationModeUpdate,
                    selectResult.estimationMode,
                );
                respond(createSocketAckSuccess({
                    taskState: selectResult.taskState,
                    estimationMode: selectResult.estimationMode,
                }));
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.task.selected',
                    roomId,
                    metadata: {
                        selectedIndex: selectResult.taskState.selectedIndex,
                    },
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.taskSelect, error, socket, payload?.roomId);
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.vote, async payload => {
            try {
                const { roomId, value } = parseVotePayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.vote,
                    limitConfig: config.security.rateLimits.vote,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id);
                const players = await roomRegistry.recordVote(roomId, socket.id, value);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, players);
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.vote, error, socket, payload?.roomId);
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setReaction, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, value } = parseSetReactionPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.setReaction,
                    limitConfig: config.security.rateLimits.reaction,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                const membership = await roomRegistry.assertMembership(roomId, socket.id);
                const players = await roomRegistry.recordReaction(roomId, socket.id, value);
                const currentPlayer = players.find(player => player.id === membership.player.id);
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
                logSocketFailure(SOCKET_CLIENT_EVENTS.setReaction, error, socket, payload?.roomId);
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.reveal, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.reveal,
                    limitConfig: config.security.rateLimits.mutation,
                    roomId,
                })) {
                    return;
                }

                const membership = await roomRegistry.assertMembership(roomId, socket.id, {
                    requireAdmin: true,
                });
                const shouldRecordHistory = !membership.roomState.revealed;

                const revealed = await roomRegistry.revealVotes(roomId);
                if (shouldRecordHistory) {
                    const revealedSnapshot = await roomRegistry.getSnapshot(roomId);
                    const historyEntries = buildHistoryEntries(revealedSnapshot);

                    if (historyEntries.length) {
                        try {
                            await estimationHistoryStore.append(historyEntries);
                        } catch (error) {
                            errorMonitor.capture(error, {
                                event: 'history.append.failed',
                                roomId,
                            });
                        }
                    }
                }

                io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, revealed);
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.votes.revealed',
                    roomId,
                    metadata: {
                        revealed,
                    },
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.reveal, error, socket, payload?.roomId || payload);
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.reset, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.reset,
                    limitConfig: config.security.rateLimits.mutation,
                    roomId,
                })) {
                    return;
                }

                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const resetResult = await roomRegistry.resetRoom(roomId);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, resetResult.players);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, resetResult.revealed);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, resetResult.note);
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.reset',
                    roomId,
                });
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.reset, error, socket, payload?.roomId || payload);
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setStoryPoints, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId } = parseSetStoryPointsPayload(payload);
                if (applyRateLimit(socket, {
                    actionName: SOCKET_CLIENT_EVENTS.setStoryPoints,
                    limitConfig: config.security.rateLimits.mutation,
                    callback: respond,
                    roomId,
                })) {
                    return;
                }

                const membership = await roomRegistry.assertMembership(roomId, socket.id, {
                    requireAdmin: true,
                });
                const average = calcRoundedAverage(getNumericVotes(membership.roomState.players));
                if (average === null) {
                    throw new Error(ERROR_CODES.noVotes);
                }

                const issueIdReadable = extractIssueIdReadableFromNote(
                    getCurrentTaskReference(membership.roomState),
                ) || extractIssueIdReadableFromNote(membership.roomState.note);

                if (!issueIdReadable) {
                    throw new Error(ERROR_CODES.issueNotFoundInNote);
                }

                await youTrackClient.setStoryPoints(issueIdReadable, average);
                respond(createSocketAckSuccess({
                    average,
                    issueIdReadable,
                    issueSummary: '',
                }));
                await writeAuditEvent(resolveSaasContext(), {
                    eventType: 'room.story_points.pushed',
                    roomId,
                    metadata: {
                        issueIdReadable,
                        average,
                    },
                });
            } catch (error) {
                logSocketFailure(
                    SOCKET_CLIENT_EVENTS.setStoryPoints,
                    error,
                    socket,
                    payload?.roomId,
                );
                respond(createSocketAckError(error));
            }
        });

        socket.on('disconnect', () => {
            socketLogger.info('socket.disconnected', {
                socketId: socket.id,
                roomId: socket.data.currentRoomId || null,
            });
            void removeSocketFromRoom(socket);
        });

        socket.on(SOCKET_CLIENT_EVENTS.getPlayers, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
                await roomRegistry.assertMembership(roomId, socket.id);
                await emitPlayersUpdate(roomId);
            } catch (error) {
                logSocketFailure(SOCKET_CLIENT_EVENTS.getPlayers, error, socket, payload?.roomId || payload);
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.requestAdminStatus, async (payload, callback) => {
            if (typeof callback !== 'function') {
                return;
            }

            try {
                const roomId = parseRoomIdPayload(payload);
                const saasContext = resolveSaasContext();
                const adminSeatAvailable = await roomRegistry.isAdminSeatAvailable(roomId);
                callback(adminSeatAvailable && saasFoundationService.canRequestAdminSeat(
                    saasContext,
                    roomId,
                ));
            } catch (error) {
                logSocketFailure(
                    SOCKET_CLIENT_EVENTS.requestAdminStatus,
                    error,
                    socket,
                    payload?.roomId || payload,
                );
                callback(false);
            }
        });
    });
}

module.exports = {
    registerRoomHandlers,
};
