const { newDb } = require('pg-mem');
const ioClient = require('socket.io-client');

const historyDb = newDb();
const { Pool } = historyDb.adapters.createPg();

global.__POCKER_HISTORY_STORE_OPTIONS__ = {
  PoolClass: Pool,
  connectionString: 'postgres://stress:stress@127.0.0.1:5432/pocker_stress?sslmode=disable',
  skipLegacyDeduplication: true,
};
const { estimationHistoryStore, io, server } = require('..');
delete global.__POCKER_HISTORY_STORE_OPTIONS__;

function parseArgs(argv) {
  const config = {
    iterations: 120,
    reconnectEvery: 4,
    ackTimeoutMs: 4000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const nextValue = argv[index + 1];

    if (token === '--iterations' && nextValue) {
      config.iterations = Math.max(1, Number.parseInt(nextValue, 10) || config.iterations);
      index += 1;
      continue;
    }

    if (token === '--reconnect-every' && nextValue) {
      config.reconnectEvery = Math.max(0, Number.parseInt(nextValue, 10) || config.reconnectEvery);
      index += 1;
      continue;
    }

    if (token === '--ack-timeout' && nextValue) {
      config.ackTimeoutMs = Math.max(500, Number.parseInt(nextValue, 10) || config.ackTimeoutMs);
      index += 1;
    }
  }

  return config;
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://127.0.0.1:${port}`, {
      reconnection: false,
      transports: ['websocket'],
    });

    client.once('connect', () => resolve(client));
    client.once('connect_error', error => {
      client.close();
      reject(error);
    });
  });
}

function emitWithAck(client, eventName, payload, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ ok: false, error: 'ACK_TIMEOUT' });
    }, timeoutMs);

    client.emit(eventName, payload, result => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result || { ok: false, error: 'UNKNOWN_ERROR' });
    });
  });
}

function waitForEvent(client, eventName, predicate, timeoutMs) {
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

async function startServer() {
  await estimationHistoryStore.initialize();

  return new Promise(resolve => {
    server.listen(() => {
      resolve(server.address().port);
    });
  });
}

async function stopServer() {
  io.close();
  await new Promise(resolve => {
    server.close(resolve);
  });
  await estimationHistoryStore.close();
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const port = await startServer();
  const values = ['1', '2', '3', '5', '8', '13', '20'];
  const roomSuffix = `stress-vote-${Date.now()}`;

  let adminClient = null;
  let viewerClient = null;
  let observerClient = null;
  let finalExpectedVote = null;
  let reconnectCount = 0;

  try {
    adminClient = await connectClient(port);
    viewerClient = await connectClient(port);

    const createResult = await emitWithAck(adminClient, 'create_room', {
      roomSuffix,
    }, config.ackTimeoutMs);
    if (!createResult.ok || !createResult.room || !createResult.room.id) {
      throw new Error(`create_room failed: ${JSON.stringify(createResult)}`);
    }

    const roomId = createResult.room.id;
    const adminJoin = await emitWithAck(adminClient, 'join', {
      roomId,
      name: 'Admin',
      isAdmin: true,
    }, config.ackTimeoutMs);
    if (!adminJoin.ok) {
      throw new Error(`admin join failed: ${JSON.stringify(adminJoin)}`);
    }

    const viewerJoin = await emitWithAck(viewerClient, 'join', {
      roomId,
      name: 'Viewer',
    }, config.ackTimeoutMs);
    if (!viewerJoin.ok) {
      throw new Error(`viewer join failed: ${JSON.stringify(viewerJoin)}`);
    }

    for (let index = 0; index < config.iterations; index += 1) {
      if (config.reconnectEvery > 0 && index > 0 && index % config.reconnectEvery === 0) {
        viewerClient.close();
        viewerClient = await connectClient(port);
        reconnectCount += 1;

        const rejoinResult = await emitWithAck(viewerClient, 'join', {
          roomId,
          name: 'Viewer',
        }, config.ackTimeoutMs);
        if (!rejoinResult.ok) {
          throw new Error(`viewer rejoin failed at iteration ${index + 1}: ${JSON.stringify(rejoinResult)}`);
        }
      }

      const firstValue = values[index % values.length];
      const secondValue = values[(index + 1) % values.length];
      finalExpectedVote = secondValue;

      const voteUpdatePromise = waitForEvent(
        adminClient,
        'votes_update',
        players => players.some(player => player.name === 'Viewer' && player.vote === secondValue),
        config.ackTimeoutMs,
      );

      const firstVotePromise = emitWithAck(viewerClient, 'vote', {
        roomId,
        value: firstValue,
      }, config.ackTimeoutMs);
      await delay((index % 5) + 1);
      const secondVotePromise = emitWithAck(viewerClient, 'vote', {
        roomId,
        value: secondValue,
      }, config.ackTimeoutMs);

      const [firstVoteResult, secondVoteResult] = await Promise.all([
        firstVotePromise,
        secondVotePromise,
      ]);

      if (!firstVoteResult.ok) {
        throw new Error(`first vote failed at iteration ${index + 1}: ${JSON.stringify(firstVoteResult)}`);
      }
      if (!secondVoteResult.ok) {
        throw new Error(`second vote failed at iteration ${index + 1}: ${JSON.stringify(secondVoteResult)}`);
      }

      await voteUpdatePromise;
    }

    observerClient = await connectClient(port);
    const observerState = await emitWithAck(observerClient, 'join', {
      roomId,
      name: 'Observer',
    }, config.ackTimeoutMs);

    if (!observerState.ok) {
      throw new Error(`observer join failed: ${JSON.stringify(observerState)}`);
    }

    const viewerSnapshot = (observerState.players || []).find(player => player.name === 'Viewer');
    if (!viewerSnapshot) {
      throw new Error('viewer is missing from the final observer snapshot');
    }
    if (viewerSnapshot.vote !== finalExpectedVote) {
      throw new Error(`final vote mismatch: expected ${finalExpectedVote}, got ${viewerSnapshot.vote}`);
    }

    console.log(JSON.stringify({
      ok: true,
      roomId,
      iterations: config.iterations,
      reconnectEvery: config.reconnectEvery,
      reconnectCount,
      finalExpectedVote,
      finalObservedVote: viewerSnapshot.vote,
    }, null, 2));
  } finally {
    if (observerClient) {
      observerClient.close();
    }
    if (viewerClient) {
      viewerClient.close();
    }
    if (adminClient) {
      adminClient.close();
    }
    await stopServer();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
