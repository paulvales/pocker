import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  writeStoredAdminIntent,
  writeStoredAutoJoinIntent,
  writeStoredPlayerName,
} from '@/features/rooms/model/sessionPersistence';

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
  lastError: null,
  lastUserEvent: null,
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

const toastMock = vi.fn();

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
    const jqueryMock = Object.assign(vi.fn(() => ({ toast: toastMock })), {
      toast: toastMock,
    });

    vi.stubGlobal('$', jqueryMock);
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
    Object.assign(mockSession.session, {
      joined: false,
      isAdmin: false,
      userName: 'Alice',
    });
    mockSession.selectedTask = 'APP-26';
    mockSession.revealed = false;
    mockSession.estimationMode = 'points';
    mockSession.lastError = null;
    mockSession.lastUserEvent = null;
    mockSession.currentPlayer = {
      id: 'socket-1',
      name: 'Alice',
      vote: '5',
      reaction: '👍',
      isAdmin: true,
    };
    mockSession.adminPlayer = {
      id: 'socket-1',
      name: 'Alice',
      vote: '5',
      reaction: '👍',
      isAdmin: true,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not auto-join from a saved player name without an explicit room rejoin intent', () => {
    writeStoredPlayerName('Alice');
    writeStoredAdminIntent('alpha-room', true);

    const { container } = render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mockSession.actions.join).not.toHaveBeenCalled();
    expect(container.querySelector('#playerName')).toHaveValue('Alice');
  });

  it('auto-joins only when a room rejoin intent exists for the current slug', () => {
    writeStoredPlayerName('Alice');
    writeStoredAdminIntent('alpha-room', true);
    writeStoredAutoJoinIntent('alpha-room');

    render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mockSession.actions.join).toHaveBeenCalledWith({
      name: 'Alice',
      isAdmin: true,
      roomId: 'alpha-room',
    });
  });

  it('renders legacy join controls for a room slug route', () => {
    const { container } = render(
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
    expect(container.querySelector('#voteButtons')).not.toBeInTheDocument();
  });

  it('renders legacy in-room admin controls after join', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: true,
    });

    const { container } = render(
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
    expect(container.querySelector('#topControls')).toHaveStyle('display: flex');
    expect(container.querySelector('#taskSidebar')).toHaveStyle('display: block');
    expect(container.querySelector('#taskPickerSection')).toHaveStyle('display: block');
  });

  it('shows admin controls when the current player is admin even if the session flag is stale', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: false,
      userName: 'Alice',
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(container.querySelector('#revealBtn')).toBeInTheDocument();
    expect(container.querySelector('#resetBtn')).toBeInTheDocument();
    expect(container.querySelector('#modePointsBtn')).toBeInTheDocument();
    expect(container.querySelector('#modeHoursBtn')).toBeInTheDocument();
    expect(container.querySelector('#topControls')).toHaveStyle('display: flex');
  });

  it('keeps the visible average hidden until reveal while preserving the hidden value', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: false,
      userName: 'Bob',
    });
    mockSession.currentPlayer = {
      id: 'socket-2',
      name: 'Bob',
      vote: '8',
      reaction: null,
      isAdmin: false,
    };

    const { container } = render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(container.querySelector('#averageVote1')).toHaveValue('7');
    expect(container.querySelector('#averageVote .value')).toHaveTextContent('?');
  });

  it('shows room event toasts for joined participants', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: true,
    });
    mockSession.lastUserEvent = {
      message: 'Bob joined',
      type: 'success',
      receivedAt: Date.now(),
    };

    render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    return waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          class: 'success',
          displayTime: 4200,
          message: 'Bob joined',
          position: 'top right',
          showProgress: 'bottom',
        }),
      );
    });
  });

  it('shows error toasts for useful realtime failures', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: true,
    });
    mockSession.lastError = {
      code: 'ADMIN_ALREADY_EXISTS',
      message: 'This room already has an active admin.',
      source: 'transport',
      at: Date.now(),
    };

    render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    return waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          class: 'error',
          displayTime: 6200,
          message: 'This room already has an active admin.',
          position: 'top right',
          showProgress: 'bottom',
        }),
      );
    });
  });

  it('hides estimation mode buttons from participants and opens the current task in a new tab', () => {
    Object.assign(mockSession.session, {
      joined: true,
      isAdmin: false,
      userName: 'Bob',
    });
    mockSession.currentPlayer = {
      id: 'socket-2',
      name: 'Bob',
      vote: '8',
      reaction: null,
      isAdmin: false,
    };
    mockSession.selectedTask = 'https://tracker.example/APP-26';

    const { container } = render(
      <MemoryRouter initialEntries={['/alpha-room']}>
        <Routes>
          <Route path="/:roomSlug" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Поинты' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Часы' })).not.toBeInTheDocument();
    expect(screen.getByText('Оцениваем:')).toBeInTheDocument();

    const taskLink = container.querySelector('#viewerTaskLink');

    expect(taskLink).toHaveAttribute('href', 'https://tracker.example/APP-26');
    expect(taskLink).toHaveAttribute('target', '_blank');
    expect(container.querySelector('#viewerTaskValue')).toHaveTextContent('APP-26');
  });
});
