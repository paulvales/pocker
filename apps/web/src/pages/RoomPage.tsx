import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { AdminControlPanel } from '@/features/admin-controls/components/AdminControlPanel';
import { ReactionDock } from '@/features/reactions/components/ReactionDock';
import {
  buildRoomLink,
  buildRoomPath,
  isValidRoomSlug,
  normalizeRoomSlug,
} from '@/features/rooms/model/roomRoute';
import {
  clearStoredAdminIntent,
  clearStoredPlayerName,
  readStoredAdminIntent,
  readStoredPlayerName,
  writeStoredAdminIntent,
  writeStoredPlayerName,
} from '@/features/rooms/model/sessionPersistence';
import { RoomSessionProvider, useRoomSession } from '@/features/rooms/realtime';
import { AdminTaskSidebar } from '@/features/tasks/components/AdminTaskSidebar';
import { getTaskHref, getTaskLabel } from '@/features/tasks/model/taskList';
import { ParticipantGrid } from '@/features/voting/components/ParticipantGrid';
import { VotingBoard } from '@/features/voting/components/VotingBoard';
import { useVotingBoard } from '@/features/voting/hooks/useVotingBoard';
import { clearStoredVote } from '@/features/voting/model/votePersistence';

const INVALID_SLUG_MESSAGE =
  'Use letters, numbers, hyphen or underscore. Reserved service routes are not allowed.';

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
  const [playerName, setPlayerName] = useState(() => readStoredPlayerName());
  const [wantsAdmin, setWantsAdmin] = useState(() => (
    readStoredAdminIntent(normalizedRoomSlug)
  ));
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const autoJoinAttemptedRef = useRef('');

  const activeRoomSlug = session.room?.id || normalizedRoomSlug;
  const shareLink = buildRoomLink(activeRoomSlug);
  const selectedTaskLabel = session.selectedTask
    ? getTaskLabel(session.selectedTask)
    : null;
  const selectedTaskHref = session.selectedTask
    ? getTaskHref(session.selectedTask)
    : null;
  const canMutateRoom =
    session.session.isAdmin && session.connectionStatus === 'connected';
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

  useEffect(() => {
    if (roomSlug && normalizedRoomSlug && roomSlug !== normalizedRoomSlug) {
      startTransition(() => {
        void navigate(buildRoomPath(normalizedRoomSlug), { replace: true });
      });
    }
  }, [navigate, normalizedRoomSlug, roomSlug]);

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
    if (!roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }
    if (session.session.joined) {
      return;
    }
    if (session.connectionStatus !== 'connected') {
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
    normalizedRoomSlug,
    roomSlugIsValid,
    session.connectionStatus,
    session.session.joined,
  ]);

  function persistIdentity(nextName: string, nextIsAdmin: boolean) {
    writeStoredPlayerName(nextName);
    writeStoredAdminIntent(normalizedRoomSlug, nextIsAdmin);
  }

  async function handleJoin(nextIsAdmin: boolean) {
    const trimmedName = playerName.trim();
    if (!trimmedName || !roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }

    persistIdentity(trimmedName, nextIsAdmin);
    setWantsAdmin(nextIsAdmin);

    try {
      await session.actions.join({
        name: trimmedName,
        isAdmin: nextIsAdmin,
        roomId: normalizedRoomSlug,
      });
    } catch {
      // The realtime store already exposes the normalized error.
    }
  }

  async function handleCreateAndJoin() {
    const trimmedName = playerName.trim();
    if (!trimmedName || !roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }

    try {
      const room = await session.actions.createRoom(normalizedRoomSlug);
      persistIdentity(trimmedName, true);
      setWantsAdmin(true);

      if (room.id !== normalizedRoomSlug) {
        startTransition(() => {
          void navigate(buildRoomPath(room.id));
        });
        return;
      }

      await session.actions.join({
        name: trimmedName,
        isAdmin: true,
        roomId: room.id,
      });
    } catch {
      // The realtime store already exposes the normalized error.
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

  function handleResetSession() {
    clearStoredPlayerName();
    clearStoredAdminIntent(activeRoomSlug);
    clearStoredVote(activeRoomSlug, session.session.userName);
    autoJoinAttemptedRef.current = activeRoomSlug;
    session.actions.resetSession();
    setPlayerName('');
    setWantsAdmin(false);
    setCopyState('idle');
  }

  const statusMessage = !roomSlugIsValid
    ? INVALID_SLUG_MESSAGE
    : session.lastError?.message
      || (session.adminSeatAvailable === false && wantsAdmin
        ? 'Admin seat is already occupied. Join as viewer or use a different room slug.'
        : shareLink
          ? 'Share this link with your team. The route stays compatible with the existing slug model.'
          : 'Open a valid room slug to start.');

  const canSubmit = Boolean(playerName.trim() && roomSlugIsValid && normalizedRoomSlug);
  const pendingActions = Object.entries(session.pending)
    .filter(([, isPending]) => isPending)
    .map(([actionName]) => actionName);

  return (
    <section className="page-grid room-page-grid">
      {!session.session.joined ? (
        <article className="panel panel-stage room-entry-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Room</p>
              <h2>
                {normalizedRoomSlug
                  ? `Room entry for /${normalizedRoomSlug}`
                  : 'Room route is not ready yet'}
              </h2>
            </div>
            <span
              className={`connection-pill connection-pill-${session.connectionStatus}`}
            >
              {session.connectionStatus}
            </span>
          </div>

          <p className="lead">
            Create a room, join an existing slug link or restore your local
            identity from the main React session flow.
          </p>

          <div className="room-entry-grid">
            <div className="field-stack">
              <label className="field-label" htmlFor="roomSlugPreview">
                Room slug
              </label>
              <div
                id="roomSlugPreview"
                className={`room-slug-box${roomSlugIsValid ? '' : ' is-invalid'}`}
              >
                <span className="room-slug-prefix">/</span>
                <span className="room-slug-value">
                  {normalizedRoomSlug || 'missing-room-slug'}
                </span>
              </div>
              <p className="field-help">
                Canonical room route with compatibility for existing slug links.
              </p>
            </div>

            <div className="field-stack">
              <label className="field-label" htmlFor="roomShareLink">
                Share link
              </label>
              <div className="room-link-box">
                <input
                  id="roomShareLink"
                  className="room-input room-input-mono"
                  value={shareLink}
                  readOnly
                />
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    void handleCopyLink();
                  }}
                  disabled={!shareLink}
                >
                  {copyState === 'success'
                    ? 'Copied'
                    : copyState === 'error'
                      ? 'Retry'
                      : 'Copy link'}
                </button>
              </div>
              <p className="field-help">
                {copyState === 'success'
                  ? 'Room link copied to the clipboard.'
                  : copyState === 'error'
                    ? 'Clipboard write failed. Try again or copy the text manually.'
                    : 'Open it directly or send it to the next participant.'}
              </p>
            </div>

            <div className="field-stack">
              <label className="field-label" htmlFor="playerName">
                Your name
              </label>
              <input
                id="playerName"
                className="room-input"
                placeholder="Alice"
                value={playerName}
                onChange={(event) => {
                  setPlayerName(event.target.value);
                }}
              />
              <p className="field-help">
                Stored locally and reused when you open another slug link.
              </p>
            </div>

            <div className="field-stack">
              <span className="field-label">Role intent</span>
              <div className="toggle-pill-group" role="group" aria-label="Role intent">
                <button
                  className={
                    wantsAdmin
                      ? 'toggle-pill toggle-pill-active'
                      : 'toggle-pill'
                  }
                  type="button"
                  onClick={() => {
                    setWantsAdmin(true);
                  }}
                  disabled={session.adminSeatAvailable === false}
                >
                  Admin
                </button>
                <button
                  className={
                    !wantsAdmin
                      ? 'toggle-pill toggle-pill-active'
                      : 'toggle-pill'
                  }
                  type="button"
                  onClick={() => {
                    setWantsAdmin(false);
                  }}
                >
                  Viewer
                </button>
              </div>
              <p className="field-help">
                {session.adminSeatAvailable === null
                  ? 'Admin availability is being resolved through the realtime layer.'
                  : session.adminSeatAvailable
                    ? 'Admin seat is available in this room.'
                    : 'Admin seat is already taken for this room.'}
              </p>
            </div>
          </div>

          <div className="hero-actions">
            <button
              className="button-primary"
              type="button"
              onClick={() => {
                void handleCreateAndJoin();
              }}
              disabled={!canSubmit || session.pending.createRoom || session.pending.join}
            >
              {session.pending.createRoom ? 'Creating room...' : 'Create room'}
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={() => {
                void handleJoin(wantsAdmin);
              }}
              disabled={!canSubmit || session.pending.join}
            >
              {session.pending.join
                ? 'Joining...'
                : wantsAdmin
                  ? 'Join as admin'
                  : 'Join room'}
            </button>
            <Link className="button-secondary" to="/history">
              Open history
            </Link>
          </div>

          <p className={`entry-status${session.lastError ? ' entry-status-error' : ''}`}>
            {statusMessage}
          </p>
        </article>
      ) : (
        <>
          <article className="panel room-topbar-panel">
            <div className="room-topbar">
              <div className="room-badge-row">
                <span className="room-badge">
                  <span className="room-badge-label">Room</span>
                  <strong>{activeRoomSlug}</strong>
                </span>
                <span className="room-badge">
                  <span className="room-badge-label">Admin</span>
                  <strong>{session.adminPlayer?.name || 'Pending'}</strong>
                </span>
                <span className="room-badge">
                  <span className="room-badge-label">You</span>
                  <strong>{session.session.userName}</strong>
                </span>
                <span className="room-badge">
                  <span className="room-badge-label">Round</span>
                  <strong>{session.revealed ? 'Revealed' : 'In progress'}</strong>
                </span>
              </div>

              <div className="room-topbar-actions">
                <button
                  className="button-secondary"
                  type="button"
                  onClick={() => {
                    void handleCopyLink();
                  }}
                >
                  {copyState === 'success' ? 'Link copied' : 'Copy link'}
                </button>
                <Link className="button-secondary" to="/history">
                  History
                </Link>
                <button
                  className="button-primary"
                  type="button"
                  onClick={handleResetSession}
                >
                  Change identity
                </button>
              </div>
            </div>
          </article>

          {session.lastError || session.lastUserEvent ? (
            <article className={`panel${session.lastError ? ' panel-error' : ' panel-subtle'}`}>
              <div className="event-grid">
                <div className="event-card">
                  <span className="status-label">Last room event</span>
                  <strong>
                    {session.lastUserEvent
                      ? `${session.lastUserEvent.type}: ${session.lastUserEvent.message}`
                      : 'No room event yet'}
                  </strong>
                </div>
                <div className="event-card">
                  <span className="status-label">Transport status</span>
                  <strong>
                    {session.lastError
                      ? `${session.lastError.code}: ${session.lastError.message}`
                      : 'No transport errors'}
                  </strong>
                </div>
              </div>
            </article>
          ) : null}

          <section
            className={`room-session-shell${
              session.session.isAdmin
                ? ' room-session-shell-admin'
                : ' room-session-shell-viewer'
            }`}
          >
            {session.session.isAdmin ? (
              <aside className="session-rail">
                <AdminTaskSidebar
                  connectionReady={session.connectionStatus === 'connected'}
                  note={session.note}
                  onSaveNote={session.actions.updateNote}
                  onSaveTaskList={session.actions.updateTaskList}
                  onSelectTask={session.actions.selectTask}
                  pending={{
                    noteUpdate: session.pending.noteUpdate,
                    taskListUpdate: session.pending.taskListUpdate,
                    taskSelect: session.pending.taskSelect,
                  }}
                  roomId={activeRoomSlug}
                  selectedIndex={session.taskState.selectedIndex}
                  selectedTask={session.selectedTask}
                  taskItems={session.taskState.items}
                />

                <AdminControlPanel
                  averageLabel={votingBoard.averageLabel}
                  averageValue={votingBoard.averageValue}
                  canMutate={canMutateRoom}
                  estimationMode={session.estimationMode}
                  hasVotes={votingBoard.hasVotes}
                  onReset={session.actions.reset}
                  onReveal={session.actions.reveal}
                  onSendStoryPoints={session.actions.setStoryPoints}
                  onSetEstimationMode={session.actions.setEstimationMode}
                  pending={{
                    setEstimationMode: session.pending.setEstimationMode,
                    setStoryPoints: session.pending.setStoryPoints,
                  }}
                  revealed={session.revealed}
                />
              </aside>
            ) : null}

            <div className="session-stage-stack">
              <article className="panel panel-stage room-summary-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">
                      {session.session.isAdmin ? 'Admin Session' : 'Viewer Session'}
                    </p>
                    <h2>Core room flow now runs in React</h2>
                  </div>
                  <span className={`connection-pill connection-pill-${session.connectionStatus}`}>
                    {session.connectionStatus}
                  </span>
                </div>

                <div className="session-metric-grid">
                  <article className="status-card">
                    <span className="status-label">Players online</span>
                    <strong>{session.players.length}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Estimation mode</span>
                    <strong>{session.estimationMode === 'hours' ? 'Hours' : 'Points'}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Current round</span>
                    <strong>{session.revealed ? 'Votes revealed' : 'Voting in progress'}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Pending actions</span>
                    <strong>{pendingActions.join(', ') || 'idle'}</strong>
                  </article>
                </div>

                {session.selectedTask ? (
                  selectedTaskHref ? (
                    <a
                      className="task-link-card"
                      href={selectedTaskHref}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="status-label">Selected task</span>
                      <strong>{selectedTaskLabel}</strong>
                      <span className="field-help">{session.selectedTask}</span>
                    </a>
                  ) : (
                    <div className="task-link-card">
                      <span className="status-label">Selected task</span>
                      <strong>{selectedTaskLabel}</strong>
                      <span className="field-help">{session.selectedTask}</span>
                    </div>
                  )
                ) : (
                  <p className="entry-status">
                    No task list is active yet. Votes can still continue for an ad-hoc round.
                  </p>
                )}

                <div className="note-card">
                  <span className="status-label">Shared note</span>
                  <p className="note-copy">
                    {session.note || 'No note from the admin yet.'}
                  </p>
                </div>
              </article>

              <VotingBoard
                averageLabel={votingBoard.averageLabel}
                canVote={votingBoard.canVote}
                currentVote={votingBoard.currentVote}
                estimationMode={session.estimationMode}
                onVote={session.actions.vote}
                revealed={session.revealed}
                visibleAverageValue={votingBoard.visibleAverageValue}
                voteValues={votingBoard.voteValues}
              />

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Participants</p>
                    <h2>Live room roster</h2>
                  </div>
                  <span className="connection-pill connection-pill-neutral">
                    {session.players.length} connected
                  </span>
                </div>

                <ParticipantGrid
                  players={votingBoard.orderedPlayers}
                  revealed={session.revealed}
                  socketId={session.socketId}
                />
              </article>

              <article className="panel panel-subtle">
                <p className="eyebrow">Capability surface</p>
                <div className="event-grid">
                  <div className="event-card">
                    <span className="status-label">Task management</span>
                    <strong>
                      {session.taskState.items.length
                        ? `${session.taskState.items.length} shared tasks`
                        : 'Backlog is still empty'}
                    </strong>
                  </div>
                  <div className="event-card">
                    <span className="status-label">Reactions</span>
                    <strong>
                      {session.currentPlayer?.reaction
                        ? `Active reaction: ${session.currentPlayer.reaction}`
                        : 'Reaction dock is ready'}
                    </strong>
                  </div>
                  <div className="event-card">
                    <span className="status-label">YouTrack capability</span>
                    <strong>
                      {session.session.isAdmin
                        ? 'Available from admin controls'
                        : 'Visible to the admin only'}
                    </strong>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <ReactionDock
            activeReaction={session.currentPlayer?.reaction ?? null}
            canReact={Boolean(
              session.currentPlayer && session.connectionStatus === 'connected',
            )}
            onSelectReaction={session.actions.setReaction}
            pending={session.pending.setReaction}
          />
        </>
      )}
    </section>
  );
}
