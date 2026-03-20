const { randomUUID } = require('crypto');
const { createRoomRuntimeStore } = require('./room-runtime-store');

const ROOM_ID_MAX_LENGTH = 64;
const ROOM_ID_PATTERN = new RegExp(`^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]{0,${ROOM_ID_MAX_LENGTH - 1}})?$`, 'u');
const RESERVED_ROOM_IDS = new Set([
    'health',
    'version',
    'history',
    'settings',
    'index-html',
    'robots-txt',
    'socket-io',
]);
const AVAILABLE_REACTIONS = ['👍', '🔥', '❤️', '😂', '👏', '👀', '🤯'];
const AVAILABLE_REACTIONS_SET = new Set(AVAILABLE_REACTIONS);

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

function normalizeReaction(value) {
    if (value === null || typeof value === 'undefined') {
        return null;
    }

    const normalizedReaction = String(value).trim();
    if (!normalizedReaction) {
        return null;
    }
    if (!AVAILABLE_REACTIONS_SET.has(normalizedReaction)) {
        throw new Error('REACTION_INVALID');
    }

    return normalizedReaction;
}

function normalizeRoomId(roomId) {
    return String(roomId || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, ROOM_ID_MAX_LENGTH)
        .replace(/^-+|-+$/g, '');
}

