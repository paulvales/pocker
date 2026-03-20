const http = require('http');
const { Server } = require('socket.io');
const { createAuditLogStore } = require('../audit/create-audit-log-store');
const { createEstimationHistoryStore } = require('../../../../estimation-history-store');
const { createAppLogger } = require('../observability/create-app-logger');
const { createErrorMonitor } = require('../observability/create-error-monitor');
const { createRoomRegistry } = require('../../../../room-registry');
const { createRoomRuntimeStore } = require('../../../../room-runtime-store');
const { createServerConfig } = require('../config/create-server-config');
const { createSaasFoundationService } = require('../domain/saas/create-saas-foundation-service');
const { createHttpRequestHandler } = require('../http/create-http-request-handler');
const { registerRoomHandlers } = require('../socket/register-room-handlers');

function createServerApp(options = {}) {
    const config = createServerConfig(options);
    const logger = options.logger || createAppLogger({
        level: config.observability.logLevel,
        service: config.observability.serviceName,
    });
    const errorMonitor = options.errorMonitor || createErrorMonitor({
        logger,
        onError: options.onError,
    });
    const auditLogStore = options.auditLogStore
        || createAuditLogStore(
            options.auditLogStoreOptions
            || options.roomRuntimeStoreOptions
            || {},
        );
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
        auditLogStore,
        config,
        errorMonitor,
        roomRegistry,
        estimationHistoryStore,
        logger,
        saasFoundationService,
    });
    const server = http.createServer((req, res) => {
        const startedAt = Date.now();
        res.on('finish', () => {
            logger.info('http.request.completed', {
                method: req.method || 'GET',
                path: req.url || '/',
                statusCode: res.statusCode,
                durationMs: Date.now() - startedAt,
            });
        });
        void requestHandler(req, res);
    });
    const io = new Server(server, {
        cors: {
            origin: '*',
        },
    });
    server.on('close', () => {
        void roomRegistry.close().catch(() => {});
        void auditLogStore.close().catch(() => {});
    });

    registerRoomHandlers({
        auditLogStore,
        io,
        roomRegistry,
        estimationHistoryStore,
        config,
        errorMonitor,
        logger,
        saasFoundationService,
    });

    async function start() {
        await estimationHistoryStore.initialize();
        await auditLogStore.initialize();
        await roomRegistry.initialize();

        return new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(config.port, config.host, () => {
                server.off('error', reject);
                logger.info('server.started', {
                    host: config.host,
                    port: config.port,
                    frontendMode: config.frontend.mode,
                });
                resolve(server);
            });
        });
    }

    return {
        auditLogStore,
        config,
        errorMonitor,
        estimationHistoryStore,
        io,
        logger,
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
