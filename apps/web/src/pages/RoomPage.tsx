import type { ReactNode } from 'react';
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AVAILABLE_REACTIONS } from '@/features/reactions/model/reactionCatalog';
import {
  buildRoomLink,
  buildRoomPath,
  isValidRoomSlug,
  normalizeRoomSlug,
} from '@/features/rooms/model/roomRoute';
import {
  clearStoredAdminIntent,
  clearStoredCreateRoomIntent,
  clearStoredPlayerName,
  readStoredAdminIntent,
  readStoredCreateRoomIntent,
  readStoredPlayerName,
  writeStoredAdminIntent,
  writeStoredPlayerName,
} from '@/features/rooms/model/sessionPersistence';
import { RoomSessionProvider, useRoomSession } from '@/features/rooms/realtime';
import { getTaskHref, getTaskLabel, parseTaskListInput } from '@/features/tasks/model/taskList';
import { useVotingBoard } from '@/features/voting/hooks/useVotingBoard';
import { clearStoredVote } from '@/features/voting/model/votePersistence';
import { getVisibleVoteValue } from '@/features/voting/model/voteScale';
import { readAppVersionLabel } from '@/shared/appVersion';

const INVALID_SLUG_MESSAGE =
  'Используйте только буквы, цифры, дефис или underscore. Служебные маршруты запрещены.';
const DEFAULT_ROOM_STATUS_TEXT =
  'Комната готова. Можно входить самому и приглашать участников по ссылке.';
const ROOM_LINK_HELP_TEXT = 'Скопируйте ссылку и отправьте её команде.';
const TASK_WHEEL_ITEM_HEIGHT = 40;
const GRADIENT_CLASSES = [
  'gradient-1',
  'gradient-2',
  'gradient-3',
  'gradient-4',
  'gradient-5',
] as const;

export function RoomPage() {
  const { roomSlug } = useParams();

  return (
    <RoomSessionProvider roomSlug={roomSlug || ''}>
      <RoomPageContent key={roomSlug || ''} roomSlug={roomSlug || ''} />
    </RoomSessionProvider>
  );
}

type RoomPageContentProps = {
  roomSlug: string;
};