function normalizeRoomSuffix(roomSuffix) {
    return normalizeRoomId(roomSuffix);
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function normalizeNullableText(value) {
    const normalizedValue = String(value ?? '').trim();
    return normalizedValue || null;
}

function isReservedRoomId(roomId) {
    return RESERVED_ROOM_IDS.has(normalizeRoomId(roomId));
}

function isValidRoomId(roomId) {
    const normalizedRoomId = normalizeRoomId(roomId);
    return Boolean(normalizedRoomId)
        && !isReservedRoomId(normalizedRoomId)
        && ROOM_ID_PATTERN.test(normalizedRoomId);
}

function createPublicRoom(roomId, createdAt = null) {
    const normalizedRoomId = normalizeRoomId(roomId);
    if (!isValidRoomId(normalizedRoomId)) {
        return null;
    }

    return {
        id: normalizedRoomId,
        suffix: normalizedRoomId,
        label: normalizedRoomId,
        createdAt,
        joinPath: `/${encodeURIComponent(normalizedRoomId)}/`,
    };
}

function createDefaultSnapshot(room) {
    return {
        room,
        players: [],
        revealed: false,
        note: '',
        taskState: normalizeTaskState(),
        estimationMode: 'points',
    };
}

function createRoomRegistry({
    roomRuntimeStore = createRoomRuntimeStore(),
    sessionRecoveryTtlMs = 5 * 60 * 1000,
    syncPollIntervalMs = 750,
} = {}) {
    const presenceBySocket = new Map();
    const reactionBySessionId = new Map();
    const roomOperationQueues = new Map();
    const listeners = new Set();
    const instanceId = randomUUID();
    const safeSessionRecoveryTtlMs = normalizePositiveInteger(sessionRecoveryTtlMs, 5 * 60 * 1000);
    const safeSyncPollIntervalMs = normalizePositiveInteger(syncPollIntervalMs, 750, {
        min: 250,
        max: 60 * 1000,
    });
    let initializationPromise = null;
    let lastSeenEventId = 0;
    let syncTimer = null;
    let syncInFlight = false;

    function getActiveCutoffAt() {
        return new Date(Date.now() - safeSessionRecoveryTtlMs).toISOString();
    }

    function getRecoveryCutoffAt() {
        return getActiveCutoffAt();
    }

    function buildPlayer(session) {
        return {
            id: session.sessionId,
            name: session.participantName,
            vote:
                session.vote === null || typeof session.vote === 'undefined'
                    ? null
                    : String(session.vote),
            reaction: reactionBySessionId.get(session.sessionId) || null,
            isAdmin: Boolean(session.isAdmin),
        };
    }

    async function runSessionGarbageCollection() {
        await roomRuntimeStore.closeExpiredSessions({
            recoveryCutoffAt: getRecoveryCutoffAt(),
        });
    }

    async function initialize() {
        if (!initializationPromise) {
            initializationPromise = (async () => {
                await roomRuntimeStore.initialize();
                await runSessionGarbageCollection();
                lastSeenEventId = await roomRuntimeStore.getLatestEventId();
                syncTimer = setInterval(() => {
                    void pollRemoteEvents();
                }, safeSyncPollIntervalMs);
                if (typeof syncTimer.unref === 'function') {
                    syncTimer.unref();
                }
            })().catch((error) => {
                initializationPromise = null;
                throw error;
            });
        }

        return initializationPromise;
    }

    async function close() {
        if (syncTimer) {
            clearInterval(syncTimer);
            syncTimer = null;
        }

        const activePresence = [...presenceBySocket.entries()];
        presenceBySocket.clear();
        reactionBySessionId.clear();

        await Promise.all(activePresence.map(async ([socketId, presence]) => {
            try {
                await roomRuntimeStore.disconnectSession({
                    roomId: presence.roomId,
                    sessionId: presence.sessionId,
                    disconnectedAt: new Date().toISOString(),
                    originInstanceId: instanceId,
                    eventType: 'participant_disconnected',
                });
            } catch (error) {
                // Ignore disconnect failures during shutdown.
            }
        }));

        await roomRuntimeStore.close();
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    function notifyListeners(payload) {
        listeners.forEach(listener => {
            try {
                listener(payload);
            } catch (error) {
                // Ignore listener failures to avoid breaking the registry.
            }
        });
    }

    async function pollRemoteEvents() {
        if (syncInFlight) {
            return;
        }

        syncInFlight = true;

        try {
            await runSessionGarbageCollection();
            const events = await roomRuntimeStore.listEventsSince(lastSeenEventId, {
                excludeOriginInstanceId: instanceId,
            });

            if (!events.length) {
                return;
            }

            lastSeenEventId = events[events.length - 1].id;
            events.forEach(event => {
                notifyListeners({
                    source: 'remote',
                    roomId: event.roomId,
                    eventType: event.eventType,
                    revision: event.revision,
                    emittedAt: event.emittedAt,
                });
            });
        } finally {
            syncInFlight = false;
        }
    }

    function runRoomOperation(roomId, operation) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const previousOperation = roomOperationQueues.get(normalizedRoomId) || Promise.resolve();
        const nextOperation = previousOperation
            .catch(() => {})
            .then(() => operation());

        roomOperationQueues.set(normalizedRoomId, nextOperation);

        return nextOperation.finally(() => {
            if (roomOperationQueues.get(normalizedRoomId) === nextOperation) {
                roomOperationQueues.delete(normalizedRoomId);
            }
        });
    }

    async function getRoomRecord(roomId, { createIfMissing = false } = {}) {
        await initialize();
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('ROOM_NOT_FOUND');
        }

        let roomRecord = await roomRuntimeStore.getRoom(normalizedRoomId);
        if (!roomRecord && createIfMissing) {
            try {
                roomRecord = await roomRuntimeStore.createRoom({
                    roomId: normalizedRoomId,
                    createdAt: new Date().toISOString(),
                    originInstanceId: instanceId,
                    eventType: 'room_created',
                });
            } catch (error) {
                if (error?.message !== 'ROOM_ALREADY_EXISTS') {
                    throw error;
                }

                roomRecord = await roomRuntimeStore.getRoom(normalizedRoomId);
            }
        }

        return roomRecord;
    }

    async function listPlayers(roomId) {
        const sessions = await roomRuntimeStore.listActiveSessions({
            roomId,
            activeCutoffAt: getActiveCutoffAt(),
        });

        return sessions.map(buildPlayer);
    }

    function bindSocketToSession(socketId, { roomId, sessionId }) {
        for (const [knownSocketId, presence] of presenceBySocket.entries()) {
            if (
                knownSocketId !== socketId
                && presence.roomId === roomId
                && presence.sessionId === sessionId
            ) {
                presenceBySocket.delete(knownSocketId);
            }
        }

        presenceBySocket.set(socketId, {
            roomId,
            sessionId,
        });
    }

    async function getSnapshot(roomId, {
        createIfMissing = false,
        allowMissing = false,
    } = {}) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const room = createPublicRoom(normalizedRoomId);
        if (!room) {
            throw new Error('ROOM_NOT_FOUND');
        }

        await initialize();
        await runSessionGarbageCollection();

        const roomRecord = await getRoomRecord(normalizedRoomId, { createIfMissing });
        if (!roomRecord) {
            if (!allowMissing) {
                throw new Error('ROOM_NOT_FOUND');
            }

            return createDefaultSnapshot(room);
        }

        return {
            room: createPublicRoom(roomRecord.roomId, roomRecord.createdAt),
            players: await listPlayers(roomRecord.roomId),
            revealed: Boolean(roomRecord.revealed),
            note: String(roomRecord.note || ''),
            taskState: normalizeTaskState(roomRecord.taskState),
            estimationMode: normalizeEstimationMode(roomRecord.estimationMode),
        };
    }

    function getPublicRoom(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return createPublicRoom(normalizedRoomId);
    }

    async function createRoom({ roomSuffix }) {
        const normalizedRoomId = normalizeRoomSuffix(roomSuffix);
        if (!normalizedRoomId) {
            throw new Error('ROOM_SUFFIX_REQUIRED');
        }
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('ROOM_SUFFIX_INVALID');
        }
        await initialize();

        return runRoomOperation(normalizedRoomId, async () => {
            const roomRecord = await roomRuntimeStore.createRoom({
                roomId: normalizedRoomId,
                createdAt: new Date().toISOString(),
                originInstanceId: instanceId,
                eventType: 'room_created',
            });

            return {
                roomId: roomRecord.roomId,
                room: createPublicRoom(roomRecord.roomId, roomRecord.createdAt),
                roomState: await getSnapshot(roomRecord.roomId),
            };
        });
    }

    async function joinRoom({
        roomId,
        socketId,
        name,
        isAdmin,
        actorId = null,
        sessionId = null,
    }) {
        await initialize();
        await runSessionGarbageCollection();

        const playerName = String(name || '').trim();
        if (!playerName) {
            throw new Error('NAME_REQUIRED');
        }

        const normalizedRoomId = normalizeRoomId(roomId);
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('ROOM_NOT_FOUND');
        }

        const previousPresence = presenceBySocket.get(socketId) || null;
        let previousJoinState = null;
        if (previousPresence && previousPresence.roomId !== normalizedRoomId) {
            const previousSession = await roomRuntimeStore.getSession({
                roomId: previousPresence.roomId,
                sessionId: previousPresence.sessionId,
            });

            presenceBySocket.delete(socketId);
            reactionBySessionId.delete(previousPresence.sessionId);

            await roomRuntimeStore.disconnectSession({
                roomId: previousPresence.roomId,
                sessionId: previousPresence.sessionId,
                disconnectedAt: new Date().toISOString(),
                originInstanceId: instanceId,
                eventType: 'participant_disconnected',
            });

            previousJoinState = previousSession ? {
                roomId: previousPresence.roomId,
                player: buildPlayer(previousSession),
            } : {
                roomId: previousPresence.roomId,
                player: null,
            };
        }

        return runRoomOperation(normalizedRoomId, async () => {
            let roomRecord = await getRoomRecord(normalizedRoomId, { createIfMissing: false });
            if (!roomRecord) {
                roomRecord = await getRoomRecord(normalizedRoomId, { createIfMissing: true });
            }

            const recoveryCandidate = await roomRuntimeStore.findRecoverableSession({
                roomId: normalizedRoomId,
                sessionId: normalizeNullableText(sessionId),
                actorId: normalizeNullableText(actorId),
                participantName: playerName,
                activeCutoffAt: getActiveCutoffAt(),
                recoveryCutoffAt: getRecoveryCutoffAt(),
            });
            const wantsAdmin = Boolean(isAdmin);

            if (wantsAdmin) {
                const reservedAdminSession = await roomRuntimeStore.findReservedAdminSession({
                    roomId: normalizedRoomId,
                    excludeSessionId: recoveryCandidate?.sessionId || '',
                    activeCutoffAt: getActiveCutoffAt(),
                    recoveryCutoffAt: getRecoveryCutoffAt(),
                });
                if (reservedAdminSession) {
                    throw new Error('ADMIN_ALREADY_EXISTS');
                }
            }

            const sessionResult = recoveryCandidate
                ? await roomRuntimeStore.activateSession({
                    roomId: normalizedRoomId,
                    sessionId: recoveryCandidate.sessionId,
                    actorId: normalizeNullableText(actorId),
                    participantName: playerName,
                    isAdmin: wantsAdmin,
                    connectedAt: new Date().toISOString(),
                    originInstanceId: instanceId,
                    eventType: recoveryCandidate.status === 'disconnected'
                        ? 'participant_reconnected'
                        : 'participant_session_attached',
                })
                : await roomRuntimeStore.createSession({
                    roomId: normalizedRoomId,
                    actorId: normalizeNullableText(actorId),
                    participantName: playerName,
                    isAdmin: wantsAdmin,
                    connectedAt: new Date().toISOString(),
                    originInstanceId: instanceId,
                    eventType: 'participant_joined',
                });

            bindSocketToSession(socketId, {
                roomId: normalizedRoomId,
                sessionId: sessionResult.session.sessionId,
            });
            const snapshot = await getSnapshot(normalizedRoomId);
            const player = snapshot.players.find(candidate => (
                candidate.id === sessionResult.session.sessionId
            )) || buildPlayer(sessionResult.session);

            return {
                roomId: normalizedRoomId,
                room: snapshot.room,
                roomState: snapshot,
                player,
                previousJoinState,
                session: sessionResult.session,
            };
        });
    }

    async function leaveRoom({ roomId, socketId }) {
        await initialize();
        const normalizedRoomId = normalizeRoomId(roomId);
        const presence = presenceBySocket.get(socketId);

        if (!presence || presence.roomId !== normalizedRoomId) {
            return null;
        }

        return runRoomOperation(normalizedRoomId, async () => {
            presenceBySocket.delete(socketId);
            reactionBySessionId.delete(presence.sessionId);

            const sessionRecord = await roomRuntimeStore.getSession({
                roomId: normalizedRoomId,
                sessionId: presence.sessionId,
            });
            if (!sessionRecord) {
                return null;
            }

            await roomRuntimeStore.disconnectSession({
                roomId: normalizedRoomId,
                sessionId: presence.sessionId,
                disconnectedAt: new Date().toISOString(),
                originInstanceId: instanceId,
                eventType: 'participant_disconnected',
            });

            const snapshot = await getSnapshot(normalizedRoomId, { allowMissing: true });

            return {
                roomId: normalizedRoomId,
                room: snapshot.room,
                roomState: snapshot,
                player: buildPlayer(sessionRecord),
            };
        });
    }

    async function assertMembership(roomId, socketId, { requireAdmin = false } = {}) {
        await initialize();
        const normalizedRoomId = normalizeRoomId(roomId);
        const presence = presenceBySocket.get(socketId);

        if (!presence || presence.roomId !== normalizedRoomId) {
            throw new Error('FORBIDDEN');
        }

        const session = await roomRuntimeStore.getSession({
            roomId: normalizedRoomId,
            sessionId: presence.sessionId,
        });
        if (!session || session.status !== 'active') {
            throw new Error('FORBIDDEN');
        }

        await roomRuntimeStore.touchSession({
            roomId: normalizedRoomId,
            sessionId: presence.sessionId,
            seenAt: new Date().toISOString(),
        });

        if (requireAdmin && !session.isAdmin) {
            throw new Error('FORBIDDEN');
        }

        const snapshot = await getSnapshot(normalizedRoomId);
        const player = snapshot.players.find(candidate => candidate.id === presence.sessionId)
            || buildPlayer(session);

        return {
            roomId: normalizedRoomId,
            room: snapshot.room,
            roomState: snapshot,
            player,
            session,
        };
    }

    async function updateNote(roomId, note) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: normalizedRoomId,
                note: String(note || ''),
                originInstanceId: instanceId,
                eventType: 'note_updated',
            });

            return String(roomRecord.note || '');
        });
    }

    async function updateTaskList(roomId, items) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: normalizedRoomId,
                taskState: {
                    items,
                    selectedIndex: 0,
                },
                estimationMode: 'points',
                originInstanceId: instanceId,
                eventType: 'task_list_updated',
            });

            return {
                taskState: normalizeTaskState(roomRecord.taskState),
                estimationMode: normalizeEstimationMode(roomRecord.estimationMode),
            };
        });
    }

    async function setEstimationMode(roomId, mode) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const snapshot = await getSnapshot(normalizedRoomId);
            const nextMode = normalizeEstimationMode(mode);
            const modeChanged = snapshot.estimationMode !== nextMode;

            if (!modeChanged) {
                return {
                    estimationMode: snapshot.estimationMode,
                    modeChanged,
                    players: snapshot.players,
                    revealed: snapshot.revealed,
                    revealChanged: false,
                };
            }

            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: snapshot.room.id,
                estimationMode: nextMode,
                revealed: false,
                resetVotes: true,
                originInstanceId: instanceId,
                eventType: 'estimation_mode_updated',
            });
            const nextSnapshot = await getSnapshot(snapshot.room.id);

            return {
                estimationMode: normalizeEstimationMode(roomRecord.estimationMode),
                modeChanged,
                players: nextSnapshot.players,
                revealed: nextSnapshot.revealed,
                revealChanged: snapshot.revealed !== nextSnapshot.revealed,
            };
        });
    }

    async function selectTask(roomId, direction) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const snapshot = await getSnapshot(normalizedRoomId);
            const currentTaskState = normalizeTaskState(snapshot.taskState);
            if (!currentTaskState.items.length) {
                throw new Error('TASK_LIST_EMPTY');
            }

            const step = Number(direction) < 0 ? -1 : 1;
            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: snapshot.room.id,
                taskState: {
                    items: currentTaskState.items,
                    selectedIndex: currentTaskState.selectedIndex + step,
                },
                estimationMode: 'points',
                originInstanceId: instanceId,
                eventType: 'task_selected',
            });

            return {
                taskState: normalizeTaskState(roomRecord.taskState),
                estimationMode: normalizeEstimationMode(roomRecord.estimationMode),
            };
        });
    }

    async function recordVote(roomId, socketId, value) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const membership = await assertMembership(normalizedRoomId, socketId);
            await roomRuntimeStore.updateSessionVote({
                roomId: membership.roomId,
                sessionId: membership.session.sessionId,
                value,
                originInstanceId: instanceId,
                eventType: 'vote_updated',
            });

            return listPlayers(membership.roomId);
        });
    }

    async function recordReaction(roomId, socketId, value) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const membership = await assertMembership(normalizedRoomId, socketId);
            reactionBySessionId.set(
                membership.session.sessionId,
                normalizeReaction(value),
            );

            return listPlayers(membership.roomId);
        });
    }

    async function revealVotes(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const snapshot = await getSnapshot(normalizedRoomId);
            if (snapshot.revealed) {
                return snapshot.revealed;
            }

            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: snapshot.room.id,
                revealed: true,
                originInstanceId: instanceId,
                eventType: 'votes_revealed',
            });

            return Boolean(roomRecord.revealed);
        });
    }

    async function resetRoom(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        return runRoomOperation(normalizedRoomId, async () => {
            const snapshot = await getSnapshot(normalizedRoomId);
            const roomRecord = await roomRuntimeStore.updateRoomState({
                roomId: snapshot.room.id,
                note: '',
                revealed: false,
                resetVotes: true,
                originInstanceId: instanceId,
                eventType: 'room_reset',
            });
            const nextSnapshot = await getSnapshot(snapshot.room.id);

            return {
                players: nextSnapshot.players,
                revealed: Boolean(roomRecord.revealed),
                note: String(roomRecord.note || ''),
            };
        });
    }

    async function isAdminSeatAvailable(roomId) {
        await initialize();
        await runSessionGarbageCollection();

        const normalizedRoomId = normalizeRoomId(roomId);
        if (!isValidRoomId(normalizedRoomId)) {
            return false;
        }

        const roomRecord = await roomRuntimeStore.getRoom(normalizedRoomId);
        if (!roomRecord) {
            return true;
        }

        const reservedAdminSession = await roomRuntimeStore.findReservedAdminSession({
            roomId: normalizedRoomId,
            activeCutoffAt: getActiveCutoffAt(),
            recoveryCutoffAt: getRecoveryCutoffAt(),
        });

        return !reservedAdminSession;
    }

    return {
        close,
        createRoom,
        getPublicRoom,
        getSnapshot,
        initialize,
        isAdminSeatAvailable,
        isReservedRoomId,
        isValidRoomId,
        joinRoom,
        leaveRoom,
        recordReaction,
        recordVote,
        resetRoom,
        revealVotes,
        selectTask,
        setEstimationMode,
        subscribe,
        assertMembership,
        updateNote,
        updateTaskList,
    };
}

module.exports = {
    AVAILABLE_REACTIONS,
    createRoomRegistry,
    normalizeReaction,
    normalizeEstimationMode,
    normalizeTaskState,
    normalizeRoomId,
    normalizeRoomSuffix,
};
