const path = require('path');
const fs = require('fs');
const {
    respondJson,
    extractRoomIdFromPathname,
    serveHtmlFile,
    getHistoryFilters,
} = require('../utils/helpers');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};

function serveStaticFile(res, filePath) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
        });
        res.end(data);
    });
}

function createHttpHandler({
    rootDir,
    appVersionLabel,
    roomRegistry,
    estimationHistoryStore,
}) {
    return function handleHttpRequest(req, res) {
        void (async () => {
            const requestUrl = new URL(req.url || '/', 'http://localhost');
            const { pathname } = requestUrl;
            const roomIdFromPath = extractRoomIdFromPathname(pathname);

            if (pathname === '/health') {
                const APP_VERSION = process.env.APP_VERSION || require('../../package.json').version || 'dev';
                const APP_BUILD = process.env.APP_BUILD || '';
                respondJson(res, 200, {
                    status: 'ok',
                    version: APP_VERSION,
                    build: APP_BUILD || null,
                });
                return;
            }

            if (pathname === '/version') {
                const APP_VERSION = process.env.APP_VERSION || require('../../package.json').version || 'dev';
                const APP_BUILD = process.env.APP_BUILD || '';
                const APP_VERSION_LABEL = APP_BUILD ? `${APP_VERSION} (${APP_BUILD})` : APP_VERSION;
                respondJson(res, 200, {
                    version: APP_VERSION,
                    build: APP_BUILD || null,
                    label: APP_VERSION_LABEL,
                });
                return;
            }

            if (pathname.startsWith('/public/')) {
                const safePath = pathname.replace(/\.\./g, '');
                const filePath = path.join(rootDir, safePath);
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    serveStaticFile(res, filePath);
                    return;
                }
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            if (pathname === '/favicon.svg') {
                const filePath = path.join(rootDir, 'favicon.svg');
                if (fs.existsSync(filePath)) {
                    serveStaticFile(res, filePath);
                    return;
                }
            }

            if (pathname === '/robots.txt') {
                const filePath = path.join(rootDir, 'robots.txt');
                if (fs.existsSync(filePath)) {
                    serveStaticFile(res, filePath);
                    return;
                }
            }

            if (pathname === '/history') {
                res.writeHead(302, { Location: '/history/' });
                res.end();
                return;
            }

            if (pathname === '/history/' || pathname === '/history.html') {
                serveHtmlFile(res, 'history.html', rootDir, appVersionLabel);
                return;
            }

            if (pathname === '/api/estimation-history') {
                try {
                    const filters = getHistoryFilters(requestUrl.searchParams);
                    const [historyResult, meta] = await Promise.all([
                        estimationHistoryStore.list(filters),
                        estimationHistoryStore.listMeta(),
                    ]);

                    respondJson(res, 200, {
                        items: historyResult.items,
                        meta: {
                            ...meta,
                            pagination: historyResult.pagination,
                        },
                    });
                } catch (error) {
                    respondJson(res, 500, {
                        error: error.message || 'HISTORY_READ_FAILED',
                    });
                }
                return;
            }

            if (pathname === '/' || pathname === '/index.html') {
                serveHtmlFile(res, 'index.html', rootDir, appVersionLabel);
                return;
            }

            if (roomIdFromPath && roomRegistry.isValidRoomId(roomIdFromPath)) {
                if (!pathname.endsWith('/')) {
                    const normalizedRoomId = roomRegistry.getPublicRoom(roomIdFromPath).id;
                    res.writeHead(302, {
                        Location: `/${encodeURIComponent(normalizedRoomId)}/`,
                    });
                    res.end();
                    return;
                }

                serveHtmlFile(res, 'index.html', rootDir, appVersionLabel);
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        })().catch(error => {
            respondJson(res, 500, {
                error: error.message || 'INTERNAL_SERVER_ERROR',
            });
        });
    };
}

module.exports = { createHttpHandler };
