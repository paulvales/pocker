const fs = require('fs/promises');
const {
    ERROR_CODES,
    HTTP_ROUTES,
    createHealthPayload,
    createHistoryResponse,
    createSaasBootstrapPayload,
    createVersionPayload,
    getErrorCode,
    parseHistoryFilters,
} = require('../../../../packages/contracts');

function buildDefaultHeaders(extraHeaders = {}) {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
        ...extraHeaders,
    };
}

function respondJson(res, statusCode, payload) {
    res.writeHead(statusCode, buildDefaultHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    }));
    res.end(JSON.stringify(payload));
}

function respondText(res, statusCode, payload) {
    res.writeHead(statusCode, buildDefaultHeaders({
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
    }));
    res.end(String(payload ?? ''));
}

function redirect(res, location) {
    res.writeHead(302, buildDefaultHeaders({
        Location: location,
        'Cache-Control': 'no-store',
    }));
    res.end();
}

function renderHtmlTemplate(template, versionLabel) {
    return template.replace(/__APP_VERSION__/g, versionLabel);
}

function extractRoomIdFromPathname(pathname) {
    const segments = String(pathname || '/')
        .split('/')
        .filter(Boolean);
    if (segments.length !== 1) {
        return '';
    }

    try {
        return decodeURIComponent(segments[0]);
    } catch (error) {
        return segments[0];
    }
}

async function readFirstAvailablePage(candidates) {
    let lastError = null;

    for (const candidate of candidates) {
        try {
            const template = await fs.readFile(candidate.filePath, 'utf8');
            return {
                fileName: candidate.fileName,
                template,
            };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }

            lastError = error;
        }
    }

    throw lastError || new Error('PAGE_FILE_NOT_FOUND');
}

async function serveHtmlPage(res, candidates, versionLabel) {
    try {
        const page = await readFirstAvailablePage(candidates);
        res.writeHead(200, buildDefaultHeaders({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        }));
        res.end(renderHtmlTemplate(page.template, versionLabel));
    } catch (error) {
        const fileName = candidates[0]?.fileName || 'page';
        res.writeHead(500, buildDefaultHeaders({
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        }));
        res.end(`Error loading ${fileName}`);
    }
}

function getHomePageCandidates(config) {
    if (config.frontend.mode === 'legacy') {
        return [{
            fileName: 'index.html',
            filePath: config.frontend.legacyHomeFilePath,
        }];
    }

    return [{
        fileName: 'index.html',
        filePath: config.frontend.reactEntryFilePath,
    }];
}

function getHistoryPageCandidates(config) {
    if (config.frontend.mode === 'legacy') {
        return [{
            fileName: 'history.html',
            filePath: config.frontend.legacyHistoryFilePath,
        }];
    }

    return [{
        fileName: 'index.html',
        filePath: config.frontend.reactEntryFilePath,
    }];
}

function getSettingsPageCandidates(config) {
    if (config.frontend.mode !== 'react') {
        return [];
    }

    return [{
        fileName: 'index.html',
        filePath: config.frontend.reactEntryFilePath,
    }];
}

function getSettingsStatusCode(errorCode) {
    if (errorCode === ERROR_CODES.workspaceNotFound) {
        return 404;
    }

    if (
        errorCode === ERROR_CODES.forbidden
        || errorCode === ERROR_CODES.unauthorized
    ) {
        return 403;
    }

    return 500;
}

