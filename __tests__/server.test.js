const { io, server } = require('..');
const http = require('http');
const ioClient = require('socket.io-client');
const packageJson = require('../package.json');

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

  beforeAll(done => {
    server.listen(() => {
      port = server.address().port;
      done();
    });
  });

  afterAll(done => {
    io.close();
    server.close(done);
  });

  test('exposes health and version info over http', async () => {
    const health = await request(port, '/health');
    const version = await request(port, '/version');
    const home = await request(port, '/');

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
  });

  test('creates a unique room id from the requested suffix', async () => {
    const client = await connectClient(port);

    try {
      const result = await createRoom(client, 'Backend Sprint 42');

      expect(result).toEqual({
        ok: true,
        room: expect.objectContaining({
          id: expect.stringMatching(/^backend-sprint-42-[a-f0-9]{6}$/),
          suffix: 'backend-sprint-42',
          label: 'backend-sprint-42',
          joinPath: expect.stringContaining('/?room='),
        }),
      });
      expect(result.room.joinPath).toBe(`/?room=${encodeURIComponent(result.room.id)}`);
    } finally {
      client.close();
    }
  });

  test('rejects joins for invalid room ids', async () => {
    const client = await connectClient(port);

    try {
      const result = await joinRoom(client, {
        roomId: 'invalid-room-id',
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
