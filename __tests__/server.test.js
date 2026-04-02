const http = require('http');
const { newDb } = require('pg-mem');
const ioClient = require('socket.io-client');
const packageJson = require('../package.json');
const { createEstimationHistoryStore } = require('../estimation-history-store');

const historyDb = newDb();
const { Pool } = historyDb.adapters.createPg();

global.__POCKER_HISTORY_STORE_OPTIONS__ = {
  PoolClass: Pool,
  connectionString: 'postgres://test:test@127.0.0.1:5432/pocker_test?sslmode=disable',
  skipLegacyDeduplication: true,
};
const { estimationHistoryStore, io, server } = require('..');
delete global.__POCKER_HISTORY_STORE_OPTIONS__;

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '127.0.0.1',
      port,
      path: pathname,
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
  });
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://localhost:${port}`);

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
  return emitWithAck(client, 'join', payload);
}

function createRoom(client, roomSuffix) {
  return emitWithAck(client, 'create_room', { roomSuffix });
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
    const health = await request(port, '/health');
    const version = await request(port, '/version');
    const home = await request(port, '/');
    const roomHome = await request(port, '/backend-sprint-42/');
    const roomRedirect = await request(port, '/backend-sprint-42');
    const historyPage = await request(port, '/history/');
    const historyApi = await request(port, '/api/estimation-history');

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
          pageSize: 25,
          totalItems: 0,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    });
  });

  test('uses a disabled history store when DATABASE_URL is missing', async () => {
    const store = createEstimationHistoryStore({ connectionString: '' });

    await expect(store.initialize()).resolves.toBeUndefined();
    await expect(store.append([
      {
        roomId: 'room-1',
        taskId: 'APP-1',
        participantName: 'Alice',
        estimate: '3',
        estimateType: 'points',
        recordedAt: '2026-03-21T00:00:00.000Z',
      },
    ])).resolves.toEqual([
      {
        roomId: 'room-1',
        taskId: 'APP-1',
        participantName: 'Alice',
        estimate: '3',
        estimateType: 'points',
        recordedAt: '2026-03-21T00:00:00.000Z',
      },
    ]);
    await expect(store.list({ page: 2, pageSize: 10 })).resolves.toEqual({
      items: [],
      pagination: {
        page: 2,
        pageSize: 10,
        totalItems: 0,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false,
      },
    });
    await expect(store.listMeta()).resolves.toEqual({
      rooms: [],
      participants: [],
      estimateTypes: [],
    });
    await expect(store.close()).resolves.toBeUndefined();
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

      const notePromise = waitForEvent(teammate, 'note_update', message => message === 'hello');
      const noteAck = emitWithAck(creator, 'note_update', {
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
      await emitWithAck(creator, 'note_update', { roomId, note });

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

      const updateResult = await emitWithAck(adminClient, 'task_list_update', {
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

      const nextTaskPromise = waitForEvent(viewerClient, 'task_state_update', state => state.selectedIndex === 1);
      const selectResultPromise = emitWithAck(adminClient, 'task_select', {
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

  test('acknowledges vote updates and persists the latest value', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'vote-ack-room');
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

      const firstVoteUpdate = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === '3'),
      );

      await expect(emitWithAck(viewerClient, 'vote', {
        roomId,
        value: '3',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        value: '3',
      }));
      await expect(firstVoteUpdate).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '3' }),
        ]),
      );

      const secondVoteUpdate = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === '5'),
      );

      await expect(emitWithAck(viewerClient, 'vote', {
        roomId,
        value: '5',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        value: '5',
      }));
      await expect(secondVoteUpdate).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '5' }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
    }
  });

  test('returns FORBIDDEN for votes sent after reconnect without rejoining', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    let reconnectedClient = null;

    try {
      const createResult = await createRoom(adminClient, 'vote-reconnect-room');
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

      viewerClient.close();
      reconnectedClient = await connectClient(port);

      await expect(emitWithAck(reconnectedClient, 'vote', {
        roomId,
        value: '5',
      })).resolves.toEqual({
        ok: false,
        error: 'FORBIDDEN',
      });
    } finally {
      adminClient.close();
      viewerClient.close();
      if (reconnectedClient) {
        reconnectedClient.close();
      }
    }
  });

  test('keeps the latest vote when a participant quickly changes 3 to 5', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const lateClient = await connectClient(port);

    try {
      const createResult = await createRoom(adminClient, 'vote-change-room');
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

      const latestVoteUpdate = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === '5'),
      );

      await Promise.all([
        emitWithAck(viewerClient, 'vote', {
          roomId,
          value: '3',
        }),
        emitWithAck(viewerClient, 'vote', {
          roomId,
          value: '5',
        }),
      ]);

      await expect(latestVoteUpdate).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '5' }),
        ]),
      );

      const lateJoinState = await joinRoom(lateClient, {
        roomId,
        name: 'Late',
      });

      expect(lateJoinState.players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '5' }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
      lateClient.close();
    }
  });

  test('allows voting after reconnect once the client rejoins the room', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    let reconnectedClient = null;

    try {
      const createResult = await createRoom(adminClient, 'vote-rejoin-room');
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

      viewerClient.close();
      reconnectedClient = await connectClient(port);

      await expect(joinRoom(reconnectedClient, {
        roomId,
        name: 'Viewer',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
      }));

      const voteUpdate = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === '8'),
      );

      await expect(emitWithAck(reconnectedClient, 'vote', {
        roomId,
        value: '8',
      })).resolves.toEqual(expect.objectContaining({
        ok: true,
        value: '8',
      }));
      await expect(voteUpdate).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Viewer', vote: '8' }),
        ]),
      );
    } finally {
      adminClient.close();
      viewerClient.close();
      if (reconnectedClient) {
        reconnectedClient.close();
      }
    }
  });

  test('deduplicates reconnecting participant by sessionId', async () => {
    const adminClient = await connectClient(port);
    const viewerClient = await connectClient(port);
    const viewerSessionId = 'viewer-session-1';
    let reconnectedClient = null;

    try {
      const createResult = await createRoom(adminClient, 'dedupe-session-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(viewerClient, {
        roomId,
        name: 'Viewer',
        sessionId: viewerSessionId,
      });

      viewerClient.close();
      reconnectedClient = await connectClient(port);
      const rejoinState = await joinRoom(reconnectedClient, {
        roomId,
        name: 'Viewer',
        sessionId: viewerSessionId,
      });

      const viewers = rejoinState.players.filter(player => player.name === 'Viewer');
      expect(viewers).toHaveLength(1);
      expect(viewers[0]).toEqual(expect.objectContaining({
        id: reconnectedClient.id,
        sessionId: viewerSessionId,
      }));
    } finally {
      adminClient.close();
      viewerClient.close();
      if (reconnectedClient) {
        reconnectedClient.close();
      }
    }
  });

  test('preserves the latest vote across repeated reopen-style reconnect cycles', async () => {
    const adminClient = await connectClient(port);
    let activeViewerClient = await connectClient(port);
    const voteSequence = ['3', '5', '8', '13', '2'];

    try {
      const createResult = await createRoom(adminClient, 'vote-reopen-cycles-room');
      const roomId = createResult.room.id;

      await joinRoom(adminClient, {
        roomId,
        name: 'Admin',
        isAdmin: true,
      });
      await joinRoom(activeViewerClient, {
        roomId,
        name: 'Viewer',
      });

      for (const value of voteSequence) {
        const voteUpdate = waitForEvent(
          adminClient,
          'votes_update',
          players => players.some(player => player.name === 'Viewer' && player.vote === value),
        );

        await expect(emitWithAck(activeViewerClient, 'vote', {
          roomId,
          value,
        })).resolves.toEqual(expect.objectContaining({
          ok: true,
          value,
        }));
        await expect(voteUpdate).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Viewer', vote: value }),
          ]),
        );

        activeViewerClient.close();
        activeViewerClient = await connectClient(port);
        await expect(joinRoom(activeViewerClient, {
          roomId,
          name: 'Viewer',
        })).resolves.toEqual(expect.objectContaining({
          ok: true,
          players: expect.arrayContaining([
            expect.objectContaining({ name: 'Viewer', vote: null }),
          ]),
        }));
      }

      const observerClient = await connectClient(port);
      try {
        const observerState = await joinRoom(observerClient, {
          roomId,
          name: 'Observer',
        });

        expect(observerState.players).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'Viewer', vote: null }),
          ]),
        );
      } finally {
        observerClient.close();
      }
    } finally {
      adminClient.close();
      activeViewerClient.close();
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
});
