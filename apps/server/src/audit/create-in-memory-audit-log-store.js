function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeNullableText(value) {
    const normalizedValue = normalizeText(value);
    return normalizedValue || null;
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function createInMemoryAuditLogStore() {
    const entries = [];
    let nextId = 1;

    async function initialize() {
        return undefined;
    }

    async function append({
        eventType,
        actorId = null,
        actorKind = null,
        workspaceId = null,
        roomId = null,
        outcome = 'success',
        metadata = {},
    }) {
        await initialize();

        const entry = {
            id: nextId++,
            createdAt: new Date().toISOString(),
            eventType: normalizeText(eventType),
            actorId: normalizeNullableText(actorId),
            actorKind: normalizeNullableText(actorKind),
            workspaceId: normalizeNullableText(workspaceId),
            roomId: normalizeNullableText(roomId),
            outcome: normalizeText(outcome) || 'success',
            metadata: metadata && typeof metadata === 'object' ? metadata : {},
        };

        entries.unshift(entry);
        return { ...entry };
    }

    async function list({
        roomId = '',
        limit = 100,
    } = {}) {
        await initialize();
        const normalizedRoomId = normalizeText(roomId);
        const normalizedLimit = normalizePositiveInteger(limit, 100, { min: 1, max: 500 });

        return entries
            .filter(entry => !normalizedRoomId || entry.roomId === normalizedRoomId)
            .slice(0, normalizedLimit)
            .map(entry => ({ ...entry }));
    }

    async function close() {
        entries.length = 0;
        nextId = 1;
    }

    return {
        append,
        close,
        initialize,
        list,
    };
}

module.exports = {
    createInMemoryAuditLogStore,
};
