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

function registerRoomHandlers({
    io,
    roomRegistry,
    estimationHistoryStore,
    config,
    saasFoundationService,
}) {
    const youTrackClient = createYouTrackClient(config.integrations.youTrack);
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

    function removeSocketFromRoom(socket, {
        roomId = socket.data.currentRoomId,
        emitLeaveEvent = true,
    } = {}) {
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
                message: `${leaveResult.player.name} \u043E\u0442\u043A\u043B\u044E\u0447\u0438\u043B\u0441\u044F`,
                type: 'error',
            });
        }

        return leaveResult;
    }

    io.on('connection', socket => {
        function resolveSaasContext() {
            return saasFoundationService.resolveSocketContext(socket);
        }

        socket.on(SOCKET_CLIENT_EVENTS.createRoom, (payload, callback) => {
            const respond = createAckResponder(callback);

            try {
                const saasContext = resolveSaasContext();
                saasFoundationService.assertCanCreateRoom(saasContext);
                const { roomSuffix } = parseCreateRoomPayload(payload);
                const createResult = roomRegistry.createRoom({ roomSuffix });
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

        socket.on(SOCKET_CLIENT_EVENTS.noteUpdate, (payload, callback) => {
            const respond = createAckResponder(callback);

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
            const respond = createAckResponder(callback);

            try {
                const { roomId, name, isAdmin } = parseJoinPayload(payload);
                const saasContext = resolveSaasContext();
                saasFoundationService.assertCanJoinRoom(saasContext, {
                    roomId,
                    isAdmin,
                });
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
                saasFoundationService.registerRoom(saasContext, {
                    roomId: joinResult.room.id,
                    createdAt: joinResult.room.createdAt,
                });
                const snapshot = emitPlayersUpdate(joinResult.roomId);

                respond(createSocketAckSuccess(createRoomSnapshotPayload(snapshot)));

                io.to(joinResult.roomId).emit(SOCKET_SERVER_EVENTS.userEvent, {
                    message: `${joinResult.player.name} \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u043B\u0441\u044F`,
                    type: 'success',
                });
            } catch (error) {
                respond(createSocketAckError(error));
            }
        });

        socket.on(SOCKET_CLIENT_EVENTS.taskListUpdate, (payload, callback) => {
            const respond = createAckResponder(callback);

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
            const respond = createAckResponder(callback);

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
            const respond = createAckResponder(callback);

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
            const respond = createAckResponder(callback);

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
                const historyEntries = shouldRecordHistory
                    ? buildHistoryEntries(membership.roomState)
                    : [];

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
            const respond = createAckResponder(callback);

            try {
                const { roomId } = parseSetStoryPointsPayload(payload);
                const membership = roomRegistry.assertMembership(roomId, socket.id, { requireAdmin: true });
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
                const saasContext = resolveSaasContext();
                callback(!alreadyHasAdmin && saasFoundationService.canRequestAdminSeat(
                    saasContext,
                    roomId,
                ));
            } catch (error) {
                callback(false);
            }
        });
    });

    return {
        emitPlayersUpdate,
        removeSocketFromRoom,
    };
}

module.exports = {
    registerRoomHandlers,
};
