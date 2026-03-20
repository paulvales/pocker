import {
  applyEstimationMode,
  applyNote,
  applyPlayers,
  applyReveal,
  applyRoomSnapshot,
  applyTaskState,
  createRoomSessionInitialState,
  createRoomSessionStore,
} from '../store/createRoomSessionStore';
import type {
  RoomPendingAction,
  RoomSessionActions,
  RoomSessionError,
  RoomSessionState,
  RoomSessionStore,
  RoomSocketGateway,
} from '../types';

type CreateRoomSessionControllerOptions = {
  routeRoomSlug: string;
  gateway: RoomSocketGateway;
  store?: RoomSessionStore;
};

const ERROR_MESSAGES: Record<string, string> = {
  ACK_TIMEOUT: 'Realtime request timed out before the server acknowledged it.',
  SOCKET_DISCONNECTED: 'Realtime connection is not available right now.',
  ROOM_NOT_FOUND: 'The requested room could not be found.',
  ADMIN_ALREADY_EXISTS: 'This room already has an active admin.',
  NAME_REQUIRED: 'A participant name is required before joining.',
  FORBIDDEN: 'This action is not allowed for the current room role.',
  TASK_LIST_EMPTY: 'The room does not have any tasks to navigate yet.',
  REACTION_INVALID: 'This reaction is not allowed by the server.',
  NO_VOTES: 'There are no votes to aggregate yet.',
  ISSUE_NOT_FOUND_IN_NOTE: 'The current note does not contain a trackable issue id.',
  YOUTRACK_NOT_CONFIGURED: 'YouTrack integration is not configured on the server.',
  RATE_LIMITED: 'Too many requests were sent too quickly. Wait a moment and try again.',
};

function createRoomSessionError(
  code: string,
  source: RoomSessionError['source'],
): RoomSessionError {
  return {
    code,
    source,
    message: ERROR_MESSAGES[code] || code,
    at: Date.now(),
  };
}

function setPendingAction(
  store: RoomSessionStore,
  action: RoomPendingAction,
  value: boolean,
) {
  store.setState((currentState) => ({
    ...currentState,
    pending: {
      ...currentState.pending,
      [action]: value,
    },
  }));
}

function setLastError(
  store: RoomSessionStore,
  code: string,
  source: RoomSessionError['source'],
) {
  store.setState((currentState) => ({
    ...currentState,
    lastError: createRoomSessionError(code, source),
  }));
}

function clearLastError(store: RoomSessionStore) {
  store.setState((currentState) => ({
    ...currentState,
    lastError: null,
  }));
}

function getActiveRoomId(state: RoomSessionState): string {
  return state.roomId || state.routeRoomSlug;
}

