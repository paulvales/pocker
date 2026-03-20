import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoomPage } from './RoomPage';

const mockSession = {
  room: { id: 'alpha-room' },
  selectedTask: 'APP-26',
  connectionStatus: 'connected',
  currentPlayer: { id: 'socket-1', name: 'Alice', vote: '5', reaction: '👍', isAdmin: true },
  players: [
    { id: 'socket-1', name: 'Alice', vote: '5', reaction: '👍', isAdmin: true },
    { id: 'socket-2', name: 'Bob', vote: '8', reaction: null, isAdmin: false },
  ],
  revealed: false,
  note: 'https://tracker.example/APP-26',
  socketId: 'socket-1',
  adminPlayer: { id: 'socket-1', name: 'Alice', vote: '5', reaction: '👍', isAdmin: true },
  adminSeatAvailable: true,
  estimationMode: 'points',
  taskState: {
    items: ['APP-26', 'APP-27'],
    selectedIndex: 0,
  },
  session: {
    joined: false,
    isAdmin: false,
    userName: 'Alice',
  },
  pending: {
    join: false,
    createRoom: false,
    taskSelect: false,
    taskListUpdate: false,
    setReaction: false,
  },
  actions: {
    createRoom: vi.fn(),
    join: vi.fn(),
    resetSession: vi.fn(),
    updateTaskList: vi.fn(),
    setReaction: vi.fn(),
    selectTask: vi.fn(),
    updateNote: vi.fn(),
    reveal: vi.fn(),
    reset: vi.fn(),
    setEstimationMode: vi.fn(),
    vote: vi.fn(),
  },
};

vi.mock('@/features/rooms/realtime', () => ({
  RoomSessionProvider: ({ children }: { children: ReactNode }) => children,
  useRoomSession: () => mockSession,
}));

vi.mock('@/features/voting/hooks/useVotingBoard', () => ({
  useVotingBoard: () => ({
    averageValue: '7',
    currentVote: '5',
    canVote: true,
    orderedPlayers: mockSession.players,
    voteValues: ['1', '2', '3', '5', '8', '13', '20', '40', '?'],
  }),
}));

describe('RoomPage', () => {
  beforeEach(() => {
    Object.assign(mockSession.session, {
      joined: false,
      isAdmin: false,
    });
  });

  it('renders legacy join controls for a room slug route', () => {
    render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Скрум Покер Онлине')).toBeInTheDocument();
    expect(screen.getByLabelText('Ссылка комнаты')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Я админ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
  });

  it('renders legacy in-room admin controls after join', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: true,
    });

    render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Показать' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить список' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'История' })).toBeInTheDocument();
  });
});
