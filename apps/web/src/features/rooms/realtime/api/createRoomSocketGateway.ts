import {
  createRoomSnapshotPayload,
  createSocketAckError,
  normalizeEstimationMode,
  normalizeTaskState,
  SOCKET_EVENT_NAMES,
} from '@contracts';
import { io } from 'socket.io-client';

import type {
  CreateRoomInput,
  JoinedRoomSnapshot,
  JoinRoomInput,
  RoomGatewaySubscriptionHandlers,
  RoomSocketGateway,
  SelectTaskInput,
  SetEstimationModeInput,
  SetReactionInput,
  SetStoryPointsResult,
  UpdateNoteInput,
  UpdateTaskListInput,
} from '../types';

type SocketAckSuccess<TPayload> = { ok: true } & TPayload;
type SocketAckFailure = { ok: false; error: string };
type SocketAck<TPayload> = SocketAckSuccess<TPayload> | SocketAckFailure;

const SOCKET_CLIENT_EVENTS = SOCKET_EVENT_NAMES.client;
const SOCKET_SERVER_EVENTS = SOCKET_EVENT_NAMES.server;
const DEFAULT_ACK_TIMEOUT_MS = 3000;

function normalizeServerOrigin(serverOrigin: string | undefined): string | undefined {
  const normalized = String(serverOrigin || '').trim();
  return normalized || undefined;
}

function createTransportError(code: string): Error {
  return new Error(code);
}

function assertSocketAck<TPayload>(result: SocketAck<TPayload>): SocketAckSuccess<TPayload> {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result;
}

function normalizePlayersPayload(payload: unknown) {
  return createRoomSnapshotPayload({ players: payload }).players;
}

function normalizeTextPayload(payload: unknown): string {
  return typeof payload === 'string' ? payload : '';
}

type CreateRoomSocketGatewayOptions = {
  ackTimeoutMs?: number;
  serverOrigin?: string;
};

