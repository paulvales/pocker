if (!process.env.JEST_WORKER_ID) {
    require('dotenv').config();
}

const { createServerApp, normalizeEstimationMode } = require('./apps/server');

const app = createServerApp({
    historyStoreOptions: global.__POCKER_HISTORY_STORE_OPTIONS__ || {},
    roomRuntimeStoreOptions: global.__POCKER_ROOM_RUNTIME_STORE_OPTIONS__ || {},
});

if (require.main === module) {
    app.start()
        .catch(error => {
            app.errorMonitor.capture(error, {
                event: 'server.start_failed',
            });
            process.exit(1);
        });
}

module.exports = {
    ...app,
    createServerApp,
    normalizeEstimationMode,
};