export function createRoomSessionController(
  options: CreateRoomSessionControllerOptions,
): {
  actions: RoomSessionActions;
  start: () => void;
  stop: () => void;
  store: RoomSessionStore;
} {
  const store = options.store ?? createRoomSessionStore(options.routeRoomSlug);
  const gateway = options.gateway;
  let unsubscribeGateway: (() => void) | null = null;
  let started = false;
  let reconnectJoinInFlight = false;

  function connect() {
    store.setState((currentState) => ({
      ...currentState,
      connectionStatus:
        currentState.connectionStatus === 'connected' ? 'connected' : 'connecting',
    }));
    gateway.connect();
  }

  function disconnect() {
    gateway.disconnect();
    store.setState((currentState) => ({
      ...currentState,
      connectionStatus: 'disconnected',
      session: {
        ...currentState.session,
        joined: false,
      },
    }));
  }

  function resetSession() {
    gateway.disconnect();
    const routeRoomSlug = store.getState().routeRoomSlug;
    store.setState((currentState) => ({
      ...createRoomSessionInitialState(routeRoomSlug),
      routeRoomSlug,
      roomId: routeRoomSlug,
      room: currentState.room,
    }));
  }

  async function createRoom(roomSuffix: string) {
    setPendingAction(store, 'createRoom', true);
    clearLastError(store);

    try {
      const room = await gateway.createRoom({ roomSuffix });
      store.setState((currentState) => ({
        ...currentState,
        roomId: room.id,
        room,
        adminSeatAvailable: true,
      }));
      return room;
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'createRoom', false);
    }
  }

  async function join(input: {
    name: string;
    isAdmin: boolean;
    roomId?: string;
  }) {
    setPendingAction(store, 'join', true);
    clearLastError(store);

    const roomId = input.roomId || getActiveRoomId(store.getState());

    try {
      const snapshot = await gateway.joinRoom({
        roomId,
        name: input.name,
        isAdmin: input.isAdmin,
      });

      store.setState((currentState) => ({
        ...applyRoomSnapshot(currentState, snapshot),
        lastJoinIntent: {
          roomId,
          name: input.name,
          isAdmin: input.isAdmin,
        },
        session: {
          joined: true,
          userName: input.name,
          isAdmin: input.isAdmin,
        },
      }));

      return snapshot;
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'join', false);
    }
  }

  async function refreshAdminSeat() {
    setPendingAction(store, 'adminStatus', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      const adminSeatAvailable = await gateway.requestAdminStatus(roomId);

      store.setState((currentState) => ({
        ...currentState,
        adminSeatAvailable,
      }));

      return adminSeatAvailable;
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'adminStatus', false);
    }
  }

  async function updateNote(note: string) {
    setPendingAction(store, 'noteUpdate', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      await gateway.updateNote({ roomId, note });
      store.setState((currentState) => applyNote(currentState, note));
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'noteUpdate', false);
    }
  }

  async function updateTaskList(items: string[]) {
    setPendingAction(store, 'taskListUpdate', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      await gateway.updateTaskList({ roomId, items });
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'taskListUpdate', false);
    }
  }

  async function setEstimationMode(mode: RoomSessionState['estimationMode']) {
    setPendingAction(store, 'setEstimationMode', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      await gateway.setEstimationMode({ roomId, mode });
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'setEstimationMode', false);
    }
  }

  async function selectTask(direction: -1 | 1) {
    setPendingAction(store, 'taskSelect', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      await gateway.selectTask({ roomId, direction });
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'taskSelect', false);
    }
  }

  async function setReaction(value: string | null) {
    setPendingAction(store, 'setReaction', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      await gateway.setReaction({ roomId, value });
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'setReaction', false);
    }
  }

  async function setStoryPoints() {
    setPendingAction(store, 'setStoryPoints', true);
    clearLastError(store);

    try {
      const roomId = getActiveRoomId(store.getState());
      return await gateway.setStoryPoints(roomId);
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
      throw error;
    } finally {
      setPendingAction(store, 'setStoryPoints', false);
    }
  }

  function vote(value: string | null) {
    const roomId = getActiveRoomId(store.getState());
    gateway.vote(roomId, value);
  }

  function reveal() {
    const roomId = getActiveRoomId(store.getState());
    gateway.reveal(roomId);
  }

  function reset() {
    const roomId = getActiveRoomId(store.getState());
    gateway.reset(roomId);
  }

  async function resumeJoinIntent() {
    const state = store.getState();
    const joinIntent = state.lastJoinIntent;

    if (!joinIntent || reconnectJoinInFlight) {
      return;
    }

    reconnectJoinInFlight = true;

    try {
      const snapshot = await gateway.joinRoom(joinIntent);
      store.setState((currentState) => ({
        ...applyRoomSnapshot(currentState, snapshot),
        session: {
          ...currentState.session,
          joined: true,
          userName: joinIntent.name,
          isAdmin: joinIntent.isAdmin,
        },
      }));
    } catch (error) {
      setLastError(
        store,
        error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        'transport',
      );
    } finally {
      reconnectJoinInFlight = false;
    }
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    unsubscribeGateway = gateway.subscribe({
      onConnect(socketId) {
        store.setState((currentState) => ({
          ...currentState,
          connectionStatus: 'connected',
          socketId,
          lastError: null,
        }));

        if (store.getState().lastJoinIntent) {
          void resumeJoinIntent();
          return;
        }

        void refreshAdminSeat().catch(() => {});
      },
      onDisconnect() {
        store.setState((currentState) => ({
          ...currentState,
          connectionStatus: 'disconnected',
          session: {
            ...currentState.session,
            joined: false,
          },
        }));
      },
      onConnectError(message) {
        store.setState((currentState) => ({
          ...currentState,
          connectionStatus: 'error',
          lastError: createRoomSessionError(
            message || 'SOCKET_DISCONNECTED',
            'transport',
          ),
        }));
      },
      onPlayersUpdate(players) {
        store.setState((currentState) => applyPlayers(currentState, players));
      },
      onVotesUpdate(players) {
        store.setState((currentState) => applyPlayers(currentState, players));
      },
      onReactionsUpdate(players) {
        store.setState((currentState) => applyPlayers(currentState, players));
      },
      onRevealUpdate(revealed) {
        store.setState((currentState) => applyReveal(currentState, revealed));
        if (!revealed) {
          gateway.getPlayers(getActiveRoomId(store.getState()));
        }
      },
      onNoteUpdate(note) {
        store.setState((currentState) => applyNote(currentState, note));
      },
      onTaskStateUpdate(taskState) {
        store.setState((currentState) => applyTaskState(currentState, taskState));
      },
      onEstimationModeUpdate(mode) {
        store.setState((currentState) => applyEstimationMode(currentState, mode));
        if (store.getState().session.joined) {
          gateway.getPlayers(getActiveRoomId(store.getState()));
        }
      },
      onUserEvent(event) {
        store.setState((currentState) => ({
          ...currentState,
          lastUserEvent: {
            message: event.message,
            type: event.type,
            receivedAt: Date.now(),
          },
        }));
      },
    });

    store.setState((currentState) => ({
      ...currentState,
      roomId: currentState.routeRoomSlug || currentState.roomId,
    }));
    connect();
  }

  function stop() {
    if (!started) {
      return;
    }

    unsubscribeGateway?.();
    unsubscribeGateway = null;
    gateway.disconnect();
    started = false;
  }

  const actions: RoomSessionActions = {
    connect,
    disconnect,
    resetSession,
    createRoom,
    join,
    refreshAdminSeat,
    updateNote,
    updateTaskList,
    setEstimationMode,
    selectTask,
    setReaction,
    setStoryPoints,
    vote,
    reveal,
    reset,
  };

  return {
    actions,
    start,
    stop,
    store,
  };
}
