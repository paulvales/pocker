const http = require('http');
const { Server } = require('socket.io');
const { createEstimationHistoryStore } = require('../../../../estimation-history-store');
const { createRoomRegistry } = require('../../../../room-registry');
const { createServerConfig } = require('../config/create-server-config');
const { createHttpRequestHandler } = require('../http/create-http-request-handler');
const { registerRoomHandlers } = require('../socket/register-room-handlers');

function createServerApp(options = {}) {
    const config = createServerConfig(options);
    const roomRegistry = options.roomRegistry || createRoomRegistry();
    const estimationHistoryStore = options.estimationHistoryStore
        || createEstimationHistoryStore(options.historyStoreOptions || {});
    const requestHandler = createHttpRequestHandler({
        config,
        roomRegistry,
        estimationHistoryStore,
    });
    const server = http.createServer((req, res) => {
        void requestHandler(req, res);
    });
    const io = new Server(server, {
        cors: {
            origin: '*',
        },
    });

    registerRoomHandlers({
        io,
        roomRegistry,
        estimationHistoryStore,
        config,
    });

    async function start() {
        await estimationHistoryStore.initialize();

        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(config.port, config.host, () => {
                server.off('error', reject);
                resolve(server);
            });
        });
    }

    return {
        config,
        estimationHistoryStore,
        io,
        roomRegistry,
        server,
        start,
    };
}

module.exports = {
    createServerApp,
};