export function createRoomSocketGateway(
  options: CreateRoomSocketGatewayOptions = {},
): RoomSocketGateway {
  const ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  const socket = io(normalizeServerOrigin(options.serverOrigin), {
    autoConnect: false,
    path: '/socket.io',
  });

  function connect() {
    if (!socket.connected) {
      socket.connect();
    }
  }

  function disconnect() {
    socket.disconnect();
  }

  function emitWithAck<TResponse>(
    eventName: string,
    payload: unknown,
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let connectHandler: (() => void) | null = null;

      const finish = (callback: () => void) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        if (connectHandler) {
          socket.off('connect', connectHandler);
          connectHandler = null;
        }
        callback();
      };

      const emitRequest = () => {
        socket.emit(eventName, payload, (result: TResponse) => {
          finish(() => resolve(result));
        });
      };

      timer = setTimeout(() => {
        finish(() => {
          reject(
            createTransportError(
              socket.connected ? 'ACK_TIMEOUT' : 'SOCKET_DISCONNECTED',
            ),
          );
        });
      }, ackTimeoutMs);

      if (socket.connected) {
        emitRequest();
        return;
      }

      connectHandler = emitRequest;
      socket.once('connect', connectHandler);
      connect();
    });
  }

  function subscribe(handlers: RoomGatewaySubscriptionHandlers) {
    const connectListener = () => {
      handlers.onConnect?.(socket.id || '');
    };
    const disconnectListener = (reason: string) => {
      handlers.onDisconnect?.(reason);
    };
    const connectErrorListener = (error: Error) => {
      handlers.onConnectError?.(
        error.message || createSocketAckError(error).error,
      );
    };
    const playersUpdateListener = (players: unknown) => {
      handlers.onPlayersUpdate?.(normalizePlayersPayload(players));
    };
    const votesUpdateListener = (players: unknown) => {
      handlers.onVotesUpdate?.(normalizePlayersPayload(players));
    };
    const reactionsUpdateListener = (players: unknown) => {
      handlers.onReactionsUpdate?.(normalizePlayersPayload(players));
    };
    const revealUpdateListener = (revealed: unknown) => {
      handlers.onRevealUpdate?.(Boolean(revealed));
    };
    const noteUpdateListener = (note: unknown) => {
      handlers.onNoteUpdate?.(normalizeTextPayload(note));
    };
    const taskStateUpdateListener = (taskState: unknown) => {
      handlers.onTaskStateUpdate?.(normalizeTaskState(taskState));
    };
    const estimationModeUpdateListener = (mode: unknown) => {
      handlers.onEstimationModeUpdate?.(normalizeEstimationMode(mode));
    };
    const userEventListener = (event: unknown) => {
      const normalizedEvent =
        event && typeof event === 'object' && !Array.isArray(event)
          ? (event as Record<string, unknown>)
          : {};
      const nextMessage =
        typeof normalizedEvent.message === 'string'
          ? normalizedEvent.message
          : '';
      const nextType =
        typeof normalizedEvent.type === 'string'
          ? normalizedEvent.type
          : 'info';

      handlers.onUserEvent?.({
        message: nextMessage,
        type: nextType,
      });
    };

    socket.on('connect', connectListener);
    socket.on('disconnect', disconnectListener);
    socket.on('connect_error', connectErrorListener);
    socket.on(SOCKET_SERVER_EVENTS.playersUpdate, playersUpdateListener);
    socket.on(SOCKET_SERVER_EVENTS.votesUpdate, votesUpdateListener);
    socket.on(SOCKET_SERVER_EVENTS.reactionsUpdate, reactionsUpdateListener);
    socket.on(SOCKET_SERVER_EVENTS.revealUpdate, revealUpdateListener);
    socket.on(SOCKET_SERVER_EVENTS.noteUpdate, noteUpdateListener);
    socket.on(SOCKET_SERVER_EVENTS.taskStateUpdate, taskStateUpdateListener);
    socket.on(
      SOCKET_SERVER_EVENTS.estimationModeUpdate,
      estimationModeUpdateListener,
    );
    socket.on(SOCKET_SERVER_EVENTS.userEvent, userEventListener);

    return () => {
      socket.off('connect', connectListener);
      socket.off('disconnect', disconnectListener);
      socket.off('connect_error', connectErrorListener);
      socket.off(SOCKET_SERVER_EVENTS.playersUpdate, playersUpdateListener);
      socket.off(SOCKET_SERVER_EVENTS.votesUpdate, votesUpdateListener);
      socket.off(SOCKET_SERVER_EVENTS.reactionsUpdate, reactionsUpdateListener);
      socket.off(SOCKET_SERVER_EVENTS.revealUpdate, revealUpdateListener);
      socket.off(SOCKET_SERVER_EVENTS.noteUpdate, noteUpdateListener);
      socket.off(SOCKET_SERVER_EVENTS.taskStateUpdate, taskStateUpdateListener);
      socket.off(
        SOCKET_SERVER_EVENTS.estimationModeUpdate,
        estimationModeUpdateListener,
      );
      socket.off(SOCKET_SERVER_EVENTS.userEvent, userEventListener);
    };
  }

  async function createRoom(input: CreateRoomInput) {
    const result = await emitWithAck<SocketAck<{ room: unknown }>>(
      SOCKET_CLIENT_EVENTS.createRoom,
      input,
    );

    return createRoomSnapshotPayload({
      room: assertSocketAck(result).room,
    }).room!;
  }

  async function joinRoom(input: JoinRoomInput) {
    const result = await emitWithAck<SocketAck<Record<string, unknown>>>(
      SOCKET_CLIENT_EVENTS.join,
      input,
    );

    const payload = assertSocketAck(result);
    const snapshot = createRoomSnapshotPayload(payload);

    return {
      ...snapshot,
      currentPlayerId:
        typeof payload.currentPlayerId === 'string' ? payload.currentPlayerId : null,
    } satisfies JoinedRoomSnapshot;
  }

  function requestAdminStatus(roomId: string) {
    return emitWithAck<boolean>(SOCKET_CLIENT_EVENTS.requestAdminStatus, roomId);
  }

  async function updateNote(input: UpdateNoteInput) {
    const result = await emitWithAck<SocketAck<Record<string, never>>>(
      SOCKET_CLIENT_EVENTS.noteUpdate,
      input,
    );
    assertSocketAck(result);
  }

  async function updateTaskList(input: UpdateTaskListInput) {
    const result = await emitWithAck<SocketAck<Record<string, unknown>>>(
      SOCKET_CLIENT_EVENTS.taskListUpdate,
      input,
    );
    assertSocketAck(result);
  }

  async function setEstimationMode(input: SetEstimationModeInput) {
    const result = await emitWithAck<SocketAck<Record<string, unknown>>>(
      SOCKET_CLIENT_EVENTS.setEstimationMode,
      input,
    );
    assertSocketAck(result);
  }

  async function selectTask(input: SelectTaskInput) {
    const result = await emitWithAck<SocketAck<Record<string, unknown>>>(
      SOCKET_CLIENT_EVENTS.taskSelect,
      input,
    );
    assertSocketAck(result);
  }

  async function setReaction(input: SetReactionInput) {
    const result = await emitWithAck<SocketAck<Record<string, unknown>>>(
      SOCKET_CLIENT_EVENTS.setReaction,
      input,
    );
    assertSocketAck(result);
  }

  async function setStoryPoints(roomId: string) {
    const result = await emitWithAck<SocketAck<SetStoryPointsResult>>(
      SOCKET_CLIENT_EVENTS.setStoryPoints,
      { roomId },
    );

    return assertSocketAck(result);
  }

  function vote(roomId: string, value: string | null) {
    connect();
    socket.emit(SOCKET_CLIENT_EVENTS.vote, { roomId, value });
  }

  function reveal(roomId: string) {
    connect();
    socket.emit(SOCKET_CLIENT_EVENTS.reveal, roomId);
  }

  function reset(roomId: string) {
    connect();
    socket.emit(SOCKET_CLIENT_EVENTS.reset, roomId);
  }

  function getPlayers(roomId: string) {
    connect();
    socket.emit(SOCKET_CLIENT_EVENTS.getPlayers, roomId);
  }

  return {
    connect,
    disconnect,
    subscribe,
    createRoom,
    joinRoom,
    requestAdminStatus,
    updateNote,
    updateTaskList,
    setEstimationMode,
    selectTask,
    setReaction,
    setStoryPoints,
    vote,
    reveal,
    reset,
    getPlayers,
  };
}
