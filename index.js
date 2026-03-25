if (!process.env.JEST_WORKER_ID) {
    require('dotenv').config();
}

const http = require('http');
const { Server } = require('socket.io');
const packageJson = require('./package.json');
const { createEstimationHistoryStore } = require('./estimation-history-store');
const {
    createRoomRegistry,
    normalizeEstimationMode,
    normalizeTaskState,
} = require('./room-registry');
const { createHttpHandler } = require('./src/routes/http');
const { createSocketHandler } = require('./src/handlers/socket');
const { logger } = require('./src/utils/logger');

const APP_VERSION = process.env.APP_VERSION || packageJson.version || 'dev';
const APP_BUILD = process.env.APP_BUILD || '';
const APP_VERSION_LABEL = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;
const YOU_TRACK_BASE_URL = (process.env.YOUTRACK_BASE_URL || '').replace(/\/+$/, '');
const YOU_TRACK_TOKEN = process.env.YOUTRACK_TOKEN || '';
const YOU_TRACK_STORY_POINTS_FIELD = process.env.YOUTRACK_STORY_POINTS_FIELD || 'Story points';
const roomRegistry = createRoomRegistry();
const historyStoreOptions = global.__POCKER_HISTORY_STORE_OPTIONS__ || {};
const estimationHistoryStore = createEstimationHistoryStore(historyStoreOptions);

const server = http.createServer(createHttpHandler({
    rootDir: __dirname,
    appVersionLabel: APP_VERSION_LABEL,
    roomRegistry,
    estimationHistoryStore,
}));

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

const { registerSocketHandlers } = createSocketHandler({
    io,
    roomRegistry,
    estimationHistoryStore,
    YOU_TRACK_BASE_URL,
    YOU_TRACK_TOKEN,
    YOU_TRACK_STORY_POINTS_FIELD,
});

io.on('connection', socket => {
    logger.debug({ socketId: socket.id }, 'New socket connection');
    socket.on('disconnect', reason => {
        logger.debug({ socketId: socket.id, reason }, 'Socket disconnected');
    });
    registerSocketHandlers(socket);
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    estimationHistoryStore.initialize()
        .then(() => {
            server.listen(PORT, '0.0.0.0', () => {
                logger.info({ port: PORT }, 'Socket.IO server running');
            });
        })
        .catch(error => {
            logger.error({ err: error }, 'Failed to initialize estimation history store');
            process.exit(1);
        });
}

module.exports = {
    estimationHistoryStore,
    io,
    server,
    roomRegistry,
    normalizeEstimationMode,
};
