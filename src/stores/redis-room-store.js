const Redis = require('ioredis');
const { logger } = require('./src/utils/logger');

const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX || 'pocker:';
const ROOM_TTL_SECONDS = parseInt(process.env.REDIS_ROOM_TTL || '86400', 10); // 24 hours default

function createRedisRoomStore() {
    let redis = null;
    let isEnabled = false;

    function initialize() {
        if (!REDIS_URL) {
            logger.info('REDIS_URL not set, using in-memory store');
            return;
        }

        try {
            redis = new Redis(REDIS_URL, {
                retryStrategy(times) {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
            });

            redis.on('connect', () => {
                logger.info('Connected to Redis');
                isEnabled = true;
            });

            redis.on('error', (err) => {
                logger.error({ err }, 'Redis connection error');
                isEnabled = false;
            });

            redis.on('close', () => {
                logger.warn('Redis connection closed');
                isEnabled = false;
            });
        } catch (error) {
            logger.error({ err: error }, 'Failed to initialize Redis');
        }
    }

    function getRoomKey(roomId) {
        return `${REDIS_KEY_PREFIX}room:${roomId}`;
    }

    function getPlayersKey(roomId) {
        return `${REDIS_KEY_PREFIX}players:${roomId}`;
    }

    async function saveRoomState(roomId, roomState) {
        if (!isEnabled || !redis) return;

        try {
            const pipeline = redis.pipeline();

            pipeline.set(
                getRoomKey(roomId),
                JSON.stringify({
                    room: roomState.room,
                    revealed: roomState.revealed,
                    note: roomState.note,
                    taskState: roomState.taskState,
                    estimationMode: roomState.estimationMode,
                }),
                'EX',
                ROOM_TTL_SECONDS
            );

            if (roomState.players && Object.keys(roomState.players).length > 0) {
                pipeline.set(
                    getPlayersKey(roomId),
                    JSON.stringify(roomState.players),
                    'EX',
                    ROOM_TTL_SECONDS
                );
            } else {
                pipeline.del(getPlayersKey(roomId));
            }

            await pipeline.exec();
        } catch (error) {
            logger.error({ err: error, roomId }, 'Failed to save room state to Redis');
        }
    }

    async function loadRoomState(roomId) {
        if (!isEnabled || !redis) return null;

        try {
            const [roomData, playersData] = await Promise.all([
                redis.get(getRoomKey(roomId)),
                redis.get(getPlayersKey(roomId)),
            ]);

            if (!roomData) return null;

            const roomState = JSON.parse(roomData);
            if (playersData) {
                roomState.players = JSON.parse(playersData);
            }

            return roomState;
        } catch (error) {
            logger.error({ err: error, roomId }, 'Failed to load room state from Redis');
            return null;
        }
    }

    async function deleteRoomState(roomId) {
        if (!isEnabled || !redis) return;

        try {
            await redis.del(getRoomKey(roomId), getPlayersKey(roomId));
        } catch (error) {
            logger.error({ err: error, roomId }, 'Failed to delete room state from Redis');
        }
    }

    async function listActiveRooms() {
        if (!isEnabled || !redis) return [];

        try {
            const keys = await redis.keys(`${REDIS_KEY_PREFIX}room:*`);
            return keys.map(key => key.replace(`${REDIS_KEY_PREFIX}room:`, ''));
        } catch (error) {
            logger.error({ err: error }, 'Failed to list active rooms from Redis');
            return [];
        }
    }

    async function close() {
        if (redis) {
            await redis.quit();
            redis = null;
            isEnabled = false;
        }
    }

    return {
        initialize,
        saveRoomState,
        loadRoomState,
        deleteRoomState,
        listActiveRooms,
        close,
        get isEnabled() {
            return isEnabled;
        },
    };
}

module.exports = { createRedisRoomStore };
