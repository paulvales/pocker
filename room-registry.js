const crypto = require('crypto');

const ROOM_TOKEN_LENGTH = 6;
const ROOM_SUFFIX_MAX_LENGTH = 48;
const ROOM_ID_PATTERN = new RegExp(`^(?<suffix>[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*)-(?<token>[a-f0-9]{${ROOM_TOKEN_LENGTH}})$`, 'u');

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

function normalizeRoomId(roomId) {
    return String(roomId || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase();
}

function normalizeRoomSuffix(roomSuffix) {
    return String(roomSuffix || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, ROOM_SUFFIX_MAX_LENGTH)
        .replace(/^-+|-+$/g, '');
}

function parseRoomId(roomId) {
    const normalizedRoomId = normalizeRoomId(roomId);
    const match = normalizedRoomId.match(ROOM_ID_PATTERN);
    if (!match || !match.groups) {
        return null;
    }

    return {
        id: normalizedRoomId,
        suffix: match.groups.suffix,
        token: match.groups.token,
    };
}

function createPublicRoom(roomId, createdAt = null) {
    const parsed = parseRoomId(roomId);
    if (!parsed) {
        return null;
    }

    return {
        id: parsed.id,
        suffix: parsed.suffix,
        label: parsed.suffix,
        createdAt,
        joinPath: `/?room=${encodeURIComponent(parsed.id)}`,
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

    function isValidRoomId(roomId) {
        return Boolean(parseRoomId(roomId));
    }

    function createRoom({ roomSuffix }) {
        const normalizedSuffix = normalizeRoomSuffix(roomSuffix);
        if (!normalizedSuffix) {
            throw new Error('ROOM_SUFFIX_REQUIRED');
        }

        let roomId = '';
        do {
            const token = crypto.randomBytes(4).toString('hex').slice(0, ROOM_TOKEN_LENGTH);
            roomId = `${normalizedSuffix}-${token}`;
        } while (roomStates.has(roomId));

        const roomState = createInitialRoomState(roomId);
        roomStates.set(roomId, roomState);

        return {
            roomId,
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

    function joinRoom({ roomId, socketId, name, isAdmin }) {
        const playerName = String(name || '').trim();
        if (!playerName) {
            throw new Error('NAME_REQUIRED');
        }

        const roomState = ensureRoomState(roomId, { createIfMissing: true });
        const wantsAdmin = Boolean(isAdmin);
        const alreadyHasAdmin = Object.values(roomState.players).some(player => player.isAdmin && player.id !== socketId);
        if (wantsAdmin && alreadyHasAdmin) {
            throw new Error('ADMIN_ALREADY_EXISTS');
        }

        roomState.players[socketId] = {
            id: socketId,
            name: playerName,
            vote: null,
            isAdmin: wantsAdmin,
        };

        return {
            roomId: roomState.room.id,
            room: roomState.room,
            roomState,
            player: roomState.players[socketId],
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
        roomState.estimationMode = normalizeEstimationMode(mode);
        return roomState.estimationMode;
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

    function revealVotes(roomId) {
        const roomState = ensureRoomState(roomId);
        roomState.revealed = true;
        return roomState.revealed;
    }

    function resetRoom(roomId) {
        const roomState = ensureRoomState(roomId);
        Object.values(roomState.players).forEach(player => {
            player.vote = null;
        });
        roomState.revealed = false;
        roomState.note = '';

        return {
            players: Object.values(roomState.players),
            revealed: roomState.revealed,
            note: roomState.note,
        };
    }

    return {
        isValidRoomId,
        createRoom,
        getPublicRoom,
        getSnapshot,
        joinRoom,
        leaveRoom,
        assertMembership,
        updateNote,
        updateTaskList,
        setEstimationMode,
        selectTask,
        recordVote,
        revealVotes,
        resetRoom,
    };
}

module.exports = {
    createRoomRegistry,
    normalizeEstimationMode,
    normalizeTaskState,
    normalizeRoomId,
    normalizeRoomSuffix,
};
