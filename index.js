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
        .then(() => {
            console.log(`Socket.IO server running on port ${app.config.port}`);
        })
        .catch(error => {
            console.error('Failed to initialize estimation history store', error);
            process.exit(1);
        });
}

module.exports = {
    ...app,
    createServerApp,
    normalizeEstimationMode,
};
