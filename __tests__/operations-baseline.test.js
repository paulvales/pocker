const http = require('http');
const { newDb } = require('pg-mem');
const ioClient = require('socket.io-client');
const { createServerApp } = require('../apps/server');
const { createAppLogger } = require('../apps/server/src/observability/create-app-logger');
const { createErrorMonitor } = require('../apps/server/src/observability/create-error-monitor');
const {
    HTTP_ROUTES,
    SOCKET_EVENT_NAMES,
} = require('../packages/contracts');

const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const TEST_DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/pocker_ops_test?sslmode=disable';

function request(port, pathname, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port,
            path: pathname,
            method: options.method || 'GET',
            headers: options.headers || {},
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body,
                });
            });
        });

        req.on('error', reject);
        req.end();
    });
}

function connectClient(port, options = {}) {
    return new Promise((resolve, reject) => {
        const client = ioClient(`http://127.0.0.1:${port}`, {
            auth: options.auth,
            extraHeaders: options.extraHeaders,
        });

        client.once('connect', () => resolve(client));
        client.once('connect_error', (error) => {
            client.close();
            reject(error);
        });
    });
}

function emitWithAck(client, eventName, payload) {
    return new Promise(resolve => {
        client.emit(eventName, payload, resolve);
    });
}

async function waitForValue(readValue, predicate, {
    timeoutMs = 2000,
    intervalMs = 25,
} = {}) {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
        const value = await readValue();
        if (predicate(value)) {
            return value;
        }

        await new Promise(resolve => {
            setTimeout(resolve, intervalMs);
        });
    }

    throw new Error('Timed out waiting for expected value');
}

function createStoreOptions() {
    const db = newDb();
    const { Pool } = db.adapters.createPg();

    return {
        historyStoreOptions: {
            PoolClass: Pool,
            connectionString: TEST_DATABASE_URL,
            skipLegacyDeduplication: true,
        },
        roomRuntimeStoreOptions: {
            PoolClass: Pool,
            connectionString: TEST_DATABASE_URL,
        },
        auditLogStoreOptions: {
            PoolClass: Pool,
            connectionString: TEST_DATABASE_URL,
        },
    };
}

async function startTestApp(options = {}) {
    const storeOptions = createStoreOptions();
    const app = createServerApp({
        port: 0,
        ...storeOptions,
        ...options,
    });

    await app.start();

    return {
        app,
        port: app.server.address().port,
    };
}

async function stopTestApp(app) {
    app.io.close();
    await new Promise(resolve => {
        app.server.close(resolve);
    });
    await app.estimationHistoryStore.close();
    await new Promise(resolve => {
        setTimeout(resolve, 50);
    });
}

