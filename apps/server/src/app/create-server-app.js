const http = require('http');
const { Server } = require('socket.io');
const { createEstimationHistoryStore } = require('../../../../estimation-history-store');
const { createRoomRegistry } = require('../../../../room-registry');
const { createRoomRuntimeStore } = require('../../../../room-runtime-store');
const { createServerConfig } = require('../config/create-server-config');
const { createSaasFoundationService } = require('../domain/saas/create-saas-foundation-service');
const { createHttpRequestHandler } = require('../http/create-http-request-handler');
const { registerRoomHandlers } = require('../socket/register-room-handlers');

function createServerApp(options = {}) {
    const config = createServerConfig(options);
    const roomRuntimeStore = options.roomRuntimeStore
        || createRoomRuntimeStore(options.roomRuntimeStoreOptions || {});
    const roomRegistry = options.roomRegistry || createRoomRegistry({
        roomRuntimeStore,
        sessionRecoveryTtlMs: config.realtime.sessionRecoveryTtlMs,
        syncPollIntervalMs: config.realtime.syncPollIntervalMs,
    });
    const saasFoundationService = options.saasFoundationService
        || createSaasFoundationService({ config });
    const estimationHistoryStore = options.estimationHistoryStore
        || createEstimationHistoryStore(options.historyStoreOptions || {});
    const requestHandler = createHttpRequestHandler({
        config,
        roomRegistry,
        estimationHistoryStore,
        saasFoundationService,
    });
    const server = http.createServer((req, res) => {
        void requestHandler(req, res);
    });
    const io = new Server(server, {
        cors: {
            origin: '*',
        },
    });
    server.on('close', () => {
        void roomRegistry.close().catch(() => {});
    });

    registerRoomHandlers({
        io,
        roomRegistry,
        estimationHistoryStore,
        config,
        saasFoundationService,
    });

    async function start() {
        await estimationHistoryStore.initialize();
        await roomRegistry.initialize();

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
        roomRuntimeStore,
        saasFoundationService,
        server,
        start,
    };
}

module.exports = {
    createServerApp,
};
