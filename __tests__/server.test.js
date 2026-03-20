const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { newDb } = require('pg-mem');
const ioClient = require('socket.io-client');
const packageJson = require('../package.json');
const {
  ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
  HTTP_ROUTES,
  SOCKET_EVENT_NAMES,
} = require('../packages/contracts');

const historyDb = newDb();
const { Pool } = historyDb.adapters.createPg();
const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const SOCKET_SERVER_EVENTS = SOCKET_EVENT_NAMES.server;
const TEST_DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/pocker_test?sslmode=disable';
const SHARED_HISTORY_STORE_OPTIONS = {
  PoolClass: Pool,
  connectionString: TEST_DATABASE_URL,
  skipLegacyDeduplication: true,
};
const SHARED_ROOM_RUNTIME_STORE_OPTIONS = {
  PoolClass: Pool,
  connectionString: TEST_DATABASE_URL,
};

global.__POCKER_HISTORY_STORE_OPTIONS__ = SHARED_HISTORY_STORE_OPTIONS;
global.__POCKER_ROOM_RUNTIME_STORE_OPTIONS__ = SHARED_ROOM_RUNTIME_STORE_OPTIONS;
const { createServerApp, estimationHistoryStore, io, server } = require('..');
delete global.__POCKER_HISTORY_STORE_OPTIONS__;
delete global.__POCKER_ROOM_RUNTIME_STORE_OPTIONS__;

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, res => {
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
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function connectClient(port, options = {}) {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}`, {
      auth: options.auth,
      extraHeaders: options.extraHeaders,
    });

    client.once('connect', () => resolve(client));
    client.once('connect_error', error => {
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

function joinRoom(client, payload) {
  return emitWithAck(client, SOCKET_CLIENT_EVENTS.join, payload);
}

function createRoom(client, roomSuffix) {
  return emitWithAck(client, SOCKET_CLIENT_EVENTS.createRoom, { roomSuffix });
}

function waitForEvent(client, eventName, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(eventName, handler);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    const handler = payload => {
      if (!predicate(payload)) {
        return;
      }

      clearTimeout(timer);
      client.off(eventName, handler);
      resolve(payload);
    };

    client.on(eventName, handler);
  });
}

async function startTestApp(options = {}) {
  const app = createServerApp({
    port: 0,
    estimationHistoryStore,
    roomRuntimeStoreOptions: SHARED_ROOM_RUNTIME_STORE_OPTIONS,
    roomSyncPollIntervalMs: 250,
    ...options,
  });

  await estimationHistoryStore.initialize();
  await new Promise(resolve => {
    app.server.listen(() => {
      resolve();
    });
  });
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
  await new Promise(resolve => {
    setTimeout(resolve, 50);
  });
}

describe('socket server', () => {
  let port;

  beforeAll(async () => {
    await estimationHistoryStore.initialize();
    await new Promise(resolve => {
      server.listen(() => {
        port = server.address().port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    io.close();
    await new Promise(resolve => {
      server.close(resolve);
    });
    await estimationHistoryStore.close();
  });

  test('exposes health and version info over http and serves room paths', async () => {
    const health = await request(port, HTTP_ROUTES.health);
    const version = await request(port, HTTP_ROUTES.version);
    const home = await request(port, HTTP_ROUTES.home);
    const roomHome = await request(port, '/backend-sprint-42/');
    const roomRedirect = await request(port, '/backend-sprint-42');
    const historyPage = await request(port, HTTP_ROUTES.historyPage);
    const historyApi = await request(port, HTTP_ROUTES.estimationHistory);

    expect(health.statusCode).toBe(200);
    expect(JSON.parse(health.body)).toEqual({
      status: 'ok',
      version: packageJson.version,
      build: null,
    });

    expect(version.statusCode).toBe(200);
    expect(JSON.parse(version.body)).toEqual({
      version: packageJson.version,
      build: null,
      label: packageJson.version,
    });

    expect(home.statusCode).toBe(200);
    expect(home.body).toContain(`v ${packageJson.version}`);
    expect(home.body).not.toContain('__APP_VERSION__');
    expect(home.body).toContain('id="historyTopBtn"');

    expect(roomHome.statusCode).toBe(200);
    expect(roomHome.body).toContain(`v ${packageJson.version}`);

    expect(roomRedirect.statusCode).toBe(302);
    expect(roomRedirect.headers.location).toBe('/backend-sprint-42/');

    expect(historyPage.statusCode).toBe(200);
    expect(historyPage.body).toContain('id="historyTable"');
    expect(historyPage.body).toContain(`v ${packageJson.version}`);

    expect(historyApi.statusCode).toBe(200);
    expect(JSON.parse(historyApi.body)).toEqual({
      items: [],
      meta: {
        rooms: [],
        participants: [],
        estimateTypes: [],
        pagination: {
          page: 1,
          pageSize: ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
  });

  test('serves React history entry and redirects history.html in react mode', async () => {
    const tempProjectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'pocker-react-history-'),
    );
    const reactDistDirectory = path.join(tempProjectRoot, 'apps', 'web', 'dist');
    const reactEntryFile = path.join(reactDistDirectory, 'index.html');

    await fs.mkdir(reactDistDirectory, { recursive: true });
    await fs.writeFile(
      reactEntryFile,
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf8',
    );

    const reactApp = createServerApp({
      frontendMode: 'react',
      port: 0,
      projectRoot: tempProjectRoot,
      estimationHistoryStore,
      roomRuntimeStoreOptions: SHARED_ROOM_RUNTIME_STORE_OPTIONS,
    });

    let reactPort = 0;

    try {
      await new Promise((resolve) => {
        reactApp.server.listen(() => {
          reactPort = reactApp.server.address().port;
          resolve();
        });
      });

      const historyPage = await request(reactPort, HTTP_ROUTES.historyPage);
      const historyHtml = await request(reactPort, HTTP_ROUTES.historyHtml);

      expect(historyPage.statusCode).toBe(200);
      expect(historyPage.body).toContain('<div id="root"></div>');
      expect(historyPage.body).not.toContain('id="historyTable"');

      expect(historyHtml.statusCode).toBe(302);
      expect(historyHtml.headers.location).toBe(HTTP_ROUTES.historyPage);
    } finally {
      reactApp.io.close();
      await new Promise((resolve) => {
        reactApp.server.close(resolve);
      });
      await fs.rm(tempProjectRoot, { recursive: true, force: true });
    }
  });

  test('serves React settings entry and redirects /settings in react mode', async () => {
    const tempProjectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'pocker-react-settings-'),
    );
    const reactDistDirectory = path.join(tempProjectRoot, 'apps', 'web', 'dist');
    const reactEntryFile = path.join(reactDistDirectory, 'index.html');

    await fs.mkdir(reactDistDirectory, { recursive: true });
    await fs.writeFile(
      reactEntryFile,
      '<!doctype html><html><body><div id="root"></div></body></html>',
      'utf8',
    );

    const reactApp = createServerApp({
      frontendMode: 'react',
      port: 0,
      projectRoot: tempProjectRoot,
      estimationHistoryStore,
      roomRuntimeStoreOptions: SHARED_ROOM_RUNTIME_STORE_OPTIONS,
    });

    let reactPort = 0;

    try {
      await new Promise((resolve) => {
        reactApp.server.listen(() => {
          reactPort = reactApp.server.address().port;
          resolve();
        });
      });

      const settingsRoute = await request(reactPort, HTTP_ROUTES.settings);
      const settingsPage = await request(reactPort, HTTP_ROUTES.settingsPage);

      expect(settingsRoute.statusCode).toBe(302);
      expect(settingsRoute.headers.location).toBe(HTTP_ROUTES.settingsPage);

      expect(settingsPage.statusCode).toBe(200);
      expect(settingsPage.body).toContain('<div id="root"></div>');
    } finally {
      reactApp.io.close();
      await new Promise((resolve) => {
        reactApp.server.close(resolve);
      });
      await fs.rm(tempProjectRoot, { recursive: true, force: true });
    }
  });

  test('returns SaaS bootstrap data, rejects guest settings access and tracks room metadata', async () => {
    const bootstrapBefore = await request(port, HTTP_ROUTES.settingsBootstrap);

    expect(bootstrapBefore.statusCode).toBe(200);
    expect(JSON.parse(bootstrapBefore.body)).toEqual(expect.objectContaining({
      actor: expect.objectContaining({
        id: 'owner-user',
        kind: 'member',
        role: 'owner',
      }),
      workspace: expect.objectContaining({
        id: 'workspace-core',
        slug: 'core',
      }),
      billing: expect.objectContaining({
        plan: 'free',
        status: 'ready',
      }),
      authorization: expect.objectContaining({
        canManageWorkspace: true,
        canManageMembers: true,
        canManageBilling: true,
        canManageRooms: true,
      }),
    }));

    const guestSettings = await request(port, HTTP_ROUTES.settingsBootstrap, {
      headers: {
        'x-pocker-actor-id': 'guest-http-1',
        'x-pocker-actor-kind': 'guest',
      },
    });
    const missingWorkspace = await request(port, HTTP_ROUTES.settingsBootstrap, {
      headers: {
        'x-pocker-workspace-id': 'missing-workspace',
      },
    });

    expect(guestSettings.statusCode).toBe(403);
    expect(JSON.parse(guestSettings.body)).toEqual({
      error: 'FORBIDDEN',
    });

    expect(missingWorkspace.statusCode).toBe(404);
    expect(JSON.parse(missingWorkspace.body)).toEqual({
      error: 'WORKSPACE_NOT_FOUND',
    });

    const creator = await connectClient(port);
    const roomSuffix = `saas-foundation-${Date.now()}`;

    try {
      const createResult = await createRoom(creator, roomSuffix);
      expect(createResult).toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({
          id: roomSuffix,
        }),
      }));
    } finally {
      creator.close();
    }

    const bootstrapAfter = await request(port, HTTP_ROUTES.settingsBootstrap);
    expect(bootstrapAfter.statusCode).toBe(200);
    expect(JSON.parse(bootstrapAfter.body).rooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: roomSuffix,
          workspaceId: 'workspace-core',
          ownerUserId: 'owner-user',
          ownerType: 'member',
          visibility: 'workspace',
          guestMode: 'open',
        }),
      ]),
    );
  });

  test('blocks guest admin joins when the workspace requires member admins', async () => {
    const restrictedApp = createServerApp({
      port: 0,
      estimationHistoryStore,
      roomRuntimeStoreOptions: SHARED_ROOM_RUNTIME_STORE_OPTIONS,
      saasGuestAdminMode: 'member_only',
    });

    let restrictedPort = 0;

    try {
      await new Promise((resolve) => {
        restrictedApp.server.listen(() => {
          restrictedPort = restrictedApp.server.address().port;
          resolve();
        });
      });

      const memberClient = await connectClient(restrictedPort);
      const guestClient = await connectClient(restrictedPort, {
        auth: {
          actorId: 'guest-joiner',
          actorKind: 'guest',
        },
      });
      const roomSuffix = `member-admin-room-${Date.now()}`;

      try {
        const createResult = await createRoom(memberClient, roomSuffix);
        const roomId = createResult.room.id;

        await joinRoom(memberClient, {
          roomId,
          name: 'Owner',
          isAdmin: true,
        });

        await expect(joinRoom(guestClient, {
          roomId,
          name: 'Guest',
          isAdmin: true,
        })).resolves.toEqual({
          ok: false,
          error: 'FORBIDDEN',
        });

        await expect(
          emitWithAck(guestClient, SOCKET_CLIENT_EVENTS.requestAdminStatus, roomId),
        ).resolves.toBe(false);
      } finally {
        memberClient.close();
        guestClient.close();
      }
    } finally {
      restrictedApp.io.close();
      await new Promise((resolve) => {
        restrictedApp.server.close(resolve);
      });
    }
  });

  test('creates a room id directly from the requested suffix', async () => {
    const client = await connectClient(port);

    try {
      const result = await createRoom(client, 'Backend Sprint 42');

      expect(result).toEqual({
        ok: true,
        room: expect.objectContaining({
          id: 'backend-sprint-42',
          suffix: 'backend-sprint-42',
          label: 'backend-sprint-42',
          joinPath: '/backend-sprint-42/',
        }),
      });
    } finally {
      client.close();
    }
  });

  test('preserves underscore in a requested room slug', async () => {
    const client = await connectClient(port);

    try {
      const result = await createRoom(client, 'qa_team');

      expect(result).toEqual({
        ok: true,
        room: expect.objectContaining({
          id: 'qa_team',
          suffix: 'qa_team',
          label: 'qa_team',
          joinPath: '/qa_team/',
        }),
      });
    } finally {
      client.close();
    }
  });

  test('rejects creating a room when the slug is already taken', async () => {
    const client = await connectClient(port);

    try {
      await expect(createRoom(client, 'shared-room')).resolves.toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({ id: 'shared-room' }),
      }));

      await expect(createRoom(client, 'shared-room')).resolves.toEqual({
        ok: false,
        error: 'ROOM_ALREADY_EXISTS',
      });
    } finally {
      client.close();
    }
  });

  test('rejects joins for invalid room ids', async () => {
    const client = await connectClient(port);

    try {
      const result = await joinRoom(client, {
        roomId: 'socket.io',
        name: 'A',
      });

      expect(result).toEqual({
        ok: false,
        error: 'ROOM_NOT_FOUND',
      });
    } finally {
      client.close();
    }
  });

  test('creator can create a room and broadcast admin note updates to joined teammates', async () => {
    const creator = await connectClient(port);
    const teammate = await connectClient(port);

    try {
      const createResult = await createRoom(creator, 'qa-sync');
      const roomId = createResult.room.id;

      await expect(joinRoom(creator, {
        roomId,
        name: 'Creator',
        isAdmin: true,
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({ id: roomId }),
      }));

      await expect(joinRoom(teammate, {
        roomId,
        name: 'Teammate',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
      }));

      const notePromise = waitForEvent(
        teammate,
        SOCKET_SERVER_EVENTS.noteUpdate,
        message => message === 'hello',
      );
      const noteAck = emitWithAck(creator, SOCKET_CLIENT_EVENTS.noteUpdate, {
        roomId,
        note: 'hello',
      });

      await expect(noteAck).resolves.toEqual({ ok: true });
      await expect(notePromise).resolves.toBe('hello');
    } finally {
      creator.close();
      teammate.close();
    }
  });

  test('returns saved note in join callback for reconnecting clients', async () => {
    const creator = await connectClient(port);
    const participant = await connectClient(port);

    try {
      const createResult = await createRoom(creator, 'analysis-room');
      const roomId = createResult.room.id;
      const note = 'ABC-123 current task';

      await joinRoom(creator, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await emitWithAck(creator, SOCKET_CLIENT_EVENTS.noteUpdate, { roomId, note });

      const state = await joinRoom(participant, {
        roomId,
        name: 'User',
      });

      expect(state).toEqual(expect.objectContaining({
        ok: true,
        note,
        revealed: false,
        estimationMode: 'points',
      }));
      expect(Array.isArray(state.players)).toBe(true);
      expect(state.players).toHaveLength(2);
    } finally {
      creator.close();
      participant.close();
    }
  });

  test('syncs task list state and selected task across clients in a shared link room', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const items = [
      'https://tracker.example/ABC-123',
      'https://tracker.example/ABC-124',
    ];

    try {
      const createResult = await createRoom(adminClient, 'shared-task-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });

      const updateResult = await emitWithAck(adminClient, SOCKET_CLIENT_EVENTS.taskListUpdate, {
        roomId,
        items,
      });
      expect(updateResult).toEqual({
        ok: true,
        taskState: {
          items,
          selectedIndex: 0,
        },
        estimationMode: 'points',
      });

      const viewerState = await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });
      expect(viewerState).toEqual(expect.objectContaining({
        ok: true,
        taskState: {
          items,
          selectedIndex: 0,
        },
        estimationMode: 'points',
      }));

      const nextTaskPromise = waitForEvent(
        viewerClient,
        SOCKET_SERVER_EVENTS.taskStateUpdate,
        state => state.selectedIndex === 1,
      );
      const selectResultPromise = emitWithAck(adminClient, SOCKET_CLIENT_EVENTS.taskSelect, {
        roomId,
        direction: 1,
      });

      await expect(selectResultPromise).resolves.toEqual({
        ok: true,
        taskState: {
          items,
          selectedIndex: 1,
        },
        estimationMode: 'points',
      });
      await expect(nextTaskPromise).resolves.toEqual({
        items,
        selectedIndex: 1,
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('syncs estimation mode and resets it to points on task switch', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const items = [
      'https://tracker.example/ABC-123',
      'https://tracker.example/ABC-124',
    ];

    try {
      const createResult = await createRoom(adminClient, 'estimation-mode-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await emitWithAck(adminClient, 'task_list_update', {
        roomId,
        items,
      });

      const hoursModePromise = waitForEvent(viewerClient, 'estimation_mode_update', mode => mode === 'hours');
      const setModeResult = await emitWithAck(adminClient, 'set_estimation_mode', {
        roomId,
        mode: 'hours',
      });

      expect(setModeResult).toEqual({
        ok: true,
        estimationMode: 'hours',
      });
      await expect(hoursModePromise).resolves.toBe('hours');

      const resetModePromise = waitForEvent(viewerClient, 'estimation_mode_update', mode => mode === 'points');
      const taskStatePromise = waitForEvent(viewerClient, 'task_state_update', state => state.selectedIndex === 1);

      const selectResult = await emitWithAck(adminClient, 'task_select', {
        roomId,
        direction: 1,
      });

      expect(selectResult).toEqual({
        ok: true,
        taskState: {
          items,
          selectedIndex: 1,
        },
        estimationMode: 'points',
      });
      await expect(resetModePromise).resolves.toBe('points');
      await expect(taskStatePromise).resolves.toEqual({
        items,
        selectedIndex: 1,
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('changing estimation mode clears existing votes for the new scale', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'mode-clears-votes-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      const initialVotePromise = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === '5'),
      );
      viewerClient.emit('vote', { roomId, value: '5' });
      await expect(initialVotePromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '5' }),
        ]),
      );

      const hoursModePromise = waitForEvent(viewerClient, 'estimation_mode_update', mode => mode === 'hours');
      const clearedVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.every(player => player.vote === null),
      );

      const setModeResult = await emitWithAck(adminClient, 'set_estimation_mode', {
        roomId,
        mode: 'hours',
      });

      expect(setModeResult).toEqual({
        ok: true,
        estimationMode: 'hours',
      });
      await expect(hoursModePromise).resolves.toBe('hours');
      await expect(clearedVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: null }),
          expect.objectContaining({ name: 'Viewer', vote: null }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('records revealed estimates into history, stores the room, and overwrites repeated estimates', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const selectedTask = 'https://tracker.example/APP-1201';

    try {
      const createResult = await createRoom(adminClient, 'history-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await expect(emitWithAck(adminClient, 'task_list_update', {
        roomId,
        items: [selectedTask],
      })).resolves.toEqual({
        ok: true,
        taskState: {
          items: [selectedTask],
          selectedIndex: 0,
        },
        estimationMode: 'points',
      });

      await expect(emitWithAck(adminClient, 'set_estimation_mode', {
        roomId,
        mode: 'hours',
      })).resolves.toEqual({
        ok: true,
        estimationMode: 'hours',
      });

      const revealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId, value: '8' });
      adminClient.emit('reveal', roomId);
      await expect(revealPromise).resolves.toBe(true);

      const resetRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === false);
      const resetVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.every(player => player.vote === null),
      );
      adminClient.emit('reset', roomId);
      await expect(resetRevealPromise).resolves.toBe(false);
      await expect(resetVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: null }),
          expect.objectContaining({ name: 'Viewer', vote: null }),
        ]),
      );

      const secondRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId, value: '13' });
      adminClient.emit('reveal', roomId);
      await expect(secondRevealPromise).resolves.toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      const historyResponse = await request(
        port,
        `/api/estimation-history?roomId=${roomId}&taskId=APP-1201&participantName=Viewer&estimateType=hours&recordedOn=${today}`,
      );

      expect(historyResponse.statusCode).toBe(200);
      expect(JSON.parse(historyResponse.body)).toEqual({
        items: [
          expect.objectContaining({
            roomId,
            taskId: 'APP-1201',
            participantName: 'Viewer',
            estimate: '13',
            estimateType: 'hours',
            recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          }),
        ],
        meta: {
          rooms: [roomId],
          participants: ['Viewer'],
          estimateTypes: ['hours'],
          pagination: {
            page: 1,
            pageSize: 25,
            totalItems: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        },
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('overwrites a repeated estimate for the same task and participant even when the room changes', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const selectedTask = 'https://tracker.example/APP-1202';

    try {
      const firstCreateResult = await createRoom(adminClient, 'history-room-first');
      const firstRoomId = firstCreateResult.room.id;

      await joinRoom(adminClient, {
        roomId: firstRoomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId: firstRoomId,
        name: 'Viewer',
      });

      await emitWithAck(adminClient, 'task_list_update', {
        roomId: firstRoomId,
        items: [selectedTask],
      });
      await emitWithAck(adminClient, 'set_estimation_mode', {
        roomId: firstRoomId,
        mode: 'hours',
      });

      const firstRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId: firstRoomId, value: '5' });
      adminClient.emit('reveal', firstRoomId);
      await expect(firstRevealPromise).resolves.toBe(true);

      const secondCreateResult = await createRoom(adminClient, 'history-room-second');
      const secondRoomId = secondCreateResult.room.id;

      await joinRoom(adminClient, {
        roomId: secondRoomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId: secondRoomId,
        name: 'Viewer',
      });

      await emitWithAck(adminClient, 'task_list_update', {
        roomId: secondRoomId,
        items: [selectedTask],
      });
      await emitWithAck(adminClient, 'set_estimation_mode', {
        roomId: secondRoomId,
        mode: 'hours',
      });

      const secondRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId: secondRoomId, value: '13' });
      adminClient.emit('reveal', secondRoomId);
      await expect(secondRevealPromise).resolves.toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      const historyResponse = await request(
        port,
        `/api/estimation-history?taskId=APP-1202&participantName=Viewer&estimateType=hours&recordedOn=${today}`,
      );

      expect(historyResponse.statusCode).toBe(200);
      const payload = JSON.parse(historyResponse.body);
      expect(payload.items).toEqual([
        expect.objectContaining({
          roomId: secondRoomId,
          taskId: 'APP-1202',
          participantName: 'Viewer',
          estimate: '13',
          estimateType: 'hours',
          recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        }),
      ]);
      expect(payload.meta.rooms).toContain(secondRoomId);
      expect(payload.meta.participants).toContain('Viewer');
      expect(payload.meta.estimateTypes).toContain('hours');
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('keeps separate history rows for points and hours on the same task', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const selectedTask = 'https://tracker.example/APP-1203';

    try {
      const createResult = await createRoom(adminClient, 'history-room-types');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await emitWithAck(adminClient, 'task_list_update', {
        roomId,
        items: [selectedTask],
      });

      const pointsRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId, value: '3' });
      adminClient.emit('reveal', roomId);
      await expect(pointsRevealPromise).resolves.toBe(true);

      const modeResetPromise = waitForEvent(viewerClient, 'reveal_update', value => value === false);
      const clearedVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.every(player => player.vote === null),
      );

      await expect(emitWithAck(adminClient, 'set_estimation_mode', {
        roomId,
        mode: 'hours',
      })).resolves.toEqual({
        ok: true,
        estimationMode: 'hours',
      });
      await expect(modeResetPromise).resolves.toBe(false);
      await expect(clearedVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: null }),
          expect.objectContaining({ name: 'Viewer', vote: null }),
        ]),
      );

      const hoursRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      viewerClient.emit('vote', { roomId, value: '5' });
      adminClient.emit('reveal', roomId);
      await expect(hoursRevealPromise).resolves.toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      const historyResponse = await request(
        port,
        `/api/estimation-history?taskId=APP-1203&participantName=Viewer&recordedOn=${today}`,
      );

      expect(historyResponse.statusCode).toBe(200);
      const payload = JSON.parse(historyResponse.body);
      expect(payload.items).toHaveLength(2);
      expect(payload.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          roomId,
          taskId: 'APP-1203',
          participantName: 'Viewer',
          estimate: '3',
          estimateType: 'points',
        }),
        expect.objectContaining({
          roomId,
          taskId: 'APP-1203',
          participantName: 'Viewer',
          estimate: '5',
          estimateType: 'hours',
        }),
      ]));
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('returns paginated history with configurable page size', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const selectedTask = 'https://tracker.example/APP-1204';

    try {
      const createResult = await createRoom(adminClient, 'history-room-pagination');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await emitWithAck(adminClient, 'task_list_update', {
        roomId,
        items: [selectedTask],
      });

      const pointsVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.some(player => player.name === 'Admin' && player.vote === '2')
          && players.some(player => player.name === 'Viewer' && player.vote === '3'),
      );
      const pointsRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      adminClient.emit('vote', { roomId, value: '2' });
      viewerClient.emit('vote', { roomId, value: '3' });
      await expect(pointsVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: '2' }),
          expect.objectContaining({ name: 'Viewer', vote: '3' }),
        ]),
      );
      adminClient.emit('reveal', roomId);
      await expect(pointsRevealPromise).resolves.toBe(true);

      const modeResetPromise = waitForEvent(viewerClient, 'reveal_update', value => value === false);
      const clearedVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.every(player => player.vote === null),
      );

      await expect(emitWithAck(adminClient, 'set_estimation_mode', {
        roomId,
        mode: 'hours',
      })).resolves.toEqual({
        ok: true,
        estimationMode: 'hours',
      });
      await expect(modeResetPromise).resolves.toBe(false);
      await expect(clearedVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: null }),
          expect.objectContaining({ name: 'Viewer', vote: null }),
        ]),
      );

      const hoursVotesPromise = waitForEvent(
        viewerClient,
        'votes_update',
        players => players.some(player => player.name === 'Admin' && player.vote === '5')
          && players.some(player => player.name === 'Viewer' && player.vote === '8'),
      );
      const hoursRevealPromise = waitForEvent(viewerClient, 'reveal_update', value => value === true);
      adminClient.emit('vote', { roomId, value: '5' });
      viewerClient.emit('vote', { roomId, value: '8' });
      await expect(hoursVotesPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Admin', vote: '5' }),
          expect.objectContaining({ name: 'Viewer', vote: '8' }),
        ]),
      );
      adminClient.emit('reveal', roomId);
      await expect(hoursRevealPromise).resolves.toBe(true);

      const historyResponse = await request(
        port,
        '/api/estimation-history?taskId=APP-1204&page=2&pageSize=2',
      );

      expect(historyResponse.statusCode).toBe(200);
      const payload = JSON.parse(historyResponse.body);
      expect(payload.items).toHaveLength(2);
      expect(payload.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          taskId: 'APP-1204',
          estimateType: 'points',
        }),
        expect.objectContaining({
          taskId: 'APP-1204',
          estimateType: 'points',
        }),
      ]));
      expect(payload.meta.pagination).toEqual({
        page: 2,
        pageSize: 2,
        totalItems: 4,
        totalPages: 2,
        hasPreviousPage: true,
        hasNextPage: false,
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('syncs participant reactions across clients and includes them in later joins', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const lateClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'reaction-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      const reactionPromise = waitForEvent(
        adminClient,
        'reactions_update',
        players => players.some(player => player.name === 'Viewer' && player.reaction === '🔥'),
      );
      const reactionResult = emitWithAck(viewerClient, 'set_reaction', {
        roomId,
        value: '🔥',
      });

      await expect(reactionResult).resolves.toEqual({
        ok: true,
        reaction: '🔥',
      });
      await expect(reactionPromise).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', reaction: '🔥' }),
        ]),
      );

      const lateJoinState = await joinRoom(lateClient, {
        roomId,
        name: 'Late',
      });

      expect(lateJoinState).toEqual(expect.objectContaining({
        ok: true,
      }));
      expect(lateJoinState.players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', reaction: '🔥' }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
      lateClient.close();
    }
  });

  test('clears reactions automatically after 3 seconds', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'reaction-expiry-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await expect(emitWithAck(viewerClient, 'set_reaction', {
        roomId,
        value: '🔥',
      })).resolves.toEqual({
        ok: true,
        reaction: '🔥',
      });

      const clearedReaction = waitForEvent(
        adminClient,
        'reactions_update',
        players => players.some(player => player.name === 'Viewer' && player.reaction === null),
        4500,
      );

      await expect(clearedReaction).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', reaction: null }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('rejects reactions outside the allowed emoji set', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'reaction-validation-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await expect(emitWithAck(viewerClient, 'set_reaction', {
        roomId,
        value: '🚀',
      })).resolves.toEqual({
        ok: false,
        error: 'REACTION_INVALID',
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('blocks viewers from mutating admin-only room state', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'protected-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
      });

      await expect(emitWithAck(viewerClient, 'task_list_update', {
        roomId,
        items: ['https://tracker.example/ABC-999'],
      })).resolves.toEqual({
        ok: false,
        error: 'FORBIDDEN',
      });

      await expect(emitWithAck(viewerClient, 'note_update', {
        roomId,
        note: 'forbidden',
      })).resolves.toEqual({
        ok: false,
        error: 'FORBIDDEN',
      });
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('persists durable room state across app restart on the shared runtime store', async () => {
    const firstInstance = await startTestApp();
    const creator = await connectClient(firstInstance.port);
    const roomSuffix = `durable-room-${Date.now()}`;

    try {
      const createResult = await createRoom(creator, roomSuffix);
      const roomId = createResult.room.id;

      await expect(joinRoom(creator, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({ id: roomId }),
      }));

      await expect(emitWithAck(creator, SOCKET_CLIENT_EVENTS.taskListUpdate, {
        roomId,
        items: ['https://tracker.example/APP-2301'],
      })).resolves.toEqual({
        ok: true,
        taskState: {
          items: ['https://tracker.example/APP-2301'],
          selectedIndex: 0,
        },
        estimationMode: 'points',
      });

      await expect(emitWithAck(creator, SOCKET_CLIENT_EVENTS.setEstimationMode, {
        roomId,
        mode: 'hours',
      })).resolves.toEqual({
        ok: true,
        estimationMode: 'hours',
      });

      await expect(emitWithAck(creator, SOCKET_CLIENT_EVENTS.noteUpdate, {
        roomId,
        note: 'APP-2301 durable note',
      })).resolves.toEqual({ ok: true });

      creator.close();
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });
      await stopTestApp(firstInstance.app);

      const secondInstance = await startTestApp();
      const viewer = await connectClient(secondInstance.port);

      try {
        const joinState = await joinRoom(viewer, {
          roomId,
          name: 'Viewer',
        });

        expect(joinState).toEqual(expect.objectContaining({
          ok: true,
          note: 'APP-2301 durable note',
          revealed: false,
          estimationMode: 'hours',
          taskState: {
            items: ['https://tracker.example/APP-2301'],
            selectedIndex: 0,
          },
        }));
      } finally {
        viewer.close();
        await stopTestApp(secondInstance.app);
      }
    } finally {
      creator.close();
      if (firstInstance?.app?.server?.listening) {
        await stopTestApp(firstInstance.app);
      }
    }
  });

  test('keeps the admin seat reserved during recovery and restores it for the same participant', async () => {
    const adminClient = await connectClient(port);
    const observerClient = await connectClient(port);
    const recoveringClient = await connectClient(port);
    const roomSuffix = `recovery-room-${Date.now()}`;

    try {
      const createResult = await createRoom(adminClient, roomSuffix);
      const roomId = createResult.room.id;

      await expect(joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({ id: roomId }),
      }));

      adminClient.close();
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });

      await expect(
        emitWithAck(observerClient, SOCKET_CLIENT_EVENTS.requestAdminStatus, roomId),
      ).resolves.toBe(false);

      const recoveryState = await joinRoom(recoveringClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });

      expect(recoveryState).toEqual(expect.objectContaining({
        ok: true,
        players: [
          expect.objectContaining({
            name: 'Admin',
            isAdmin: true,
          }),
        ],
      }));
    } finally {
      adminClient.close();
      observerClient.close();
      recoveringClient.close();
    }
  });

  test('propagates durable room updates across instances through the shared runtime event log', async () => {
    const firstInstance = await startTestApp();
    const secondInstance = await startTestApp();
    const creator = await connectClient(firstInstance.port);
    const viewer = await connectClient(secondInstance.port);
    const roomSuffix = `sync-room-${Date.now()}`;

    try {
      const createResult = await createRoom(creator, roomSuffix);
      const roomId = createResult.room.id;

      await joinRoom(creator, {
        roomId,
        name: 'Creator',
        isAdmin: true,
      });

      await expect(joinRoom(viewer, {
        roomId,
        name: 'Viewer',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        room: expect.objectContaining({ id: roomId }),
      }));

      const replicatedNote = waitForEvent(
        viewer,
        SOCKET_SERVER_EVENTS.noteUpdate,
        note => note === 'cross-instance note',
        4000,
      );

      await expect(emitWithAck(creator, SOCKET_CLIENT_EVENTS.noteUpdate, {
        roomId,
        note: 'cross-instance note',
      })).resolves.toEqual({ ok: true });

      await expect(replicatedNote).resolves.toBe('cross-instance note');
    } finally {
      creator.close();
      viewer.close();
      await stopTestApp(firstInstance.app);
      await stopTestApp(secondInstance.app);
    }
  });
});