describe('operations baseline', () => {
    test('structured logger redacts secrets and monitoring hook receives captured errors', () => {
        const records = [];
        const capturedEvents = [];
        const logger = createAppLogger({
            level: 'debug',
            sink: record => {
                records.push(record);
            },
            bindings: {
                authorization: 'Bearer secret-token',
            },
        });
        const monitor = createErrorMonitor({
            logger,
            onError(event) {
                capturedEvents.push(event);
            },
        });
        const error = new Error('boom');

        logger.info('baseline.log', {
            cookie: 'session-cookie',
            nested: {
                token: 'secret-token',
                safe: 'visible',
            },
        });
        monitor.capture(error, {
            event: 'baseline.error',
            password: 'super-secret',
        });

        expect(records).toHaveLength(2);
        expect(records[0]).toEqual(expect.objectContaining({
            event: 'baseline.log',
            authorization: '[REDACTED]',
            cookie: '[REDACTED]',
            nested: {
                token: '[REDACTED]',
                safe: 'visible',
            },
        }));
        expect(records[1]).toEqual(expect.objectContaining({
            event: 'baseline.error',
            password: '[REDACTED]',
            error: expect.objectContaining({
                message: 'boom',
            }),
        }));
        expect(capturedEvents).toEqual([
            expect.objectContaining({
                error,
                context: expect.objectContaining({
                    event: 'baseline.error',
                    password: 'super-secret',
                }),
                capturedAt: expect.any(String),
            }),
        ]);
    });

    test('sets security headers on json, html and redirect responses', async () => {
        const { app, port } = await startTestApp();

        try {
            const healthResponse = await request(port, HTTP_ROUTES.health);
            const homeResponse = await request(port, HTTP_ROUTES.home);
            const redirectResponse = await request(port, HTTP_ROUTES.historyHtml);

            expect(healthResponse.statusCode).toBe(200);
            expect(healthResponse.headers['x-content-type-options']).toBe('nosniff');
            expect(healthResponse.headers['x-frame-options']).toBe('DENY');
            expect(healthResponse.headers['referrer-policy']).toBe('same-origin');
            expect(healthResponse.headers['cache-control']).toBe('no-store');

            expect(homeResponse.statusCode).toBe(200);
            expect(homeResponse.headers['x-content-type-options']).toBe('nosniff');
            expect(homeResponse.headers['x-frame-options']).toBe('DENY');
            expect(homeResponse.headers['referrer-policy']).toBe('same-origin');
            expect(homeResponse.headers['cache-control']).toBe('no-store');

            expect(redirectResponse.statusCode).toBe(302);
            expect(redirectResponse.headers.location).toBe(HTTP_ROUTES.historyPage);
            expect(redirectResponse.headers['x-content-type-options']).toBe('nosniff');
            expect(redirectResponse.headers['x-frame-options']).toBe('DENY');
            expect(redirectResponse.headers['referrer-policy']).toBe('same-origin');
            expect(redirectResponse.headers['cache-control']).toBe('no-store');
        } finally {
            await stopTestApp(app);
        }
    });

    test('rate limits room creation across reconnects for the same actor', async () => {
        const { app, port } = await startTestApp({
            createRoomRateLimitLimit: 1,
            createRoomRateLimitWindowMs: 60 * 1000,
        });
        const firstClient = await connectClient(port, {
            auth: {
                actorId: 'rate-limit-guest',
                actorKind: 'guest',
            },
        });
        const secondClient = await connectClient(port, {
            auth: {
                actorId: 'rate-limit-guest',
                actorKind: 'guest',
            },
        });

        try {
            await expect(
                emitWithAck(firstClient, SOCKET_CLIENT_EVENTS.createRoom, {
                    roomSuffix: 'rate-limit-one',
                }),
            ).resolves.toEqual(expect.objectContaining({
                ok: true,
                room: expect.objectContaining({
                    id: 'rate-limit-one',
                }),
            }));

            await expect(
                emitWithAck(secondClient, SOCKET_CLIENT_EVENTS.createRoom, {
                    roomSuffix: 'rate-limit-two',
                }),
            ).resolves.toEqual({
                ok: false,
                error: 'RATE_LIMITED',
            });
        } finally {
            firstClient.close();
            secondClient.close();
            await stopTestApp(app);
        }
    });

    test('blocks invite-only guest joins without an invite code and allows them with an active invite', async () => {
        const { app, port } = await startTestApp({
            saasGuestMode: 'invite_only',
            saasRoomGuestMode: 'invite_only',
        });
        const ownerClient = await connectClient(port);
        const guestWithoutInvite = await connectClient(port, {
            auth: {
                actorId: 'guest-no-invite',
                actorKind: 'guest',
            },
        });
        const guestWithInvite = await connectClient(port, {
            auth: {
                actorId: 'guest-with-invite',
                actorKind: 'guest',
                inviteCode: 'GUEST-ROOM',
            },
        });

        try {
            const createResult = await emitWithAck(ownerClient, SOCKET_CLIENT_EVENTS.createRoom, {
                roomSuffix: 'invite-only-room',
            });
            const roomId = createResult.room.id;

            await expect(
                emitWithAck(ownerClient, SOCKET_CLIENT_EVENTS.join, {
                    roomId,
                    name: 'Owner',
                    isAdmin: true,
                }),
            ).resolves.toEqual(expect.objectContaining({
                ok: true,
            }));

            await expect(
                emitWithAck(guestWithoutInvite, SOCKET_CLIENT_EVENTS.join, {
                    roomId,
                    name: 'Guest',
                    isAdmin: false,
                }),
            ).resolves.toEqual({
                ok: false,
                error: 'FORBIDDEN',
            });

            await expect(
                emitWithAck(guestWithInvite, SOCKET_CLIENT_EVENTS.join, {
                    roomId,
                    name: 'Invited guest',
                    isAdmin: false,
                }),
            ).resolves.toEqual(expect.objectContaining({
                ok: true,
                room: expect.objectContaining({
                    id: roomId,
                }),
            }));
        } finally {
            ownerClient.close();
            guestWithoutInvite.close();
            guestWithInvite.close();
            await stopTestApp(app);
        }
    });

    test('records audit events for admin room mutations', async () => {
        const { app, port } = await startTestApp();
        const adminClient = await connectClient(port);

        try {
            const createResult = await emitWithAck(adminClient, SOCKET_CLIENT_EVENTS.createRoom, {
                roomSuffix: 'audit-room',
            });
            const roomId = createResult.room.id;

            await expect(
                emitWithAck(adminClient, SOCKET_CLIENT_EVENTS.join, {
                    roomId,
                    name: 'Owner',
                    isAdmin: true,
                }),
            ).resolves.toEqual(expect.objectContaining({
                ok: true,
            }));

            await expect(
                emitWithAck(adminClient, SOCKET_CLIENT_EVENTS.noteUpdate, {
                    roomId,
                    note: 'APP-25 tracked note',
                }),
            ).resolves.toEqual({ ok: true });

            const auditEvents = await waitForValue(
                () => app.auditLogStore.list({ roomId }),
                events => events.some(event => event.eventType === 'room.note.updated'),
            );

            expect(auditEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    roomId,
                    actorId: 'owner-user',
                    actorKind: 'member',
                    workspaceId: 'workspace-core',
                    eventType: 'room.note.updated',
                    outcome: 'success',
                    metadata: expect.objectContaining({
                        noteLength: 19,
                    }),
                }),
                expect.objectContaining({
                    roomId,
                    actorId: 'owner-user',
                    eventType: 'room.created',
                }),
            ]));
        } finally {
            adminClient.close();
            await stopTestApp(app);
        }
    });
});