function createHttpRequestHandler({
    auditLogStore,
    config,
    errorMonitor,
    logger,
    roomRegistry,
    estimationHistoryStore,
    saasFoundationService,
}) {
    return async function handleRequest(req, res) {
        try {
            const requestUrl = new URL(req.url || '/', 'http://localhost');
            const { pathname } = requestUrl;
            const roomIdFromPath = extractRoomIdFromPathname(pathname);

            if (pathname === HTTP_ROUTES.health) {
                respondJson(res, 200, createHealthPayload({
                    version: config.version,
                    build: config.build || null,
                }));
                return;
            }

            if (pathname === HTTP_ROUTES.version) {
                respondJson(res, 200, createVersionPayload({
                    version: config.version,
                    build: config.build || null,
                    label: config.versionLabel,
                }));
                return;
            }

            if (pathname === HTTP_ROUTES.history) {
                redirect(res, HTTP_ROUTES.historyPage);
                return;
            }

            if (pathname === HTTP_ROUTES.homeHtml && config.frontend.mode === 'react') {
                redirect(res, HTTP_ROUTES.home);
                return;
            }

            if (pathname === HTTP_ROUTES.historyHtml && config.frontend.mode === 'react') {
                redirect(res, HTTP_ROUTES.historyPage);
                return;
            }

            if (pathname === HTTP_ROUTES.historyPage || pathname === HTTP_ROUTES.historyHtml) {
                await serveHtmlPage(res, getHistoryPageCandidates(config), config.versionLabel);
                return;
            }

            if (pathname === HTTP_ROUTES.settingsBootstrap) {
                try {
                    const context = saasFoundationService.resolveHttpContext(req);
                    respondJson(
                        res,
                        200,
                        createSaasBootstrapPayload(
                            saasFoundationService.getSettingsBootstrap(context),
                        ),
                    );
                } catch (error) {
                    const errorCode = getErrorCode(error, ERROR_CODES.settingsReadFailed);
                    logger.warn('http.settings_bootstrap.denied', {
                        errorCode,
                        path: pathname,
                    });
                    if (errorCode === ERROR_CODES.settingsReadFailed) {
                        errorMonitor.capture(error, {
                            event: 'http.settings_bootstrap.failed',
                            path: pathname,
                        });
                    }
                    respondJson(res, getSettingsStatusCode(errorCode), {
                        error: errorCode,
                    });
                }
                return;
            }

            if (pathname === HTTP_ROUTES.settings) {
                if (config.frontend.mode === 'react') {
                    redirect(res, HTTP_ROUTES.settingsPage);
                    return;
                }

                respondText(res, 404, 'Not found');
                return;
            }

            if (pathname === HTTP_ROUTES.settingsPage) {
                if (config.frontend.mode !== 'react') {
                    respondText(res, 404, 'Not found');
                    return;
                }

                await serveHtmlPage(res, getSettingsPageCandidates(config), config.versionLabel);
                return;
            }

            if (pathname === HTTP_ROUTES.estimationHistory) {
                try {
                    const filters = parseHistoryFilters(requestUrl.searchParams);
                    const [historyResult, meta] = await Promise.all([
                        estimationHistoryStore.list(filters),
                        estimationHistoryStore.listMeta(),
                    ]);

                    respondJson(res, 200, createHistoryResponse({
                        items: historyResult.items,
                        meta: {
                            ...meta,
                            pagination: historyResult.pagination,
                        },
                    }));
                } catch (error) {
                    errorMonitor.capture(error, {
                        event: 'http.estimation_history.failed',
                        path: pathname,
                    });
                    respondJson(res, 500, {
                        error: getErrorCode(error, ERROR_CODES.historyReadFailed),
                    });
                }
                return;
            }

            if (pathname === HTTP_ROUTES.home || pathname === HTTP_ROUTES.homeHtml) {
                await serveHtmlPage(res, getHomePageCandidates(config), config.versionLabel);
                return;
            }

            if (roomIdFromPath && roomRegistry.isValidRoomId(roomIdFromPath)) {
                if (!pathname.endsWith('/')) {
                    const normalizedRoomId = roomRegistry.getPublicRoom(roomIdFromPath).id;
                    redirect(res, `/${encodeURIComponent(normalizedRoomId)}/`);
                    return;
                }

                await serveHtmlPage(res, getHomePageCandidates(config), config.versionLabel);
                return;
            }

            respondText(res, 404, 'Not found');
        } catch (error) {
            errorMonitor.capture(error, {
                event: 'http.request.failed',
                path: req.url || '/',
            });
            respondJson(res, 500, {
                error: getErrorCode(error, ERROR_CODES.internalServerError),
            });
        }
    };
}

module.exports = {
    createHttpRequestHandler,
};
