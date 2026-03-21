import {
  createRoomSnapshotPayload,
  normalizeEstimationMode,
  normalizeTaskState,
} from '@contracts';

import type { RoomPendingAction, RoomSessionState, RoomSessionStore } from '../types';

function createPendingState(): Record<RoomPendingAction, boolean> {
  return {
    createRoom: false,
    join: false,
    adminStatus: false,
    noteUpdate: false,
    taskListUpdate: false,
    setEstimationMode: false,
    taskSelect: false,
    setReaction: false,
    setStoryPoints: false,
  };
}

export function createRoomSessionInitialState(
  routeRoomSlug: string,
): RoomSessionState {
  const snapshot = createRoomSnapshotPayload();

  return {
    routeRoomSlug,
    roomId: routeRoomSlug,
    room: null,
    players: snapshot.players,
    revealed: snapshot.revealed,
    note: snapshot.note,
    taskState: snapshot.taskState,
    estimationMode: snapshot.estimationMode,
    connectionStatus: 'idle',
    socketId: null,
    currentPlayerId: null,
    adminSeatAvailable: null,
    lastError: null,
    lastUserEvent: null,
    lastJoinIntent: null,
    session: {
      joined: false,
      userName: '',
      isAdmin: false,
    },
    pending: createPendingState(),
  };
}

export function createRoomSessionStore(routeRoomSlug: string): RoomSessionStore {
  const listeners = new Set<() => void>();
  let state = createRoomSessionInitialState(routeRoomSlug);

  function notify() {
    listeners.forEach((listener) => listener());
  }

  function setState(
    updater:
      | Partial<RoomSessionState>
      | ((currentState: RoomSessionState) => RoomSessionState),
  ) {
    state =
      typeof updater === 'function'
        ? updater(state)
        : { ...state, ...updater };
    notify();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState,
  };
}

export function applyRoomSnapshot(
  currentState: RoomSessionState,
  snapshot: unknown,
): RoomSessionState {
  const normalizedSnapshot = createRoomSnapshotPayload(snapshot);

  return {
    ...currentState,
    roomId: normalizedSnapshot.room?.id || currentState.roomId,
    room: normalizedSnapshot.room,
    players: normalizedSnapshot.players,
    revealed: normalizedSnapshot.revealed,
    note: normalizedSnapshot.note,
    taskState: normalizedSnapshot.taskState,
    estimationMode: normalizedSnapshot.estimationMode,
    adminSeatAvailable: normalizedSnapshot.players.length
      ? !normalizedSnapshot.players.some((player) => player.isAdmin)
      : currentState.adminSeatAvailable,
  };
}

export function applyPlayers(
  currentState: RoomSessionState,
  players: RoomSessionState['players'],
): RoomSessionState {
  return {
    ...currentState,
    players,
    adminSeatAvailable: players.length
      ? !players.some((player) => player.isAdmin)
      : currentState.adminSeatAvailable,
  };
}

export function applyReveal(
  currentState: RoomSessionState,
  revealed: unknown,
): RoomSessionState {
  return {
    ...currentState,
    revealed: Boolean(revealed),
  };
}

export function applyNote(
  currentState: RoomSessionState,
  note: unknown,
): RoomSessionState {
  return {
    ...currentState,
    note: typeof note === 'string' ? note : '',
  };
}

export function applyTaskState(
  currentState: RoomSessionState,
  taskState: unknown,
): RoomSessionState {
  return {
    ...currentState,
    taskState: normalizeTaskState(taskState),
  };
}

export function applyEstimationMode(
  currentState: RoomSessionState,
  estimationMode: unknown,
): RoomSessionState {
  return {
    ...currentState,
    estimationMode: normalizeEstimationMode(estimationMode),
  };
}