function RoomPageContent({ roomSlug }: RoomPageContentProps) {
  const navigate = useNavigate();
  const session = useRoomSession();
  const normalizedRoomSlug = useMemo(() => normalizeRoomSlug(roomSlug), [roomSlug]);
  const roomSlugIsValid = useMemo(() => isValidRoomSlug(roomSlug), [roomSlug]);
  const hasRouteRoom = Boolean(normalizedRoomSlug);
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [wantsAdmin, setWantsAdmin] = useState(() => readStoredAdminIntent(normalizedRoomSlug));
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [taskListModalOpen, setTaskListModalOpen] = useState(false);
  const [taskListDraft, setTaskListDraft] = useState('');
  const [createIntentSlug, setCreateIntentSlug] = useState(() => readStoredCreateRoomIntent());
  const autoJoinAttemptedRef = useRef('');
  const createIntentAttemptedRef = useRef('');
  const adminNoteTimerRef = useRef<number | null>(null);
  const reactionDockRef = useRef<HTMLDivElement | null>(null);
  const activeRoomSlug = session.room?.id || normalizedRoomSlug;
  const shareLink = activeRoomSlug ? buildRoomLink(activeRoomSlug) : '';
  const selectedTask = session.selectedTask;
  const selectedTaskLabel = selectedTask ? getTaskLabel(selectedTask) : '-';
  const selectedTaskHref = selectedTask ? getTaskHref(selectedTask) : null;
  const versionLabel = readAppVersionLabel();
  const votingBoard = useVotingBoard({
    connectionStatus: session.connectionStatus,
    currentPlayer: session.currentPlayer,
    estimationMode: session.estimationMode,
    players: session.players,
    revealed: session.revealed,
    roomId: activeRoomSlug,
    userName: session.session.userName,
    vote: session.actions.vote,
  });
  const taskWheelTransform = `translateY(-${session.taskState.selectedIndex * TASK_WHEEL_ITEM_HEIGHT}px)`;
  const hasViewerTask = Boolean(!session.session.isAdmin && selectedTask);
  const showAverageVote = session.session.joined;
  const averageVoteValue = session.revealed
    ? votingBoard.averageValue
    : session.players.some((player) => player.vote)
      ? votingBoard.averageValue
      : '0';

  useEffect(() => {
    document.title = 'Scrum Poker';
    document.body.classList.add('legacy-room-body');
    return () => {
      document.body.classList.remove('legacy-room-body');
    };
  }, []);

  useEffect(() => {
    if (roomSlug && normalizedRoomSlug && roomSlug !== normalizedRoomSlug) {
      startTransition(() => {
        void navigate(buildRoomPath(normalizedRoomSlug), { replace: true });
      });
    }
  }, [navigate, normalizedRoomSlug, roomSlug]);

  useEffect(() => () => {
    if (adminNoteTimerRef.current) {
      window.clearTimeout(adminNoteTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!reactionPickerOpen) {
      return;
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!reactionDockRef.current?.contains(event.target as Node)) {
        setReactionPickerOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setReactionPickerOpen(false);
      }
    }

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [reactionPickerOpen]);

  const runCreateIntent = useEffectEvent(async () => {
    const savedName = readStoredPlayerName().trim();
    if (!savedName || !normalizedRoomSlug) {
      setCreateIntentSlug('');
      clearStoredCreateRoomIntent();
      return;
    }

    createIntentAttemptedRef.current = normalizedRoomSlug;

    try {
      await session.actions.createRoom(normalizedRoomSlug);
      await session.actions.join({
        name: savedName,
        isAdmin: true,
        roomId: normalizedRoomSlug,
      });
      clearStoredCreateRoomIntent();
      setCreateIntentSlug('');
    } catch {
      clearStoredCreateRoomIntent();
      setCreateIntentSlug('');
      createIntentAttemptedRef.current = `${normalizedRoomSlug}:failed`;
    }
  });

  const runAutoJoin = useEffectEvent(async () => {
    const savedName = readStoredPlayerName().trim();
    if (!savedName || !normalizedRoomSlug) {
      return;
    }

    autoJoinAttemptedRef.current = normalizedRoomSlug;

    try {
      await session.actions.join({
        name: savedName,
        isAdmin: readStoredAdminIntent(normalizedRoomSlug),
        roomId: normalizedRoomSlug,
      });
    } catch {
      autoJoinAttemptedRef.current = `${normalizedRoomSlug}:failed`;
    }
  });

  useEffect(() => {
    if (!hasRouteRoom || !roomSlugIsValid) {
      return;
    }
    if (session.session.joined) {
      return;
    }
    if (session.connectionStatus !== 'connected') {
      return;
    }

    if (
      createIntentSlug === normalizedRoomSlug
      && createIntentAttemptedRef.current !== normalizedRoomSlug
    ) {
      void runCreateIntent();
      return;
    }

    if (autoJoinAttemptedRef.current.startsWith(normalizedRoomSlug)) {
      return;
    }
    if (!readStoredPlayerName().trim()) {
      return;
    }

    void runAutoJoin();
  }, [
    createIntentSlug,
    hasRouteRoom,
    normalizedRoomSlug,
    roomSlugIsValid,
    session.connectionStatus,
    session.session.joined,
  ]);

  function persistIdentity(nextName: string, nextIsAdmin: boolean) {
    writeStoredPlayerName(nextName);
    if (normalizedRoomSlug) {
      writeStoredAdminIntent(normalizedRoomSlug, nextIsAdmin);
    }
  }

  async function handleJoin() {
    const trimmedName = playerName.trim();
    if (!trimmedName || !hasRouteRoom || !roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }

    persistIdentity(trimmedName, wantsAdmin);

    try {
      await session.actions.join({
        name: trimmedName,
        isAdmin: wantsAdmin,
        roomId: normalizedRoomSlug,
      });
    } catch {
      // session store already contains the normalized error
    }
  }

  async function handleCopyLink() {
    if (!shareLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareLink);
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
  }

  function handleChangeIdentity() {
    clearStoredPlayerName();
    clearStoredAdminIntent(activeRoomSlug);
    clearStoredCreateRoomIntent();
    clearStoredVote(activeRoomSlug, session.session.userName);
    session.actions.resetSession();
    setPlayerName('');
    setWantsAdmin(false);
    setCopyState('idle');
    setReactionPickerOpen(false);
    setTaskListModalOpen(false);
  }

  async function handleTaskListSave() {
    try {
      await session.actions.updateTaskList(parseTaskListInput(taskListDraft));
      setTaskListModalOpen(false);
    } catch {
      // session store already contains the normalized error
    }
  }

  async function handleReactionSelect(value: string | null) {
    try {
      await session.actions.setReaction(value);
      setReactionPickerOpen(false);
    } catch {
      // session store already contains the normalized error
    }
  }

  async function handleSelectTask(direction: -1 | 1) {
    try {
      await session.actions.selectTask(direction);
    } catch {
      // session store already contains the normalized error
    }
  }

  function openHistoryPage() {
    startTransition(() => {
      void navigate('/history');
    });
  }

  function handleAdminNoteInput(nextValue: string) {
    if (adminNoteTimerRef.current) {
      window.clearTimeout(adminNoteTimerRef.current);
    }

    adminNoteTimerRef.current = window.setTimeout(() => {
      void session.actions.updateNote(nextValue).catch(() => {});
    }, 250);
  }

  const joinStatusText = !roomSlugIsValid
    ? INVALID_SLUG_MESSAGE
    : session.lastError?.message
      || (wantsAdmin && session.adminSeatAvailable === false
        ? 'Админ уже подключён к этой комнате. Войдите как участник.'
        : DEFAULT_ROOM_STATUS_TEXT);

  const roomLinkHelpText = copyState === 'success'
    ? 'Ссылка скопирована.'
    : copyState === 'error'
      ? 'Не удалось скопировать ссылку. Скопируйте её вручную.'
      : ROOM_LINK_HELP_TEXT;

  return (
    <>
      <div
        className="ui secondary menu"
        id="sessionTopbar"
        style={{ display: session.session.joined ? 'flex' : 'none' }}
      >
        <div
          className="ui label session-badge item"
          id="roomWrapper"
          style={{ display: session.session.joined ? undefined : 'none' }}
        >
          <i className="users icon" />
          <span className="session-badge-text">Комната:</span>
          <span className="session-badge-value" id="currentRoomName">
            {activeRoomSlug || '---'}
          </span>
        </div>

        <div
          className="ui label session-badge item"
          id="adminWrapper"
          style={{ visibility: session.session.joined ? 'visible' : 'hidden' }}
        >
          <i className="chess king icon" />
          <span className="session-badge-text">Текущий админ:</span>
          <span className="session-badge-value" id="currentAdmin">
            {session.adminPlayer?.name || '---'}
          </span>
        </div>

        <div className="right menu">
          <div className="item">
            <button
              className="ui button"
              id="copyRoomLinkTopBtn"
              style={{ display: session.session.joined ? undefined : 'none' }}
              type="button"
              onClick={() => {
                void handleCopyLink();
              }}
            >
              <i className="copy icon" />
              Ссылка
            </button>
          </div>
          <div className="item">
            <button
              className="ui button"
              id="historyTopBtn"
              style={{ display: session.session.joined ? undefined : 'none' }}
              type="button"
              onClick={openHistoryPage}
            >
              <i className="history icon" />
              История
            </button>
          </div>
          <div className="item">
            <button
              className="ui right labeled icon button"
              id="changeNameBtn"
              style={{ display: session.session.joined ? undefined : 'none' }}
              type="button"
              onClick={handleChangeIdentity}
            >
              <span className="session-badge-value" id="sessionUserName">
                {session.session.userName || playerName}
              </span>
              <i className="close icon" />
            </button>
          </div>
        </div>
      </div>

      <div className="ui basic center aligned segment page-hero" style={{ paddingTop: 0 }}>
        <div className="ui basic center aligned" style={{ marginBottom: 0 }}>
          <h2 className="ui header">Скрум Покер Онлине</h2>
        </div>

        <div
          className="ui segment"
          id="joinPanel"
          style={{ display: session.session.joined ? 'none' : undefined }}
        >
          <form className="ui large form" id="joinForm">
            <div className="join-grid">
              <div
                className="join-field field"
                id="roomBuilderField"
                style={{ display: 'none' }}
              >
                <label htmlFor="roomSuffix">Название комнаты</label>
                <div className="ui fluid input">
                  <input id="roomSuffix" type="text" value={normalizedRoomSlug} disabled />
                </div>
                <div className="join-meta" id="roomHelpText">
                  {DEFAULT_ROOM_STATUS_TEXT}
                </div>
              </div>

              <div
                className={`join-field field${hasRouteRoom ? '' : ' hidden'}`}
                id="roomLinkField"
                style={{ display: hasRouteRoom ? undefined : 'none' }}
              >
                <label htmlFor="roomLinkInput">Ссылка комнаты</label>
                <div className="ui fluid action input join-room-link">
                  <input id="roomLinkInput" type="text" value={shareLink} readOnly />
                  <button
                    className="ui button"
                    id="copyRoomLinkBtn"
                    type="button"
                    onClick={() => {
                      void handleCopyLink();
                    }}
                  >
                    Копировать
                  </button>
                </div>
                <div className="join-meta" id="roomLinkHelpText">
                  {roomLinkHelpText}
                </div>
              </div>

              <div className="join-field field" id="playerNameField">
                <label htmlFor="playerName">Ваше имя</label>
                <div className="ui fluid input">
                  <input
                    id="playerName"
                    type="text"
                    value={playerName}
                    placeholder="Ваше имя"
                    onChange={(event) => {
                      setPlayerName(event.target.value);
                    }}
                  />
                </div>
                <div className="join-meta" id="roomStatusText">
                  {joinStatusText}
                </div>
              </div>

              <div className="join-actions">
                <button
                  className="ui primary large button onlyAuth"
                  id="createRoomBtn"
                  style={{ display: 'none' }}
                  type="button"
                >
                  Создать комнату
                </button>
                <button
                  className={`ui large basic button onlyAuth${wantsAdmin ? ' green' : ''}`}
                  id="iAmAdmin"
                  style={{ display: hasRouteRoom ? undefined : 'none' }}
                  type="button"
                  onClick={() => {
                    setWantsAdmin((currentValue) => !currentValue);
                  }}
                >
                  Я админ
                </button>
                <button
                  className={buildUiButtonClass('ui primary large button onlyAuth', {
                    disabled: session.pending.join,
                    loading: session.pending.join,
                  })}
                  id="joinBtn"
                  style={{ display: hasRouteRoom ? undefined : 'none' }}
                  type="button"
                  onClick={() => {
                    void handleJoin();
                  }}
                >
                  Войти
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="app-layout">
        <aside
          className="app-sidebar"
          id="taskSidebar"
          style={{
            display: session.session.joined && session.session.isAdmin ? undefined : 'none',
          }}
        >
          <div className="app-sidebar-stack">
            <div
              className="ui basic segment"
              id="taskListActions"
              style={{ display: 'none', padding: 0, margin: '0 0 1rem 0' }}
            />

            <button
              className="ui top attached fluid button"
              id="loadTaskListBtn"
              type="button"
              onClick={() => {
                setTaskListDraft(session.taskState.items.join('\n'));
                setTaskListModalOpen(true);
              }}
            >
              Загрузить список
            </button>
            <div
              className="ui attached segment task-wheel-section"
              id="taskPickerSection"
              style={{
                display:
                  session.session.joined
                  && session.session.isAdmin
                  && session.taskState.items.length
                    ? undefined
                    : 'none',
              }}
            >
              <div className="task-wheel-header">
                <div className="task-wheel-title">Текущая задача</div>
              </div>
              <div className="task-wheel-shell">
                <button
                  className={buildUiButtonClass('ui icon button task-wheel-arrow', {
                    disabled: session.pending.taskSelect || session.taskState.selectedIndex <= 0,
                  })}
                  id="taskPrevBtn"
                  style={{
                    display:
                      session.taskState.items.length > 0 && session.session.isAdmin
                        ? undefined
                        : 'none',
                  }}
                  type="button"
                  onClick={() => {
                    void handleSelectTask(-1);
                  }}
                >
                  <i className="angle up icon" />
                </button>
                <div className="task-wheel-viewport">
                  <div className="task-wheel-highlight" />
                  <div
                    className="task-wheel-track"
                    id="taskWheelTrack"
                    style={{ transform: taskWheelTransform }}
                  >
                    <div className="task-wheel-spacer" />
                    {session.taskState.items.map((task, index) => {
                      const distance = Math.abs(index - session.taskState.selectedIndex);
                      const distanceClass = distance === 0
                        ? 'distance-0'
                        : distance === 1
                          ? 'distance-1'
                          : distance === 2
                            ? 'distance-2'
                            : 'distance-far';
                      const taskHref = getTaskHref(task);

                      return (
                        <a
                          key={`${task}-${index}`}
                          className={`task-wheel-item${
                            index === session.taskState.selectedIndex ? ' active' : ''
                          } ${distanceClass}`}
                          href={taskHref || undefined}
                          rel="noreferrer"
                          target={taskHref ? '_blank' : undefined}
                        >
                          <span className="task-wheel-label">{getTaskLabel(task)}</span>
                        </a>
                      );
                    })}
                    <div className="task-wheel-spacer" />
                  </div>
                </div>
                <button
                  className={buildUiButtonClass('ui icon button task-wheel-arrow', {
                    disabled:
                      session.pending.taskSelect
                      || session.taskState.selectedIndex >= session.taskState.items.length - 1,
                  })}
                  id="taskNextBtn"
                  style={{
                    display:
                      session.taskState.items.length > 0 && session.session.isAdmin
                        ? undefined
                        : 'none',
                  }}
                  type="button"
                  onClick={() => {
                    void handleSelectTask(1);
                  }}
                >
                  <i className="angle down icon" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div className="app-content">
          <div className="ui centered grid container">
            <div className="twelve wide column">
              <input
                id="isAdmin"
                type="hidden"
                value={session.session.joined ? (session.session.isAdmin ? '1' : '0') : (wantsAdmin ? '1' : '0')}
              />
              <div className="ui basic" id="common" style={{ marginBottom: 0 }}>
                <div
                  className={`top-controls${
                    session.session.isAdmin ? ' admin-mode' : ' viewer-mode'
                  }`}
                  id="topControls"
                  style={{ display: session.session.joined ? 'flex' : 'none' }}
                >
                  <div
                    className="ui buttons"
                    id="adminControls"
                    style={{
                      display:
                        session.session.joined && session.session.isAdmin ? undefined : 'none',
                    }}
                  >
                    <button
                      className="ui green button"
                      id="revealBtn"
                      type="button"
                      onClick={session.actions.reveal}
                    >
                      Показать
                    </button>
                    <button
                      className="ui red button"
                      id="resetBtn"
                      type="button"
                      onClick={session.actions.reset}
                    >
                      Сбросить
                    </button>
                  </div>

                  <div
                    className={`estimation-mode-panel ${
                      session.session.isAdmin ? 'admin-mode' : 'viewer-mode'
                    }`}
                    id="estimationModePanel"
                    style={{ display: session.session.joined ? undefined : 'none' }}
                  >
                    <div className="estimation-mode-content">
                      <div className="estimation-mode-label" id="estimationModeLabel">
                        Оцениваем:{' '}
                        <span className="estimation-mode-value" id="estimationModeValue">
                          {session.estimationMode === 'hours' ? 'Часы' : 'Поинты'}
                        </span>
                      </div>
                      <div className="ui buttons estimation-mode-buttons" id="estimationModeButtons">
                        <button
                          className={`ui button${
                            session.estimationMode === 'points' ? ' blue active' : ''
                          }`}
                          id="modePointsBtn"
                          type="button"
                          onClick={() => {
                            void session.actions.setEstimationMode('points');
                          }}
                        >
                          Поинты
                        </button>
                        <button
                          className={`ui button${
                            session.estimationMode === 'hours' ? ' blue active' : ''
                          }`}
                          id="modeHoursBtn"
                          type="button"
                          onClick={() => {
                            void session.actions.setEstimationMode('hours');
                          }}
                        >
                          Часы
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`viewer-task-panel${hasViewerTask ? ' visible' : ''}`}
                    id="viewerTaskPanel"
                    style={{
                      display: hasViewerTask ? undefined : 'none',
                    }}
                  >
                    <div className="estimation-mode-content">
                      <a
                        className="viewer-task-link"
                        id="viewerTaskLink"
                        href={selectedTaskHref || undefined}
                        rel="noopener noreferrer"
                        target={selectedTaskHref ? '_blank' : undefined}
                      >
                        <span className="viewer-task-caption">Текущая задача:</span>
                        <span className="viewer-task-value" id="viewerTaskValue">
                          {selectedTaskLabel}
                        </span>
                      </a>
                    </div>
                  </div>
                </div>

                <div
                  className="ui form"
                  id="adminNoteForm"
                  style={{
                    display:
                      session.session.joined && session.session.isAdmin ? undefined : 'none',
                  }}
                >
                  <div className="field">
                    <label htmlFor="adminNote">Сообщение участникам:</label>
                    <input
                      key={`${activeRoomSlug}:${session.note}`}
                      id="adminNote"
                      type="text"
                      defaultValue={session.note}
                      placeholder="Введите сообщение..."
                      onChange={(event) => {
                        handleAdminNoteInput(event.target.value);
                      }}
                    />
                  </div>
                </div>

                <div
                  className="ui message"
                  id="noteDisplay"
                  style={{
                    display:
                      session.session.joined
                      && !session.session.isAdmin
                      && session.note.trim()
                        ? undefined
                        : 'none',
                  }}
                >
                  {renderTextWithLinks(session.note)}
                </div>
                <div
                  id="voteButtons"
                  className="ui wrapping big spaced buttons"
                  style={{
                    marginBottom: '15px',
                    marginTop: '15px',
                    display: session.session.joined ? 'grid' : 'none',
                  }}
                >
                  {votingBoard.voteValues.map((value) => {
                    const isOriginalVote = ['1', '2', '3', '5', '8', '13', '20', '40', '?']
                      .includes(value);
                    const isActive = votingBoard.currentVote === value;

                    return (
                      <button
                        key={value}
                        className={`ui big button${isOriginalVote ? ' orange' : ''}${
                          isActive ? ' blue' : ''
                        }`}
                        type="button"
                        disabled={!votingBoard.canVote}
                        onClick={() => {
                          session.actions.vote(value);
                        }}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="ui basic" style={{ marginTop: 0 }}>
                <div id="players">
                  {votingBoard.orderedPlayers.map((player, index) => {
                    const visibleVote = getVisibleVoteValue(player, {
                      revealed: session.revealed,
                      socketId: session.socketId,
                    });
                    const isVoted = Boolean(player.vote);
                    const gradientClass = GRADIENT_CLASSES[index % GRADIENT_CLASSES.length];

                    return (
                      <div
                        key={player.id}
                        className={`ui raised link card player-card ${
                          isVoted ? gradientClass : 'default-card'
                        }${player.reaction ? ' has-reaction' : ''}`}
                        data-id={player.id}
                        data-reaction={player.reaction || ''}
                      >
                        <div className="content flex-center player-card-content">
                          <div className="player-card-body">
                            <div className="selectedPoint">{visibleVote}</div>
                            <div className="player-reaction">{player.reaction || ''}</div>
                          </div>
                          <div className="mini header player-name">{player.name}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <input id="averageVote1" type="hidden" value={averageVoteValue} />
          </div>
        </div>

        <div className="ui fixed bottom sticky">
          <div
            className="ui tiny card statistic"
            id="averageVote"
            style={{ display: showAverageVote ? undefined : 'none' }}
          >
            <div className="value" style={{ fontWeight: 'bolder' }}>
              {averageVoteValue}
            </div>
            <div className="label">
              {session.estimationMode === 'hours'
                ? 'Средняя оценка в часах'
                : 'Средняя оценка в поинтах'}
            </div>
          </div>
        </div>

        <div
          className="reaction-dock"
          id="reactionDock"
          ref={reactionDockRef}
          style={{
            display:
              session.session.joined && session.connectionStatus === 'connected'
                ? 'flex'
                : 'none',
          }}
        >
          <div
            className={`reaction-picker${reactionPickerOpen ? ' open' : ''}`}
            id="reactionPicker"
          >
            {AVAILABLE_REACTIONS.map((reaction) => {
              const isActive = reaction.value === (session.currentPlayer?.reaction ?? null);

              return (
                <button
                  key={reaction.value}
                  type="button"
                  className={`reaction-option${isActive ? ' active' : ''}`}
                  data-reaction={reaction.value}
                  aria-label={reaction.label}
                  aria-pressed={isActive}
                  title={reaction.label}
                  disabled={session.pending.setReaction}
                  onClick={() => {
                    void handleReactionSelect(isActive ? null : reaction.value);
                  }}
                >
                  {reaction.value}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className={`reaction-trigger${
              session.currentPlayer?.reaction ? ' has-reaction' : ''
            }${reactionPickerOpen ? ' open' : ''}`}
            id="reactionTrigger"
            aria-expanded={reactionPickerOpen}
            aria-label="Выбрать реакцию"
            disabled={session.pending.setReaction}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setReactionPickerOpen((currentValue) => !currentValue);
            }}
          >
            <span className="reaction-trigger-emoji" id="reactionTriggerEmoji">
              {session.currentPlayer?.reaction || '😊'}
            </span>
          </button>
        </div>

        <div className="httpsNotice">
          <span>{versionLabel ? `v ${versionLabel}` : 'v'}</span>
          <a
            href="https://www.notion.so/303d22895e1580e88e47cb42885696b2"
            target="_blank"
            rel="noreferrer"
          >
            если проблемы с сертификатом
          </a>
        </div>

        {taskListModalOpen ? (
          <div className="legacy-modal-overlay">
            <div
              className="ui small modal active visible"
              id="taskListModal"
              style={{ display: 'block' }}
            >
              <i
                className="close icon"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setTaskListModalOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    setTaskListModalOpen(false);
                  }
                }}
              />
              <div className="header">Загрузить список задач</div>
              <div className="content">
                <div className="ui form">
                  <div className="field">
                    <label htmlFor="taskListInput">Вставьте ссылки на задачи</label>
                    <textarea
                      id="taskListInput"
                      rows={10}
                      value={taskListDraft}
                      placeholder={'https://tracker.example/ABC-123\nhttps://tracker.example/ABC-124\nили разделите их пробелами или запятыми'}
                      onChange={(event) => {
                        setTaskListDraft(event.target.value);
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="actions">
                <button
                  className="ui cancel button"
                  type="button"
                  onClick={() => {
                    setTaskListModalOpen(false);
                  }}
                >
                  Отмена
                </button>
                <button
                  className={buildUiButtonClass('ui primary button', {
                    disabled: session.pending.taskListUpdate,
                    loading: session.pending.taskListUpdate,
                  })}
                  id="saveTaskListBtn"
                  type="button"
                  onClick={() => {
                    void handleTaskListSave();
                  }}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function buildUiButtonClass(
  baseClassName: string,
  options: {
    disabled?: boolean;
    loading?: boolean;
  } = {},
): string {
  return `${baseClassName}${options.disabled ? ' disabled' : ''}${
    options.loading ? ' loading' : ''
  }`;
}

function renderTextWithLinks(text: string): ReactNode {
  const source = String(text || '');
  if (!source.trim()) {
    return null;
  }

  const parts = source.split(/(https?:\/\/[^\s]+)/g);

  return parts.map((part, index) => {
    if (/^https?:\/\/[^\s]+$/.test(part)) {
      return (
        <a key={`${part}-${index}`} href={part} rel="noreferrer" target="_blank">
          {part}
        </a>
      );
    }

    return <span key={`${index}-${part}`}>{part}</span>;
  });
}
