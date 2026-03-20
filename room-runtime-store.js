const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const DEFAULT_DATABASE_URL = process.env.DATABASE_URL || '';
const ROOM_TABLE_NAME = 'room_runtime_rooms';
const ROOM_SESSION_TABLE_NAME = 'room_runtime_sessions';
const ROOM_EVENT_TABLE_NAME = 'room_runtime_events';

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

function parseTaskItems(value) {
    try {
        const parsed = JSON.parse(String(value ?? '[]'));
        return normalizeTaskState({ items: parsed, selectedIndex: 0 }).items;
    } catch (error) {
        return [];
    }
}

function mapRoomRow(row = {}) {
    return {
        roomId: normalizeText(row.room_id),
        createdAt: normalizeTimestamp(row.created_at),
        updatedAt: normalizeTimestamp(row.updated_at),
        note: String(row.note ?? ''),
        taskState: normalizeTaskState({
            items: parseTaskItems(row.task_items),
            selectedIndex: row.selected_task_index,
        }),
        estimationMode: normalizeEstimationMode(row.estimation_mode),
        revealed: Boolean(row.revealed),
        revision: normalizePositiveInteger(row.revision, 0, { min: 0 }),
    };
}

function mapSessionRow(row = {}) {
    return {
        sessionId: normalizeText(row.session_id),
        roomId: normalizeText(row.room_id),
        actorId: normalizeNullableText(row.actor_id),
        participantName: normalizeText(row.participant_name),
        isAdmin: Boolean(row.is_admin),
        vote:
            row.vote === null || typeof row.vote === 'undefined'
                ? null
                : String(row.vote),
        status: normalizeText(row.status).toLowerCase() || 'active',
        joinedAt: normalizeTimestamp(row.joined_at),
        lastSeenAt: normalizeTimestamp(row.last_seen_at),
        disconnectedAt: row.disconnected_at ? normalizeTimestamp(row.disconnected_at) : null,
        closedAt: row.closed_at ? normalizeTimestamp(row.closed_at) : null,
    };
}

function mapEventRow(row = {}) {
    return {
        id: normalizePositiveInteger(row.id, 0, { min: 0 }),
        roomId: normalizeText(row.room_id),
        eventType: normalizeText(row.event_type),
        revision: normalizePositiveInteger(row.revision, 0, { min: 0 }),
        emittedAt: normalizeTimestamp(row.emitted_at),
        originInstanceId: normalizeText(row.origin_instance_id),
    };
}

function buildPoolConfig(connectionString) {
    const normalizedConnectionString = normalizeText(connectionString);
    if (!normalizedConnectionString) {
        return null;
    }

    let normalizedPoolConnectionString = normalizedConnectionString;
    let ssl = undefined;

    try {
        const parsed = new URL(normalizedConnectionString);
        const sslMode = normalizeText(parsed.searchParams.get('sslmode')).toLowerCase();
        if (sslMode && sslMode !== 'disable') {
            parsed.searchParams.delete('sslmode');
            normalizedPoolConnectionString = parsed.toString();
            ssl = { rejectUnauthorized: false };
        }
    } catch (error) {
        // Fall back to the connection string as-is if URL parsing fails.
    }

    return {
        connectionString: normalizedPoolConnectionString,
        ssl,
    };
}

