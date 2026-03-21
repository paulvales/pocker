import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RoomSessionContext } from '../RoomSessionContext';
import { createRoomSessionStore } from '../store/createRoomSessionStore';
import { useRoomSession } from './useRoomSession';

function Probe() {
  const session = useRoomSession();

  return (
    <div>
      <span data-testid="current-player">{session.currentPlayer?.name ?? 'none'}</span>
      <span data-testid="current-player-id">{session.currentPlayer?.id ?? 'none'}</span>
    </div>
  );
}

describe('useRoomSession', () => {
  it('resolves currentPlayer by currentPlayerId when player ids do not match socket id', () => {
    const store = createRoomSessionStore('alpha-room');

    store.setState((currentState) => ({
      ...currentState,
      socketId: 'socket-1',
      currentPlayerId: 'session-42',
      session: {
        joined: true,
        userName: 'Alice',
        isAdmin: true,
      },
      players: [
        {
          id: 'session-42',
          name: 'Alice',
          vote: null,
          reaction: null,
          isAdmin: true,
        },
      ],
    }));

    render(
      <RoomSessionContext.Provider
        value={{
          store,
          actions: {
            connect: vi.fn(),
            disconnect: vi.fn(),
            resetSession: vi.fn(),
            createRoom: vi.fn(),
            join: vi.fn(),
            refreshAdminSeat: vi.fn(),
            updateNote: vi.fn(),
            updateTaskList: vi.fn(),
            setEstimationMode: vi.fn(),
            selectTask: vi.fn(),
            setReaction: vi.fn(),
            setStoryPoints: vi.fn(),
            vote: vi.fn(),
            reveal: vi.fn(),
            reset: vi.fn(),
          },
        }}
      >
        <Probe />
      </RoomSessionContext.Provider>,
    );

    expect(screen.getByTestId('current-player')).toHaveTextContent('Alice');
    expect(screen.getByTestId('current-player-id')).toHaveTextContent('session-42');
  });
});
