const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = process.env.DATABASE_URL || '';
const HISTORY_TABLE_NAME = 'estimation_history';
const HISTORY_UNIQUE_CONSTRAINT_NAME = 'estimation_history_task_participant_type_unique';

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeRecordedAt(value) {
    const asText = normalizeText(value);
    const parsed = asText ? new Date(asText) : new Date();
    if (Number.isNaN(parsed.getTime())) {
        return new Date().toISOString();
    }

    return parsed.toISOString();
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

function normalizeEntry(entry = {}) {
    return {
        roomId: normalizeText(entry.roomId),
        taskId: normalizeText(entry.taskId),
        participantName: normalizeText(entry.participantName),
        estimate: normalizeText(entry.estimate),
        estimateType: normalizeText(entry.estimateType || entry.estimationMode) || 'points',
        recordedAt: normalizeRecordedAt(entry.recordedAt),
    };
}

function mapRowToEntry(row = {}) {
    return {
        roomId: normalizeText(row.room_id),
        taskId: normalizeText(row.task_id),
        participantName: normalizeText(row.participant_name),
        estimate: normalizeText(row.estimate),
        estimateType: normalizeText(row.estimate_type) || 'points',
        recordedAt: normalizeRecordedAt(row.recorded_at),
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
            // Managed providers often require TLS but do not ship the CA locally.
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

function createEstimationHistoryStore({
    PoolClass = Pool,
    connectionString = DEFAULT_DATABASE_URL,
    pool = null,
    skipLegacyDeduplication = false,
} = {}) {
    const ownsPool = !pool;
    const poolConfig = buildPoolConfig(connectionString);
    const activePool = pool || (poolConfig ? new PoolClass(poolConfig) : null);
    let initializationPromise = null;
    const isEnabled = Boolean(activePool);

    async function initialize() {
        if (!isEnabled) {
            return;
        }

        if (!initializationPromise) {
            initializationPromise = (async () => {
                await activePool.query('BEGIN');
                try {
                    await activePool.query(`
                        CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE_NAME} (
                            id BIGSERIAL PRIMARY KEY,
                            room_id TEXT NOT NULL,
                            task_id TEXT NOT NULL,
                            participant_name TEXT NOT NULL,
                            estimate TEXT NOT NULL,
                            estimate_type TEXT NOT NULL DEFAULT 'points',
                            recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            CONSTRAINT ${HISTORY_UNIQUE_CONSTRAINT_NAME}
                                UNIQUE (task_id, participant_name, estimate_type)
                        )
                    `);
                    if (!skipLegacyDeduplication) {
                        await activePool.query(`
                            DELETE FROM ${HISTORY_TABLE_NAME} AS older
                            USING ${HISTORY_TABLE_NAME} AS newer
                            WHERE older.task_id = newer.task_id
                              AND older.participant_name = newer.participant_name
                              AND older.estimate_type = newer.estimate_type
                              AND (
                                  older.recorded_at < newer.recorded_at
                                  OR (
                                      older.recorded_at = newer.recorded_at
                                      AND older.id < newer.id
                                  )
                              )
                        `);
                    }
                    await activePool.query(`
                        ALTER TABLE ${HISTORY_TABLE_NAME}
                        DROP CONSTRAINT IF EXISTS estimation_history_room_task_participant_unique
                    `);
                    await activePool.query(`
                        ALTER TABLE ${HISTORY_TABLE_NAME}
                        DROP CONSTRAINT IF EXISTS estimation_history_task_participant_unique
                    `);
                    try {
                        await activePool.query(`
                            ALTER TABLE ${HISTORY_TABLE_NAME}
                            ADD CONSTRAINT ${HISTORY_UNIQUE_CONSTRAINT_NAME}
                            UNIQUE (task_id, participant_name, estimate_type)
                        `);
                    } catch (error) {
                        const message = normalizeText(error?.message).toLowerCase();
                        const alreadyExists = error?.code === '42710'
                            || message.includes('already exists');
                        if (!alreadyExists) {
                            throw error;
                        }
                    }
                    await activePool.query(`
                        CREATE INDEX IF NOT EXISTS estimation_history_recorded_at_idx
                        ON ${HISTORY_TABLE_NAME} (recorded_at DESC)
                    `);
                    await activePool.query('COMMIT');
                } catch (error) {
                    await activePool.query('ROLLBACK');
                    throw error;
                }
            })().catch(error => {
                initializationPromise = null;
                throw error;
            });
        }

        return initializationPromise;
    }

    async function append(nextEntries = []) {
        const safeEntries = nextEntries
            .map(normalizeEntry)
            .filter(entry => entry.roomId && entry.taskId && entry.participantName && entry.estimate);

        if (!safeEntries.length) {
            return [];
        }

        if (!isEnabled) {
            return safeEntries;
        }

        await initialize();
        const client = await activePool.connect();

        try {
            await client.query('BEGIN');

            for (const entry of safeEntries) {
                await client.query(
                    `
                        INSERT INTO ${HISTORY_TABLE_NAME} (
                            room_id,
                            task_id,
                            participant_name,
                            estimate,
                            estimate_type,
                            recorded_at
                        )
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (task_id, participant_name, estimate_type)
                        DO UPDATE SET
                            room_id = EXCLUDED.room_id,
                            estimate = EXCLUDED.estimate,
                            recorded_at = EXCLUDED.recorded_at
                    `,
                    [
                        entry.roomId,
                        entry.taskId,
                        entry.participantName,
                        entry.estimate,
                        entry.estimateType,
                        entry.recordedAt,
                    ],
                );
            }

            await client.query('COMMIT');
            return safeEntries;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function list(filters = {}) {
        if (!isEnabled) {
            const requestedPage = normalizePositiveInteger(filters.page, 1);
            const pageSize = normalizePositiveInteger(filters.pageSize, 25, { min: 1, max: 100 });

            return {
                items: [],
                pagination: {
                    page: requestedPage,
                    pageSize,
                    totalItems: 0,
                    totalPages: 1,
                    hasPreviousPage: false,
                    hasNextPage: false,
                },
            };
        }

        await initialize();

        const roomId = normalizeText(filters.roomId);
        const taskId = normalizeText(filters.taskId);
        const participantName = normalizeText(filters.participantName);
        const estimate = normalizeText(filters.estimate);
        const estimateType = normalizeText(filters.estimateType);
        const recordedOn = normalizeText(filters.recordedOn);
        const requestedPage = normalizePositiveInteger(filters.page, 1);
        const pageSize = normalizePositiveInteger(filters.pageSize, 25, { min: 1, max: 100 });

        const whereClauses = [];
        const values = [];

        function addContainsFilter(columnName, value) {
            if (!value) {
                return;
            }

            values.push(`%${value.toLowerCase()}%`);
            whereClauses.push(`LOWER(${columnName}) LIKE $${values.length}`);
        }

        addContainsFilter('room_id', roomId);
        addContainsFilter('task_id', taskId);
        addContainsFilter('participant_name', participantName);
        addContainsFilter('estimate', estimate);

        if (estimateType) {
            values.push(estimateType);
            whereClauses.push(`estimate_type = $${values.length}`);
        }

        if (recordedOn) {
            values.push(recordedOn);
            whereClauses.push(`recorded_at::date = $${values.length}::date`);
        }

        const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const countResult = await activePool.query(
            `
                SELECT COUNT(*)::int AS total_items
                FROM ${HISTORY_TABLE_NAME}
                ${whereSql}
            `,
            values,
        );

        const totalItems = countResult.rows[0]?.total_items || 0;
        const totalPages = totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1;
        const normalizedPage = Math.min(requestedPage, totalPages);
        const currentOffset = (normalizedPage - 1) * pageSize;

        const itemsResult = await activePool.query(
            `
                SELECT
                    room_id,
                    task_id,
                    participant_name,
                    estimate,
                    estimate_type,
                    recorded_at
                FROM ${HISTORY_TABLE_NAME}
                ${whereSql}
                ORDER BY recorded_at DESC, id DESC
                LIMIT $${values.length + 1}
                OFFSET $${values.length + 2}
            `,
            [...values, pageSize, currentOffset],
        );

        return {
            items: itemsResult.rows.map(mapRowToEntry),
            pagination: {
                page: normalizedPage,
                pageSize,
                totalItems,
                totalPages,
                hasPreviousPage: normalizedPage > 1,
                hasNextPage: normalizedPage < totalPages,
            },
        };
    }

    async function listMeta() {
        if (!isEnabled) {
            return {
                rooms: [],
                participants: [],
                estimateTypes: [],
            };
        }

        await initialize();

        const [roomsResult, participantsResult, estimateTypesResult] = await Promise.all([
            activePool.query(`
                SELECT DISTINCT room_id AS value
                FROM ${HISTORY_TABLE_NAME}
                WHERE room_id <> ''
                ORDER BY room_id ASC
            `),
            activePool.query(`
                SELECT DISTINCT participant_name AS value
                FROM ${HISTORY_TABLE_NAME}
                WHERE participant_name <> ''
                ORDER BY participant_name ASC
            `),
            activePool.query(`
                SELECT DISTINCT estimate_type AS value
                FROM ${HISTORY_TABLE_NAME}
                WHERE estimate_type <> ''
                ORDER BY estimate_type ASC
            `),
        ]);

        return {
            rooms: roomsResult.rows.map(row => row.value),
            participants: participantsResult.rows.map(row => row.value),
            estimateTypes: estimateTypesResult.rows.map(row => row.value),
        };
    }

    async function close() {
        if (ownsPool && activePool) {
            await activePool.end();
        }
    }

    return {
        append,
        close,
        initialize,
        isEnabled,
        list,
        listMeta,
        pool: activePool,
    };
}

module.exports = {
    DEFAULT_DATABASE_URL,
    HISTORY_TABLE_NAME,
    HISTORY_UNIQUE_CONSTRAINT_NAME,
    createEstimationHistoryStore,
};