function createRoomRuntimeStore({
    PoolClass = Pool,
    connectionString = DEFAULT_DATABASE_URL,
    pool = null,
} = {}) {
    const ownsPool = !pool;
    const poolConfig = buildPoolConfig(connectionString);
    const activePool = pool || (poolConfig ? new PoolClass(poolConfig) : null);
    let initializationPromise = null;

    async function tableExists(tableName) {
        try {
            await activePool.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
            return true;
        } catch (error) {
            const message = normalizeText(error?.message).toLowerCase();
            if (error?.code === '42P01' || message.includes('does not exist')) {
                return false;
            }

            throw error;
        }
    }

    async function schemaExists() {
        const roomTableExists = await tableExists(ROOM_TABLE_NAME);
        if (!roomTableExists) {
            return false;
        }

        const sessionTableExists = await tableExists(ROOM_SESSION_TABLE_NAME);
        if (!sessionTableExists) {
            return false;
        }

        return tableExists(ROOM_EVENT_TABLE_NAME);
    }

    async function initialize() {
        if (!activePool) {
            throw new Error('DATABASE_URL_NOT_CONFIGURED');
        }

        if (!initializationPromise) {
            initializationPromise = (async () => {
                if (await schemaExists()) {
                    return;
                }

                const client = await activePool.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(`
                        CREATE TABLE IF NOT EXISTS ${ROOM_TABLE_NAME} (
                            room_id TEXT PRIMARY KEY,
                            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            note TEXT NOT NULL DEFAULT '',
                            task_items TEXT NOT NULL DEFAULT '[]',
                            selected_task_index INTEGER NOT NULL DEFAULT 0,
                            estimation_mode TEXT NOT NULL DEFAULT 'points',
                            revealed BOOLEAN NOT NULL DEFAULT FALSE,
                            revision BIGINT NOT NULL DEFAULT 0
                        )
                    `);
                    await client.query(`
                        CREATE TABLE IF NOT EXISTS ${ROOM_SESSION_TABLE_NAME} (
                            session_id TEXT PRIMARY KEY,
                            room_id TEXT NOT NULL REFERENCES ${ROOM_TABLE_NAME}(room_id) ON DELETE CASCADE,
                            actor_id TEXT NULL,
                            participant_name TEXT NOT NULL,
                            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
                            vote TEXT NULL,
                            status TEXT NOT NULL DEFAULT 'active',
                            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            disconnected_at TIMESTAMPTZ NULL,
                            closed_at TIMESTAMPTZ NULL
                        )
                    `);
                    await client.query(`
                        CREATE INDEX IF NOT EXISTS room_runtime_sessions_room_status_idx
                        ON ${ROOM_SESSION_TABLE_NAME} (room_id, status, last_seen_at DESC)
                    `);
                    await client.query(`
                        CREATE INDEX IF NOT EXISTS room_runtime_sessions_room_actor_idx
                        ON ${ROOM_SESSION_TABLE_NAME} (room_id, actor_id, last_seen_at DESC)
                    `);
                    await client.query(`
                        CREATE INDEX IF NOT EXISTS room_runtime_sessions_room_name_idx
                        ON ${ROOM_SESSION_TABLE_NAME} (room_id, participant_name, last_seen_at DESC)
                    `);
                    await client.query(`
                        CREATE TABLE IF NOT EXISTS ${ROOM_EVENT_TABLE_NAME} (
                            id BIGSERIAL PRIMARY KEY,
                            room_id TEXT NOT NULL,
                            event_type TEXT NOT NULL,
                            revision BIGINT NOT NULL DEFAULT 0,
                            emitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            origin_instance_id TEXT NOT NULL DEFAULT ''
                        )
                    `);
                    await client.query(`
                        CREATE INDEX IF NOT EXISTS room_runtime_events_room_id_idx
                        ON ${ROOM_EVENT_TABLE_NAME} (room_id, id DESC)
                    `);
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            })().catch(error => {
                initializationPromise = null;
                throw error;
            });
        }

        return initializationPromise;
    }

    async function withTransaction(callback) {
        await initialize();
        const client = await activePool.connect();

        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function ensureRoom(client, roomId) {
        const roomLookup = await client.query(
            `
                SELECT *
                FROM ${ROOM_TABLE_NAME}
                WHERE room_id = $1
                LIMIT 1
            `,
            [normalizeText(roomId)],
        );

        if (roomLookup.rows[0]) {
            return mapRoomRow(roomLookup.rows[0]);
        }

        const roomInsert = await client.query(
            `
                INSERT INTO ${ROOM_TABLE_NAME} (
                    room_id,
                    created_at,
                    updated_at,
                    note,
                    task_items,
                    selected_task_index,
                    estimation_mode,
                    revealed,
                    revision
                )
                VALUES ($1, NOW(), NOW(), '', '[]', 0, 'points', FALSE, 1)
                RETURNING *
            `,
            [normalizeText(roomId)],
        );

        return mapRoomRow(roomInsert.rows[0]);
    }

    async function touchRoom(client, roomId) {
        const roomUpdate = await client.query(
            `
                UPDATE ${ROOM_TABLE_NAME}
                SET updated_at = NOW(),
                    revision = revision + 1
                WHERE room_id = $1
                RETURNING *
            `,
            [normalizeText(roomId)],
        );

        return mapRoomRow(roomUpdate.rows[0]);
    }

    async function appendRoomEvent(client, {
        roomId,
        eventType,
        revision,
        originInstanceId,
    }) {
        await client.query(
            `
                INSERT INTO ${ROOM_EVENT_TABLE_NAME} (
                    room_id,
                    event_type,
                    revision,
                    origin_instance_id
                )
                VALUES ($1, $2, $3, $4)
            `,
            [
                normalizeText(roomId),
                normalizeText(eventType) || 'room_updated',
                normalizePositiveInteger(revision, 0, { min: 0 }),
                normalizeText(originInstanceId),
            ],
        );
    }

    async function getRoom(roomId) {
        await initialize();
        const result = await activePool.query(
            `
                SELECT *
                FROM ${ROOM_TABLE_NAME}
                WHERE room_id = $1
            `,
            [normalizeText(roomId)],
        );

        return result.rows[0] ? mapRoomRow(result.rows[0]) : null;
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
        return withTransaction(async (client) => {
            const normalizedTaskState = normalizeTaskState(taskState);
            const roomInsert = await client.query(
                `
                    INSERT INTO ${ROOM_TABLE_NAME} (
                        room_id,
                        created_at,
                        updated_at,
                        note,
                        task_items,
                        selected_task_index,
                        estimation_mode,
                        revealed,
                        revision
                    )
                    VALUES ($1, $2, $2, $3, $4, $5, $6, $7, 1)
                    RETURNING *
                `,
                [
                    normalizeText(roomId),
                    normalizeTimestamp(createdAt),
                    String(note ?? ''),
                    JSON.stringify(normalizedTaskState.items),
                    normalizedTaskState.selectedIndex,
                    normalizeEstimationMode(estimationMode),
                    normalizeBoolean(revealed),
                ],
            ).catch((error) => {
                const message = normalizeText(error?.message).toLowerCase();
                if (error?.code === '23505' || message.includes('duplicate')) {
                    throw new Error('ROOM_ALREADY_EXISTS');
                }

                throw error;
            });

            const roomRecord = mapRoomRow(roomInsert.rows[0]);
            await appendRoomEvent(client, {
                roomId: roomRecord.roomId,
                eventType,
                revision: roomRecord.revision,
                originInstanceId,
            });

            return roomRecord;
        });
    }

    async function touchSession({ roomId, sessionId, seenAt = new Date().toISOString() }) {
        await initialize();
        await activePool.query(
            `
                UPDATE ${ROOM_SESSION_TABLE_NAME}
                SET last_seen_at = $3
                WHERE room_id = $1
                  AND session_id = $2
            `,
            [normalizeText(roomId), normalizeText(sessionId), normalizeTimestamp(seenAt)],
        );
    }

    async function getSession({ roomId, sessionId }) {
        await initialize();
        const result = await activePool.query(
            `
                SELECT *
                FROM ${ROOM_SESSION_TABLE_NAME}
                WHERE room_id = $1
                  AND session_id = $2
                LIMIT 1
            `,
            [normalizeText(roomId), normalizeText(sessionId)],
        );

        return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
    }

    async function listActiveSessions({
        roomId,
        activeCutoffAt,
    }) {
        await initialize();
        const result = await activePool.query(
            `
                SELECT *
                FROM ${ROOM_SESSION_TABLE_NAME}
                WHERE room_id = $1
                  AND status = 'active'
                  AND last_seen_at >= $2
                ORDER BY joined_at ASC, session_id ASC
            `,
            [normalizeText(roomId), normalizeTimestamp(activeCutoffAt)],
        );

        return result.rows.map(mapSessionRow);
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
        const normalizedRoomId = normalizeText(roomId);
        const normalizedSessionId = normalizeText(sessionId);
        const normalizedActorId = normalizeNullableText(actorId);
        const normalizedParticipantName = normalizeText(participantName);
        const activeCutoff = normalizeTimestamp(activeCutoffAt);
        const recoveryCutoff = normalizeTimestamp(recoveryCutoffAt);

        if (normalizedSessionId) {
            const result = await activePool.query(
                `
                    SELECT *
                    FROM ${ROOM_SESSION_TABLE_NAME}
                    WHERE room_id = $1
                      AND session_id = $2
                      AND (
                        (status = 'active' AND last_seen_at >= $3)
                        OR (status = 'disconnected' AND disconnected_at IS NOT NULL AND disconnected_at >= $4)
                      )
                    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC
                    LIMIT 1
                `,
                [normalizedRoomId, normalizedSessionId, activeCutoff, recoveryCutoff],
            );

            if (result.rows[0]) {
                return mapSessionRow(result.rows[0]);
            }
        }

        if (normalizedActorId) {
            const result = await activePool.query(
                `
                    SELECT *
                    FROM ${ROOM_SESSION_TABLE_NAME}
                    WHERE room_id = $1
                      AND actor_id = $2
                      AND (
                        (status = 'active' AND last_seen_at >= $3)
                        OR (status = 'disconnected' AND disconnected_at IS NOT NULL AND disconnected_at >= $4)
                      )
                    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC, last_seen_at DESC
                    LIMIT 1
                `,
                [normalizedRoomId, normalizedActorId, activeCutoff, recoveryCutoff],
            );

            if (result.rows[0]) {
                return mapSessionRow(result.rows[0]);
            }
        }

        if (normalizedParticipantName) {
            const result = await activePool.query(
                `
                    SELECT *
                    FROM ${ROOM_SESSION_TABLE_NAME}
                    WHERE room_id = $1
                      AND participant_name = $2
                      AND status = 'disconnected'
                      AND disconnected_at IS NOT NULL
                      AND disconnected_at >= $3
                    ORDER BY disconnected_at DESC
                    LIMIT 1
                `,
                [normalizedRoomId, normalizedParticipantName, recoveryCutoff],
            );

            if (result.rows[0]) {
                return mapSessionRow(result.rows[0]);
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
        const result = await activePool.query(
            `
                SELECT *
                FROM ${ROOM_SESSION_TABLE_NAME}
                WHERE room_id = $1
                  AND is_admin = TRUE
                  AND session_id <> $2
                  AND (
                    (status = 'active' AND last_seen_at >= $3)
                    OR (status = 'disconnected' AND disconnected_at IS NOT NULL AND disconnected_at >= $4)
                  )
                ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END ASC, last_seen_at DESC
                LIMIT 1
            `,
            [
                normalizeText(roomId),
                normalizeText(excludeSessionId),
                normalizeTimestamp(activeCutoffAt),
                normalizeTimestamp(recoveryCutoffAt),
            ],
        );

        return result.rows[0] ? mapSessionRow(result.rows[0]) : null;
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
        return withTransaction(async (client) => {
            const sessionInsert = await client.query(
                `
                    INSERT INTO ${ROOM_SESSION_TABLE_NAME} (
                        session_id,
                        room_id,
                        actor_id,
                        participant_name,
                        is_admin,
                        vote,
                        status,
                        joined_at,
                        last_seen_at,
                        disconnected_at,
                        closed_at
                    )
                    VALUES ($1, $2, $3, $4, $5, NULL, 'active', $6, $6, NULL, NULL)
                    RETURNING *
                `,
                [
                    normalizeText(sessionId),
                    normalizeText(roomId),
                    normalizeNullableText(actorId),
                    normalizeText(participantName),
                    normalizeBoolean(isAdmin),
                    normalizeTimestamp(connectedAt),
                ],
            );

            const roomRecord = await touchRoom(client, normalizeText(roomId));
            await appendRoomEvent(client, {
                roomId: roomRecord.roomId,
                eventType,
                revision: roomRecord.revision,
                originInstanceId,
            });

            return {
                room: roomRecord,
                session: mapSessionRow(sessionInsert.rows[0]),
            };
        });
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
        return withTransaction(async (client) => {
            const sessionUpdate = await client.query(
                `
                    UPDATE ${ROOM_SESSION_TABLE_NAME}
                    SET actor_id = COALESCE($3, actor_id),
                        participant_name = $4,
                        is_admin = $5,
                        status = 'active',
                        last_seen_at = $6,
                        disconnected_at = NULL,
                        closed_at = NULL
                    WHERE room_id = $1
                      AND session_id = $2
                    RETURNING *
                `,
                [
                    normalizeText(roomId),
                    normalizeText(sessionId),
                    normalizeNullableText(actorId),
                    normalizeText(participantName),
                    normalizeBoolean(isAdmin),
                    normalizeTimestamp(connectedAt),
                ],
            );

            const roomRecord = await touchRoom(client, normalizeText(roomId));
            await appendRoomEvent(client, {
                roomId: roomRecord.roomId,
                eventType,
                revision: roomRecord.revision,
                originInstanceId,
            });

            return {
                room: roomRecord,
                session: mapSessionRow(sessionUpdate.rows[0]),
            };
        });
    }

    async function disconnectSession({
        roomId,
        sessionId,
        disconnectedAt = new Date().toISOString(),
        originInstanceId = '',
        eventType = 'participant_disconnected',
    }) {
        return withTransaction(async (client) => {
            const sessionUpdate = await client.query(
                `
                    UPDATE ${ROOM_SESSION_TABLE_NAME}
                    SET status = 'disconnected',
                        last_seen_at = $3,
                        disconnected_at = $3
                    WHERE room_id = $1
                      AND session_id = $2
                    RETURNING *
                `,
                [
                    normalizeText(roomId),
                    normalizeText(sessionId),
                    normalizeTimestamp(disconnectedAt),
                ],
            );

            if (!sessionUpdate.rows[0]) {
                return null;
            }

            const roomRecord = await touchRoom(client, normalizeText(roomId));
            await appendRoomEvent(client, {
                roomId: roomRecord.roomId,
                eventType,
                revision: roomRecord.revision,
                originInstanceId,
            });

            return {
                room: roomRecord,
                session: mapSessionRow(sessionUpdate.rows[0]),
            };
        });
    }

    async function closeExpiredSessions({ recoveryCutoffAt }) {
        await initialize();
        await activePool.query(
            `
                UPDATE ${ROOM_SESSION_TABLE_NAME}
                SET status = 'closed',
                    closed_at = NOW()
                WHERE status = 'disconnected'
                  AND disconnected_at IS NOT NULL
                  AND disconnected_at < $1
            `,
            [normalizeTimestamp(recoveryCutoffAt)],
        );
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
        return withTransaction(async (client) => {
            const currentRoom = await ensureRoom(client, normalizeText(roomId));
            const nextTaskState = typeof taskState === 'undefined'
                ? currentRoom.taskState
                : normalizeTaskState(taskState);
            const roomUpdate = await client.query(
                `
                    UPDATE ${ROOM_TABLE_NAME}
                    SET updated_at = NOW(),
                        note = $2,
                        task_items = $3,
                        selected_task_index = $4,
                        estimation_mode = $5,
                        revealed = $6,
                        revision = revision + 1
                    WHERE room_id = $1
                    RETURNING *
                `,
                [
                    normalizeText(roomId),
                    typeof note === 'undefined' ? currentRoom.note : String(note ?? ''),
                    JSON.stringify(nextTaskState.items),
                    nextTaskState.selectedIndex,
                    typeof estimationMode === 'undefined'
                        ? currentRoom.estimationMode
                        : normalizeEstimationMode(estimationMode),
                    typeof revealed === 'undefined'
                        ? currentRoom.revealed
                        : normalizeBoolean(revealed),
                ],
            );

            if (resetVotes) {
                await client.query(
                    `
                        UPDATE ${ROOM_SESSION_TABLE_NAME}
                        SET vote = NULL
                        WHERE room_id = $1
                    `,
                    [normalizeText(roomId)],
                );
            }

            const nextRoom = mapRoomRow(roomUpdate.rows[0]);
            await appendRoomEvent(client, {
                roomId: nextRoom.roomId,
                eventType,
                revision: nextRoom.revision,
                originInstanceId,
            });

            return nextRoom;
        });
    }

    async function updateSessionVote({
        roomId,
        sessionId,
        value,
        originInstanceId = '',
        eventType = 'vote_updated',
    }) {
        return withTransaction(async (client) => {
            const sessionUpdate = await client.query(
                `
                    UPDATE ${ROOM_SESSION_TABLE_NAME}
                    SET vote = $3,
                        last_seen_at = NOW()
                    WHERE room_id = $1
                      AND session_id = $2
                    RETURNING *
                `,
                [
                    normalizeText(roomId),
                    normalizeText(sessionId),
                    value === null || typeof value === 'undefined' ? null : String(value),
                ],
            );

            const roomRecord = await touchRoom(client, normalizeText(roomId));
            await appendRoomEvent(client, {
                roomId: roomRecord.roomId,
                eventType,
                revision: roomRecord.revision,
                originInstanceId,
            });

            return {
                room: roomRecord,
                session: sessionUpdate.rows[0] ? mapSessionRow(sessionUpdate.rows[0]) : null,
            };
        });
    }

    async function getLatestEventId() {
        await initialize();
        const result = await activePool.query(
            `
                SELECT COALESCE(MAX(id), 0)::bigint AS last_id
                FROM ${ROOM_EVENT_TABLE_NAME}
            `,
        );

        return normalizePositiveInteger(result.rows[0]?.last_id, 0, { min: 0 });
    }

    async function listEventsSince(afterId, { excludeOriginInstanceId = '', limit = 100 } = {}) {
        await initialize();
        const result = await activePool.query(
            `
                SELECT *
                FROM ${ROOM_EVENT_TABLE_NAME}
                WHERE id > $1
                  AND origin_instance_id <> $2
                ORDER BY id ASC
                LIMIT $3
            `,
            [
                normalizePositiveInteger(afterId, 0, { min: 0 }),
                normalizeText(excludeOriginInstanceId),
                normalizePositiveInteger(limit, 100, { min: 1, max: 1000 }),
            ],
        );

        return result.rows.map(mapEventRow);
    }

    async function close() {
        if (ownsPool && activePool) {
            await activePool.end();
        }
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
    DEFAULT_DATABASE_URL,
    ROOM_EVENT_TABLE_NAME,
    ROOM_SESSION_TABLE_NAME,
    ROOM_TABLE_NAME,
    createRoomRuntimeStore,
};
