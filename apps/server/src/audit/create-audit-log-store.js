const { Pool } = require('pg');

const DEFAULT_DATABASE_URL = process.env.DATABASE_URL || '';
const AUDIT_TABLE_NAME = 'audit_log_events';

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

function mapRow(row = {}) {
    return {
        id: normalizePositiveInteger(row.id, 0, { min: 0 }),
        createdAt: String(row.created_at || ''),
        eventType: normalizeText(row.event_type),
        actorId: normalizeNullableText(row.actor_id),
        actorKind: normalizeNullableText(row.actor_kind),
        workspaceId: normalizeNullableText(row.workspace_id),
        roomId: normalizeNullableText(row.room_id),
        outcome: normalizeText(row.outcome) || 'success',
        metadata: (() => {
            try {
                return JSON.parse(String(row.metadata_json || '{}'));
            } catch (error) {
                return {};
            }
        })(),
    };
}

function createAuditLogStore({
    PoolClass = Pool,
    connectionString = DEFAULT_DATABASE_URL,
    pool = null,
} = {}) {
    const ownsPool = !pool;
    const poolConfig = buildPoolConfig(connectionString);
    const activePool = pool || (poolConfig ? new PoolClass(poolConfig) : null);
    let initializationPromise = null;

    async function tableExists() {
        try {
            await activePool.query(`SELECT 1 FROM ${AUDIT_TABLE_NAME} LIMIT 1`);
            return true;
        } catch (error) {
            const message = normalizeText(error?.message).toLowerCase();
            if (error?.code === '42P01' || message.includes('does not exist')) {
                return false;
            }

            throw error;
        }
    }

    async function initialize() {
        if (!activePool) {
            throw new Error('DATABASE_URL_NOT_CONFIGURED');
        }

        if (!initializationPromise) {
            initializationPromise = (async () => {
                if (await tableExists()) {
                    return;
                }

                await activePool.query(`
                    CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE_NAME} (
                        id BIGSERIAL PRIMARY KEY,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        event_type TEXT NOT NULL,
                        actor_id TEXT NULL,
                        actor_kind TEXT NULL,
                        workspace_id TEXT NULL,
                        room_id TEXT NULL,
                        outcome TEXT NOT NULL DEFAULT 'success',
                        metadata_json TEXT NOT NULL DEFAULT '{}'
                    )
                `);
                await activePool.query(`
                    CREATE INDEX IF NOT EXISTS audit_log_events_created_at_idx
                    ON ${AUDIT_TABLE_NAME} (created_at DESC)
                `);
                await activePool.query(`
                    CREATE INDEX IF NOT EXISTS audit_log_events_room_id_idx
                    ON ${AUDIT_TABLE_NAME} (room_id, created_at DESC)
                `);
            })().catch((error) => {
                initializationPromise = null;
                throw error;
            });
        }

        return initializationPromise;
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
        const result = await activePool.query(
            `
                INSERT INTO ${AUDIT_TABLE_NAME} (
                    event_type,
                    actor_id,
                    actor_kind,
                    workspace_id,
                    room_id,
                    outcome,
                    metadata_json
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `,
            [
                normalizeText(eventType),
                normalizeNullableText(actorId),
                normalizeNullableText(actorKind),
                normalizeNullableText(workspaceId),
                normalizeNullableText(roomId),
                normalizeText(outcome) || 'success',
                JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
            ],
        );

        return mapRow(result.rows[0]);
    }

    async function list({
        roomId = '',
        limit = 100,
    } = {}) {
        await initialize();
        const values = [];
        const whereClauses = [];

        if (normalizeText(roomId)) {
            values.push(normalizeText(roomId));
            whereClauses.push(`room_id = $${values.length}`);
        }

        values.push(normalizePositiveInteger(limit, 100, { min: 1, max: 500 }));
        const whereSql = whereClauses.length
            ? `WHERE ${whereClauses.join(' AND ')}`
            : '';
        const result = await activePool.query(
            `
                SELECT *
                FROM ${AUDIT_TABLE_NAME}
                ${whereSql}
                ORDER BY created_at DESC, id DESC
                LIMIT $${values.length}
            `,
            values,
        );

        return result.rows.map(mapRow);
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
        list,
    };
}

module.exports = {
    AUDIT_TABLE_NAME,
    createAuditLogStore,
};
