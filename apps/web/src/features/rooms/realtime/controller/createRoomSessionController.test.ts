import { createRoomSnapshotPayload } from '@contracts';
import { describe, expect, it, vi } from 'vitest';

import type {
  RoomGatewaySubscriptionHandlers,
  RoomSocketGateway,
} from '../types';
import { createRoomSessionController } from './createRoomSessionController';

function createGatewayMock() {
  let handlers: RoomGatewaySubscriptionHandlers | null = null;

  const gateway = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn((nextHandlers: RoomGatewaySubscriptionHandlers) => {
      handlers = nextHandlers;
      return vi.fn();
    }),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    requestAdminStatus: vi.fn().mockResolvedValue(true),
    updateNote: vi.fn().mockResolvedValue(undefined),
    updateTaskList: vi.fn().mockResolvedValue(undefined),
    setEstimationMode: vi.fn().mockResolvedValue(undefined),
    selectTask: vi.fn().mockResolvedValue(undefined),
    setReaction: vi.fn().mockResolvedValue(undefined),
    setStoryPoints: vi.fn(),
    vote: vi.fn(),
    reveal: vi.fn(),
    reset: vi.fn(),
    getPlayers: vi.fn(),
  } satisfies RoomSocketGateway;

  return {
    gateway,
    emitConnect(socketId = 'socket-1') {
      handlers?.onConnect?.(socketId);
    },
    emitDisconnect(reason = 'transport close') {
      handlers?.onDisconnect?.(reason);
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createRoomSessionController', () => {
  it('captures transport failures as room session errors', async () => {
    const { gateway } = createGatewayMock();
    gateway.joinRoom.mockRejectedValueOnce(new Error('ROOM_NOT_FOUND'));

    const controller = createRoomSessionController({
      routeRoomSlug: 'alpha-room',
      gateway,
    });

    await expect(
      controller.actions.join({
        name: 'Viewer',
        isAdmin: false,
      }),
    ).rejects.toThrow('ROOM_NOT_FOUND');

    expect(controller.store.getState().pending.join).toBe(false);
    expect(controller.store.getState().lastError).toEqual(
      expect.objectContaining({
        code: 'ROOM_NOT_FOUND',
        source: 'transport',
      }),
    );
  });

  it('rejoins the previous session intent after reconnect', async () => {
    const gatewayMock = createGatewayMock();
    const { gateway } = gatewayMock;
    const joinedSnapshot = createRoomSnapshotPayload({
      room: {
        id: 'alpha-room',
        suffix: 'alpha-room',
        label: 'alpha-room',
        createdAt: null,
        joinPath: '/alpha-room/',
      },
      players: [
        {
          id: 'socket-1',
          name: 'Viewer',
          vote: null,
          reaction: null,
          isAdmin: false,
        },
      ],
      revealed: false,
      note: '',
      taskState: {
        items: [],
        selectedIndex: 0,
      },
      estimationMode: 'points',
    });
    const rejoinedSnapshot = createRoomSnapshotPayload({
      ...joinedSnapshot,
      players: [
        {
          id: 'socket-2',
          name: 'Viewer',
          vote: null,
          reaction: null,
          isAdmin: false,
        },
      ],
    });

    gateway.joinRoom
      .mockResolvedValueOnce(joinedSnapshot)
      .mockResolvedValueOnce(rejoinedSnapshot);

    const controller = createRoomSessionController({
      routeRoomSlug: 'alpha-room',
      gateway,
    });

    controller.start();
    gatewayMock.emitConnect('socket-1');
    await flushPromises();

    expect(gateway.connect).toHaveBeenCalledTimes(1);
    expect(gateway.requestAdminStatus).toHaveBeenCalledWith('alpha-room');

    await controller.actions.join({
      name: 'Viewer',
      isAdmin: false,
    });

    expect(controller.store.getState().session).toEqual({
      joined: true,
      userName: 'Viewer',
      isAdmin: false,
    });

    gatewayMock.emitDisconnect();
    gatewayMock.emitConnect('socket-2');
    await flushPromises();

    expect(gateway.joinRoom).toHaveBeenCalledTimes(2);
    expect(gateway.joinRoom).toHaveBeenLastCalledWith({
      roomId: 'alpha-room',
      name: 'Viewer',
      isAdmin: false,
    });
    expect(gateway.requestAdminStatus).toHaveBeenCalledTimes(1);
    expect(controller.store.getState().socketId).toBe('socket-2');
    expect(controller.store.getState().session.joined).toBe(true);
  });
});
