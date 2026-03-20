const {
    ERROR_CODES,
    SOCKET_EVENT_NAMES,
    createRoomSnapshotPayload,
    createSocketAckError,
    createSocketAckSuccess,
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

const REACTION_TTL_MS = 3000;
const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const SOCKET_SERVER_EVENTS = SOCKET_EVENT_NAMES.server;

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

function registerRoomHandlers({
    io,
    roomRegistry,
    estimationHistoryStore,
    config,
    saasFoundationService,
}) {
    const youTrackClient = createYouTrackClient(config.integrations.youTrack);
    const reactionClearTimers = new Map();

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
                message: `${leaveResult.player.name} отключился`,
                type: 'error',
            });
        }

        return leaveResult;
    }

    roomRegistry.subscribe((payload) => {
        if (payload?.source !== 'remote') {
            return;
        }

        void emitRemoteRoomState(payload.roomId).catch(() => {});
    });

    io.on('connection', socket => {
        function resolveSaasContext() {
            return saasFoundationService.resolveSocketContext(socket);
        }

        socket.on(SOCKET_CLIENT_EVENTS.createRoom, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
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
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.noteUpdate, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, note } = parseNoteUpdatePayload(payload);
                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const nextNote = await roomRegistry.updateNote(roomId, note);
                socket.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, nextNote);
                respond(createSocketAckSuccess());
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.join, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, name, isAdmin } = parseJoinPayload(payload);
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
                    message: `${joinResult.player.name} подключился`,
                    type: 'success',
                });
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.taskListUpdate, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, items } = parseTaskListUpdatePayload(payload);
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
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setEstimationMode, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, mode } = parseSetEstimationModePayload(payload);
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
                }
                respond(createSocketAckSuccess({
                    estimationMode: updateResult.estimationMode,
                }));
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.taskSelect, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, direction } = parseTaskSelectPayload(payload);
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
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.vote, async payload => {
            try {
                const { roomId, value } = parseVotePayload(payload);
                await roomRegistry.assertMembership(roomId, socket.id);
                const players = await roomRegistry.recordVote(roomId, socket.id, value);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, players);
            } catch (error) {
                // Ignore unauthorized vote attempts.
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setReaction, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId, value } = parseSetReactionPayload(payload);
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
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.reveal, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
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
                            console.error('Failed to persist estimation history', error);
                        }
                    }
                }

                io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, revealed);
            } catch (error) {
                // Ignore unauthorized reveal attempts.
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.reset, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
                await roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
                const resetResult = await roomRegistry.resetRoom(roomId);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.votesUpdate, resetResult.players);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.revealUpdate, resetResult.revealed);
                io.to(roomId).emit(SOCKET_SERVER_EVENTS.noteUpdate, resetResult.note);
            } catch (error) {
                // Ignore unauthorized reset attempts.
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.setStoryPoints, async (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const { roomId } = parseSetStoryPointsPayload(payload);
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
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on('disconnect', () => {
            void removeSocketFromRoom(socket);
        });

        socket.on(SOCKET_CLIENT_EVENTS.getPlayers, async payload => {
            try {
                const roomId = parseRoomIdPayload(payload);
                await roomRegistry.assertMembership(roomId, socket.id);
                await emitPlayersUpdate(roomId);
            } catch (error) {
                // Ignore unauthorized requests.
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
                callback(false);
            }
        });
    });
}

module.exports = {
    registerRoomHandlers,
};
