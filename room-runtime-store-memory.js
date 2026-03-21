const { randomUUID } = require('crypto');

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeNullableText(value) {
    const normalizedValue = normalizeText(value);
    return normalizedValue || null;
}

function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function normalizeEstimationMode(mode) {
    return mode === 'hours' ? 'hours' : 'points';
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

function normalizeTimestamp(value) {
    const normalizedValue = normalizeText(value);
    const parsed = normalizedValue ? new Date(normalizedValue) : new Date();
    if (Number.isNaN(parsed.getTime())) {
        return new Date().toISOString();
    }

    return parsed.toISOString();
}

function cloneTaskState(taskState) {
    return normalizeTaskState(taskState);
}

function cloneRoom(room) {
    if (!room) {
        return null;
    }

    return {
        roomId: normalizeText(room.roomId),
        createdAt: normalizeTimestamp(room.createdAt),
        updatedAt: normalizeTimestamp(room.updatedAt),
        note: String(room.note ?? ''),
        taskState: cloneTaskState(room.taskState),
        estimationMode: normalizeEstimationMode(room.estimationMode),
        revealed: Boolean(room.revealed),
        revision: normalizePositiveInteger(room.revision, 0, { min: 0 }),
    };
}

function cloneSession(session) {
    if (!session) {
        return null;
    }

    return {
        sessionId: normalizeText(session.sessionId),
        roomId: normalizeText(session.roomId),
        actorId: normalizeNullableText(session.actorId),
        participantName: normalizeText(session.participantName),
        isAdmin: Boolean(session.isAdmin),
        vote:
            session.vote === null || typeof session.vote === 'undefined'
                ? null
                : String(session.vote),
        status: normalizeText(session.status).toLowerCase() || 'active',
        joinedAt: normalizeTimestamp(session.joinedAt),
        lastSeenAt: normalizeTimestamp(session.lastSeenAt),
        disconnectedAt: session.disconnectedAt ? normalizeTimestamp(session.disconnectedAt) : null,
        closedAt: session.closedAt ? normalizeTimestamp(session.closedAt) : null,
    };
}

function cloneEvent(event) {
    if (!event) {
        return null;
    }

    return {
        id: normalizePositiveInteger(event.id, 0, { min: 0 }),
        roomId: normalizeText(event.roomId),
        eventType: normalizeText(event.eventType),
        revision: normalizePositiveInteger(event.revision, 0, { min: 0 }),
        emittedAt: normalizeTimestamp(event.emittedAt),
        originInstanceId: normalizeText(event.originInstanceId),
    };
}

function compareIsoAsc(leftValue, rightValue) {
    return new Date(leftValue).getTime() - new Date(rightValue).getTime();
}

function isSessionRecoverable(session, {
    activeCutoffAt,
    recoveryCutoffAt,
}) {
    if (!session) {
        return false;
    }

    const activeCutoff = normalizeTimestamp(activeCutoffAt);
    const recoveryCutoff = normalizeTimestamp(recoveryCutoffAt);

    if (session.status === 'active') {
        return normalizeTimestamp(session.lastSeenAt) >= activeCutoff;
    }

    return session.status === 'disconnected'
        && session.disconnectedAt
        && normalizeTimestamp(session.disconnectedAt) >= recoveryCutoff;
}

function createInMemoryRoomRuntimeStore() {
    const rooms = new Map();
    const roomSessions = new Map();
    const roomEvents = [];
    let nextEventId = 1;

    function getRoomSessions(roomId) {
        const normalizedRoomId = normalizeText(roomId);
        let sessions = roomSessions.get(normalizedRoomId);
        if (!sessions) {
            sessions = new Map();
            roomSessions.set(normalizedRoomId, sessions);
        }

        return sessions;
    }

    function appendRoomEvent({
        roomId,
        eventType,
        revision,
        originInstanceId,
    }) {
        const event = {
            id: nextEventId++,
            roomId: normalizeText(roomId),
            eventType: normalizeText(eventType) || 'room_updated',
            revision: normalizePositiveInteger(revision, 0, { min: 0 }),
            emittedAt: new Date().toISOString(),
            originInstanceId: normalizeText(originInstanceId),
        };

        roomEvents.push(event);
        return cloneEvent(event);
    }

    function ensureRoom(roomId) {
        const normalizedRoomId = normalizeText(roomId);
        let room = rooms.get(normalizedRoomId);
        if (!room) {
            const timestamp = new Date().toISOString();
            room = {
                roomId: normalizedRoomId,
                createdAt: timestamp,
                updatedAt: timestamp,
                note: '',
                taskState: normalizeTaskState(),
                estimationMode: 'points',
                revealed: false,
                revision: 1,
            };
            rooms.set(normalizedRoomId, room);
        }

        return room;
    }

    function touchRoom(roomId) {
        const room = ensureRoom(roomId);
        room.updatedAt = new Date().toISOString();
        room.revision += 1;
        return room;
    }

    async function initialize() {
        return undefined;
    }

    async function createRoom({
        roomId,
        createdAt,
        note = '',
        taskState = {},
        estimationMode = 'points',
        revealed = false,
        originInstanceId = '',
        eventType = 'room_created',
    }) {
        await initialize();
        const normalizedRoomId = normalizeText(roomId);

        if (rooms.has(normalizedRoomId)) {
            throw new Error('ROOM_ALREADY_EXISTS');
        }

        const timestamp = normalizeTimestamp(createdAt);
        const room = {
            roomId: normalizedRoomId,
            createdAt: timestamp,
            updatedAt: timestamp,
            note: String(note ?? ''),
            taskState: normalizeTaskState(taskState),
            estimationMode: normalizeEstimationMode(estimationMode),
            revealed: normalizeBoolean(revealed),
            revision: 1,
        };

        rooms.set(normalizedRoomId, room);
        appendRoomEvent({
            roomId: normalizedRoomId,
            eventType,
            revision: room.revision,
            originInstanceId,
        });

        return cloneRoom(room);
    }

    async function getRoom(roomId) {
        await initialize();
        return cloneRoom(rooms.get(normalizeText(roomId)) || null);
    }

    async function getSession({ roomId, sessionId }) {
        await initialize();
        const session = getRoomSessions(roomId).get(normalizeText(sessionId)) || null;
        return cloneSession(session);
    }

    async function touchSession({ roomId, sessionId, seenAt = new Date().toISOString() }) {
        await initialize();
        const session = getRoomSessions(roomId).get(normalizeText(sessionId));
        if (!session) {
            return;
        }

        session.lastSeenAt = normalizeTimestamp(seenAt);
    }

    async function listActiveSessions({
        roomId,
        activeCutoffAt,
    }) {
        await initialize();
        const activeCutoff = normalizeTimestamp(activeCutoffAt);
        return [...getRoomSessions(roomId).values()]
            .filter(session => (
                session.status === 'active'
                && normalizeTimestamp(session.lastSeenAt) >= activeCutoff
            ))
            .sort((leftSession, rightSession) => (
                compareIsoAsc(leftSession.joinedAt, rightSession.joinedAt)
                || normalizeText(leftSession.sessionId).localeCompare(
                    normalizeText(rightSession.sessionId),
                )
            ))
            .map(cloneSession);
    }

    async function findRecoverableSession({
        roomId,
        sessionId,
        actorId,
        participantName,
        activeCutoffAt,
        recoveryCutoffAt,
    }) {
        await initialize();
        const sessions = [...getRoomSessions(roomId).values()];
        const normalizedSessionId = normalizeText(sessionId);
        const normalizedActorId = normalizeNullableText(actorId);
        const normalizedParticipantName = normalizeText(participantName);

        if (normalizedSessionId) {
            const matchedSession = sessions.find(session => (
                session.sessionId === normalizedSessionId
                && isSessionRecoverable(session, { activeCutoffAt, recoveryCutoffAt })
            ));
            if (matchedSession) {
                return cloneSession(matchedSession);
            }
        }

        if (normalizedActorId) {
            const matchedSession = sessions
                .filter(session => (
                    session.actorId === normalizedActorId
                    && isSessionRecoverable(session, { activeCutoffAt, recoveryCutoffAt })
                ))
                .sort((leftSession, rightSession) => (
                    (leftSession.status === 'active' ? 0 : 1)
                    - (rightSession.status === 'active' ? 0 : 1)
                    || compareIsoAsc(rightSession.lastSeenAt, leftSession.lastSeenAt)
                ))[0];

            if (matchedSession) {
                return cloneSession(matchedSession);
            }
        }

        if (normalizedParticipantName) {
            const matchedSession = sessions
                .filter(session => (
                    session.participantName === normalizedParticipantName
                    && session.status === 'disconnected'
                    && session.disconnectedAt
                    && normalizeTimestamp(session.disconnectedAt)
                        >= normalizeTimestamp(recoveryCutoffAt)
                ))
                .sort((leftSession, rightSession) => (
                    compareIsoAsc(rightSession.disconnectedAt, leftSession.disconnectedAt)
                ))[0];

            if (matchedSession) {
                return cloneSession(matchedSession);
            }
        }

        return null;
    }

    async function findReservedAdminSession({
        roomId,
        excludeSessionId = '',
        activeCutoffAt,
        recoveryCutoffAt,
    }) {
        await initialize();
        const normalizedExcludedSessionId = normalizeText(excludeSessionId);

        const matchedSession = [...getRoomSessions(roomId).values()]
            .filter(session => (
                session.isAdmin
                && session.sessionId !== normalizedExcludedSessionId
                && isSessionRecoverable(session, { activeCutoffAt, recoveryCutoffAt })
            ))
            .sort((leftSession, rightSession) => (
                (leftSession.status === 'active' ? 0 : 1)
                - (rightSession.status === 'active' ? 0 : 1)
                || compareIsoAsc(rightSession.lastSeenAt, leftSession.lastSeenAt)
            ))[0];

        return cloneSession(matchedSession || null);
    }

    async function createSession({
        roomId,
        sessionId = randomUUID(),
        actorId = null,
        participantName,
        isAdmin,
        connectedAt = new Date().toISOString(),
        originInstanceId = '',
        eventType = 'participant_joined',
    }) {
        await initialize();
        const room = rooms.get(normalizeText(roomId));
        if (!room) {
            throw new Error('ROOM_NOT_FOUND');
        }

        const nextSession = {
            sessionId: normalizeText(sessionId),
            roomId: normalizeText(roomId),
            actorId: normalizeNullableText(actorId),
            participantName: normalizeText(participantName),
            isAdmin: normalizeBoolean(isAdmin),
            vote: null,
            status: 'active',
            joinedAt: normalizeTimestamp(connectedAt),
            lastSeenAt: normalizeTimestamp(connectedAt),
            disconnectedAt: null,
            closedAt: null,
        };

        getRoomSessions(roomId).set(nextSession.sessionId, nextSession);
        const touchedRoom = touchRoom(roomId);
        appendRoomEvent({
            roomId: touchedRoom.roomId,
            eventType,
            revision: touchedRoom.revision,
            originInstanceId,
        });

        return {
            room: cloneRoom(touchedRoom),
            session: cloneSession(nextSession),
        };
    }

    async function activateSession({
        roomId,
        sessionId,
        actorId = null,
        participantName,
        isAdmin,
        connectedAt = new Date().toISOString(),
        originInstanceId = '',
        eventType = 'participant_reconnected',
    }) {
        await initialize();
        const session = getRoomSessions(roomId).get(normalizeText(sessionId));
        if (!session) {
            return {
                room: cloneRoom(rooms.get(normalizeText(roomId)) || null),
                session: null,
            };
        }

        session.actorId = normalizeNullableText(actorId) || session.actorId;
        session.participantName = normalizeText(participantName);
        session.isAdmin = normalizeBoolean(isAdmin);
        session.status = 'active';
        session.lastSeenAt = normalizeTimestamp(connectedAt);
        session.disconnectedAt = null;
        session.closedAt = null;

        const touchedRoom = touchRoom(roomId);
        appendRoomEvent({
            roomId: touchedRoom.roomId,
            eventType,
            revision: touchedRoom.revision,
            originInstanceId,
        });

        return {
            room: cloneRoom(touchedRoom),
            session: cloneSession(session),
        };
    }

    async function disconnectSession({
        roomId,
        sessionId,
        disconnectedAt = new Date().toISOString(),
        originInstanceId = '',
        eventType = 'participant_disconnected',
    }) {
        await initialize();
        const session = getRoomSessions(roomId).get(normalizeText(sessionId));
        if (!session) {
            return null;
        }

        session.status = 'disconnected';
        session.lastSeenAt = normalizeTimestamp(disconnectedAt);
        session.disconnectedAt = normalizeTimestamp(disconnectedAt);

        const touchedRoom = touchRoom(roomId);
        appendRoomEvent({
            roomId: touchedRoom.roomId,
            eventType,
            revision: touchedRoom.revision,
            originInstanceId,
        });

        return {
            room: cloneRoom(touchedRoom),
            session: cloneSession(session),
        };
    }

    async function closeExpiredSessions({ recoveryCutoffAt }) {
        await initialize();
        const recoveryCutoff = normalizeTimestamp(recoveryCutoffAt);

        roomSessions.forEach(sessions => {
            sessions.forEach(session => {
                if (
                    session.status === 'disconnected'
                    && session.disconnectedAt
                    && normalizeTimestamp(session.disconnectedAt) < recoveryCutoff
                ) {
                    session.status = 'closed';
                    session.closedAt = new Date().toISOString();
                }
            });
        });
    }

    async function updateRoomState({
        roomId,
        note,
        taskState,
        estimationMode,
        revealed,
        resetVotes = false,
        originInstanceId = '',
        eventType = 'room_updated',
    }) {
        await initialize();
        const currentRoom = ensureRoom(roomId);
        const nextTaskState = typeof taskState === 'undefined'
            ? currentRoom.taskState
            : normalizeTaskState(taskState);

        currentRoom.updatedAt = new Date().toISOString();
        currentRoom.note = typeof note === 'undefined' ? currentRoom.note : String(note ?? '');
        currentRoom.taskState = nextTaskState;
        currentRoom.estimationMode = typeof estimationMode === 'undefined'
            ? currentRoom.estimationMode
            : normalizeEstimationMode(estimationMode);
        currentRoom.revealed = typeof revealed === 'undefined'
            ? currentRoom.revealed
            : normalizeBoolean(revealed);
        currentRoom.revision += 1;

        if (resetVotes) {
            getRoomSessions(roomId).forEach(session => {
                session.vote = null;
            });
        }

        appendRoomEvent({
            roomId: currentRoom.roomId,
            eventType,
            revision: currentRoom.revision,
            originInstanceId,
        });

        return cloneRoom(currentRoom);
    }

    async function updateSessionVote({
        roomId,
        sessionId,
        value,
        originInstanceId = '',
        eventType = 'vote_updated',
    }) {
        await initialize();
        const session = getRoomSessions(roomId).get(normalizeText(sessionId));
        if (!session) {
            return {
                room: cloneRoom(rooms.get(normalizeText(roomId)) || null),
                session: null,
            };
        }

        session.vote = value === null || typeof value === 'undefined' ? null : String(value);
        session.lastSeenAt = new Date().toISOString();

        const touchedRoom = touchRoom(roomId);
        appendRoomEvent({
            roomId: touchedRoom.roomId,
            eventType,
            revision: touchedRoom.revision,
            originInstanceId,
        });

        return {
            room: cloneRoom(touchedRoom),
            session: cloneSession(session),
        };
    }

    async function getLatestEventId() {
        await initialize();
        return roomEvents.length ? roomEvents[roomEvents.length - 1].id : 0;
    }

    async function listEventsSince(afterId, { excludeOriginInstanceId = '', limit = 100 } = {}) {
        await initialize();
        const normalizedAfterId = normalizePositiveInteger(afterId, 0, { min: 0 });
        const normalizedLimit = normalizePositiveInteger(limit, 100, { min: 1, max: 1000 });
        const normalizedOriginInstanceId = normalizeText(excludeOriginInstanceId);

        return roomEvents
            .filter(event => (
                event.id > normalizedAfterId
                && event.originInstanceId !== normalizedOriginInstanceId
            ))
            .sort((leftEvent, rightEvent) => leftEvent.id - rightEvent.id)
            .slice(0, normalizedLimit)
            .map(cloneEvent);
    }

    async function close() {
        rooms.clear();
        roomSessions.clear();
        roomEvents.length = 0;
        nextEventId = 1;
    }

    return {
        activateSession,
        close,
        closeExpiredSessions,
        createRoom,
        createSession,
        disconnectSession,
        findRecoverableSession,
        findReservedAdminSession,
        getLatestEventId,
        getRoom,
        getSession,
        initialize,
        listActiveSessions,
        listEventsSince,
        touchSession,
        updateRoomState,
        updateSessionVote,
    };
}

module.exports = {
    createInMemoryRoomRuntimeStore,
};
