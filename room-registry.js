const ROOM_ID_MAX_LENGTH = 64;
const ROOM_ID_PATTERN = new RegExp(`^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]{0,${ROOM_ID_MAX_LENGTH - 1}})?$`, 'u');
const RESERVED_ROOM_IDS = new Set([
    'health',
    'version',
    'history',
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

function normalizeSessionId(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    return normalizedSessionId || null;
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

function createInitialRoomState(roomId) {
    const createdAt = new Date().toISOString();

    return {
        room: createPublicRoom(roomId, createdAt),
        players: {},
        revealed: false,
        note: '',
        taskState: normalizeTaskState(),
        estimationMode: 'points',
    };
}

function createRoomRegistry() {
    const roomStates = new Map();

    function resetVotingState(roomState) {
        const players = Object.values(roomState.players);
        players.forEach(player => {
            player.vote = null;
        });
        const revealChanged = roomState.revealed;
        roomState.revealed = false;

        return {
            players,
            revealed: roomState.revealed,
            revealChanged,
        };
    }

    function createRoom({ roomSuffix }) {
        const normalizedRoomId = normalizeRoomSuffix(roomSuffix);
        if (!normalizedRoomId) {
            throw new Error('ROOM_SUFFIX_REQUIRED');
        }
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('ROOM_SUFFIX_INVALID');
        }
        if (roomStates.has(normalizedRoomId)) {
            throw new Error('ROOM_ALREADY_EXISTS');
        }

        const roomState = createInitialRoomState(normalizedRoomId);
        roomStates.set(normalizedRoomId, roomState);

        return {
            roomId: normalizedRoomId,
            room: roomState.room,
            roomState,
        };
    }

    function ensureRoomState(roomId, { createIfMissing = false } = {}) {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!isValidRoomId(normalizedRoomId)) {
            throw new Error('ROOM_NOT_FOUND');
        }

        if (!roomStates.has(normalizedRoomId)) {
            if (!createIfMissing) {
                throw new Error('ROOM_NOT_FOUND');
            }

            roomStates.set(normalizedRoomId, createInitialRoomState(normalizedRoomId));
        }

        return roomStates.get(normalizedRoomId);
    }

    function getPublicRoom(roomId) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const existingRoom = roomStates.get(normalizedRoomId)?.room;
        if (existingRoom) {
            return existingRoom;
        }

        return createPublicRoom(normalizedRoomId);
    }

    function getSnapshot(roomId, { createIfMissing = false, allowMissing = false } = {}) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const room = getPublicRoom(normalizedRoomId);
        if (!room) {
            throw new Error('ROOM_NOT_FOUND');
        }

        let roomState = roomStates.get(normalizedRoomId);
        if (!roomState) {
            if (!createIfMissing) {
                if (!allowMissing) {
                    throw new Error('ROOM_NOT_FOUND');
                }

                return {
                    room,
                    players: [],
                    revealed: false,
                    note: '',
                    taskState: normalizeTaskState(),
                    estimationMode: 'points',
                };
            }

            roomState = createInitialRoomState(normalizedRoomId);
            roomStates.set(normalizedRoomId, roomState);
        }

        return {
            room: roomState.room,
            players: Object.values(roomState.players),
            revealed: roomState.revealed,
            note: roomState.note,
            taskState: normalizeTaskState(roomState.taskState),
            estimationMode: normalizeEstimationMode(roomState.estimationMode),
        };
    }

    function joinRoom({ roomId, socketId, name, isAdmin, sessionId }) {
        const playerName = String(name || '').trim();
        if (!playerName) {
            throw new Error('NAME_REQUIRED');
        }

        const roomState = ensureRoomState(roomId, { createIfMissing: true });
        const normalizedSessionId = normalizeSessionId(sessionId);
        const replacedPlayers = normalizedSessionId
            ? Object.values(roomState.players).filter(player =>
                player.id !== socketId && player.sessionId && player.sessionId === normalizedSessionId)
            : [];
        const replacedSocketIds = replacedPlayers.map(player => player.id);
        const replacementExclusions = new Set([socketId, ...replacedSocketIds]);
        const wantsAdmin = Boolean(isAdmin);
        const alreadyHasAdmin = Object.values(roomState.players)
            .some(player => player.isAdmin && !replacementExclusions.has(player.id));
        if (wantsAdmin && alreadyHasAdmin) {
            throw new Error('ADMIN_ALREADY_EXISTS');
        }

        let previousPlayerState = roomState.players[socketId];
        if (!previousPlayerState && replacedPlayers.length) {
            previousPlayerState = replacedPlayers[replacedPlayers.length - 1];
        }
        replacedSocketIds.forEach(replacedSocketId => {
            delete roomState.players[replacedSocketId];
        });

        const now = Date.now();
        roomState.players[socketId] = {
            id: socketId,
            name: playerName,
            vote: previousPlayerState ? previousPlayerState.vote : null,
            reaction: previousPlayerState ? previousPlayerState.reaction : null,
            isAdmin: wantsAdmin || Boolean(previousPlayerState?.isAdmin),
            sessionId: normalizedSessionId,
            lastHeartbeatAt: previousPlayerState?.lastHeartbeatAt || now,
        };

        return {
            roomId: roomState.room.id,
            room: roomState.room,
            roomState,
            player: roomState.players[socketId],
            replacedSocketIds,
        };
    }

    function leaveRoom({ roomId, socketId }) {
        const normalizedRoomId = normalizeRoomId(roomId);
        const roomState = roomStates.get(normalizedRoomId);
        const player = roomState?.players?.[socketId];

        if (!roomState || !player) {
            return null;
        }

        delete roomState.players[socketId];
        return {
            roomId: normalizedRoomId,
            roomState,
            player,
        };
    }

    function recordHeartbeat(roomId, socketId, heartbeatAt = Date.now()) {
        const roomState = ensureRoomState(roomId);
        const player = roomState.players[socketId];
        if (!player) {
            throw new Error('FORBIDDEN');
        }

        player.lastHeartbeatAt = heartbeatAt;
        return player.lastHeartbeatAt;
    }

    function assertMembership(roomId, socketId, { requireAdmin = false } = {}) {
        const roomState = ensureRoomState(roomId);
        const player = roomState.players[socketId];
        if (!player) {
            throw new Error('FORBIDDEN');
        }
        if (requireAdmin && !player.isAdmin) {
            throw new Error('FORBIDDEN');
        }

        return {
            roomId: roomState.room.id,
            room: roomState.room,
            roomState,
            player,
        };
    }

    function updateNote(roomId, note) {
        const roomState = ensureRoomState(roomId);
        roomState.note = String(note || '');
        return roomState.note;
    }

    function updateTaskList(roomId, items) {
        const roomState = ensureRoomState(roomId);
        roomState.taskState = normalizeTaskState({ items, selectedIndex: 0 });
        roomState.estimationMode = 'points';
        return {
            taskState: roomState.taskState,
            estimationMode: roomState.estimationMode,
        };
    }

    function setEstimationMode(roomId, mode) {
        const roomState = ensureRoomState(roomId);
        const nextMode = normalizeEstimationMode(mode);
        const modeChanged = roomState.estimationMode !== nextMode;

        if (modeChanged) {
            roomState.estimationMode = nextMode;
            return {
                estimationMode: roomState.estimationMode,
                modeChanged,
                ...resetVotingState(roomState),
            };
        }

        return {
            estimationMode: roomState.estimationMode,
            modeChanged,
            players: Object.values(roomState.players),
            revealed: roomState.revealed,
            revealChanged: false,
        };
    }

    function selectTask(roomId, direction) {
        const roomState = ensureRoomState(roomId);
        const currentTaskState = normalizeTaskState(roomState.taskState);
        if (!currentTaskState.items.length) {
            throw new Error('TASK_LIST_EMPTY');
        }

        const step = Number(direction) < 0 ? -1 : 1;
        roomState.taskState = normalizeTaskState({
            items: currentTaskState.items,
            selectedIndex: currentTaskState.selectedIndex + step,
        });
        roomState.estimationMode = 'points';

        return {
            taskState: roomState.taskState,
            estimationMode: roomState.estimationMode,
        };
    }

    function recordVote(roomId, socketId, value) {
        const roomState = ensureRoomState(roomId);
        const player = roomState.players[socketId];
        if (!player) {
            throw new Error('FORBIDDEN');
        }

        player.vote = value;
        return Object.values(roomState.players);
    }

    function recordReaction(roomId, socketId, value) {
        const roomState = ensureRoomState(roomId);
        const player = roomState.players[socketId];
        if (!player) {
            throw new Error('FORBIDDEN');
        }

        player.reaction = normalizeReaction(value);
        return Object.values(roomState.players);
    }

    function revealVotes(roomId) {
        const roomState = ensureRoomState(roomId);
        roomState.revealed = true;
        return roomState.revealed;
    }

    function resetRoom(roomId) {
        const roomState = ensureRoomState(roomId);
        const votingState = resetVotingState(roomState);
        roomState.note = '';

        return {
            players: votingState.players,
            revealed: votingState.revealed,
            note: roomState.note,
        };
    }

    function removeStalePlayers({ ttlMs, now = Date.now(), isSocketActive = () => false } = {}) {
        const safeTtlMs = Number(ttlMs);
        if (!Number.isFinite(safeTtlMs) || safeTtlMs <= 0) {
            throw new Error('STALE_TTL_INVALID');
        }

        const removedPlayers = [];
        roomStates.forEach((roomState, roomId) => {
            Object.values(roomState.players).forEach(player => {
                const lastHeartbeatAt = Number(player.lastHeartbeatAt) || 0;
                const ageMs = now - lastHeartbeatAt;
                const activeSocket = isSocketActive(player.id);
                if (activeSocket || ageMs <= safeTtlMs) {
                    return;
                }

                delete roomState.players[player.id];
                removedPlayers.push({
                    roomId,
                    roomState,
                    player,
                });
            });
        });

        return removedPlayers;
    }

    return {
        isReservedRoomId,
        isValidRoomId,
        createRoom,
        getPublicRoom,
        getSnapshot,
        joinRoom,
        leaveRoom,
        recordHeartbeat,
        assertMembership,
        updateNote,
        updateTaskList,
        setEstimationMode,
        selectTask,
        recordVote,
        recordReaction,
        revealVotes,
        resetRoom,
        removeStalePlayers,
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
