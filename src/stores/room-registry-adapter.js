const { createRoomRegistry } = require('../room-registry');
const { createRedisRoomStore } = require('./redis-room-store');
const { createChildLogger } = require('../utils/logger');

function createRoomRegistryWithRedis() {
    const log = createChildLogger({ module: 'room-registry-redis' });
    const registry = createRoomRegistry();
    const redisStore = createRedisRoomStore();

    redisStore.initialize();

    function wrapWithSync(fn, syncFn) {
        return function (...args) {
            const result = fn.apply(this, args);

            if (syncFn && result) {
                const roomId = args[0];
                const roomState = registry.getSnapshot(roomId, { allowMissing: true });
                if (roomState) {
                    syncFn(roomId, roomState).catch(err => {
                        log.error({ err, roomId }, 'Failed to sync room state');
                    });
                }
            }

            return result;
        };
    }

    const originalCreateRoom = registry.createRoom;
    const originalJoinRoom = registry.joinRoom;
    const originalLeaveRoom = registry.leaveRoom;
    const originalUpdateNote = registry.updateNote;
    const originalUpdateTaskList = registry.updateTaskList;
    const originalSetEstimationMode = registry.setEstimationMode;
    const originalSelectTask = registry.selectTask;
    const originalRecordVote = registry.recordVote;
    const originalRecordReaction = registry.recordReaction;
    const originalRevealVotes = registry.revealVotes;
    const originalResetRoom = registry.resetRoom;

    const wrappedRegistry = {
        ...registry,

        createRoom({ roomSuffix }) {
            const result = originalCreateRoom({ roomSuffix });
            redisStore.saveRoomState(result.roomId, registry.getSnapshot(result.roomId)).catch(err => {
                log.error({ err, roomId: result.roomId }, 'Failed to sync created room');
            });
            return result;
        },

        joinRoom(params) {
            const result = originalJoinRoom(params);
            redisStore.saveRoomState(result.roomId, registry.getSnapshot(result.roomId)).catch(err => {
                log.error({ err, roomId: result.roomId }, 'Failed to sync joined room');
            });
            return result;
        },

        leaveRoom(params) {
            const result = originalLeaveRoom(params);
            if (result) {
                const snapshot = registry.getSnapshot(result.roomId, { allowMissing: true });
                if (snapshot.players.length === 0) {
                    redisStore.deleteRoomState(result.roomId).catch(err => {
                        log.error({ err, roomId: result.roomId }, 'Failed to delete empty room');
                    });
                } else {
                    redisStore.saveRoomState(result.roomId, snapshot).catch(err => {
                        log.error({ err, roomId: result.roomId }, 'Failed to sync left room');
                    });
                }
            }
            return result;
        },

        updateNote(roomId, note) {
            const result = originalUpdateNote(roomId, note);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync note update');
            });
            return result;
        },

        updateTaskList(roomId, items) {
            const result = originalUpdateTaskList(roomId, items);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync task list update');
            });
            return result;
        },

        setEstimationMode(roomId, mode) {
            const result = originalSetEstimationMode(roomId, mode);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync estimation mode');
            });
            return result;
        },

        selectTask(roomId, direction) {
            const result = originalSelectTask(roomId, direction);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync task selection');
            });
            return result;
        },

        recordVote(roomId, socketId, value) {
            const result = originalRecordVote(roomId, socketId, value);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync vote');
            });
            return result;
        },

        recordReaction(roomId, socketId, value) {
            const result = originalRecordReaction(roomId, socketId, value);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync reaction');
            });
            return result;
        },

        revealVotes(roomId) {
            const result = originalRevealVotes(roomId);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync reveal');
            });
            return result;
        },

        resetRoom(roomId) {
            const result = originalResetRoom(roomId);
            redisStore.saveRoomState(roomId, registry.getSnapshot(roomId)).catch(err => {
                log.error({ err, roomId }, 'Failed to sync reset');
            });
            return result;
        },

        async restoreFromRedis() {
            if (!redisStore.isEnabled) return;

            try {
                const roomIds = await redisStore.listActiveRooms();
                log.info({ count: roomIds.length }, 'Restoring rooms from Redis');

                for (const roomId of roomIds) {
                    const roomState = await redisStore.loadRoomState(roomId);
                    if (roomState && roomState.room) {
                        try {
                            registry.createRoom({ roomSuffix: roomState.room.suffix || roomId });
                            log.debug({ roomId }, 'Restored room from Redis');
                        } catch (error) {
                            if (error.message !== 'ROOM_ALREADY_EXISTS') {
                                log.error({ err: error, roomId }, 'Failed to restore room');
                            }
                        }
                    }
                }
            } catch (error) {
                log.error({ err: error }, 'Failed to restore rooms from Redis');
            }
        },

        redisStore,
    };

    return wrappedRegistry;
}

module.exports = { createRoomRegistryWithRedis };
