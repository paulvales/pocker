import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

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

  return (
    <section className="page-grid room-page-grid">
      {!session.session.joined ? (
        <article className="panel panel-stage room-entry-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">APP-18</p>
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
            Create a room, join an existing slug link, or reopen your saved session
            through the React entry flow. Realtime state already comes from the
            dedicated room store.
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
                Legacy-compatible route. This page supports direct slug links and
                same-room reloads.
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

          <section
            className={`room-session-shell${
              session.session.isAdmin
                ? ' room-session-shell-admin'
                : ' room-session-shell-viewer'
            }`}
          >
            {session.session.isAdmin ? (
              <aside className="panel panel-subtle session-rail">
                <p className="eyebrow">Admin Lane</p>
                <h2>Session controls slot</h2>
                <p className="lead">
                  Voting controls, task navigation and admin-only actions will
                  attach here in APP-19 without changing the room shell itself.
                </p>
                <ul className="check-list">
                  <li>Realtime transport is already connected to this room slug.</li>
                  <li>Session persistence is local and route-aware.</li>
                  <li>Room topbar, badges and shell are already live.</li>
                </ul>
              </aside>
            ) : null}

            <div className="session-stage-stack">
              <article className="panel panel-stage">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">
                      {session.session.isAdmin ? 'Admin Session' : 'Viewer Session'}
                    </p>
                    <h2>Room shell is ready for feature parity work</h2>
                  </div>
                  <span className="role-pill">
                    {session.session.isAdmin ? 'Admin' : 'Viewer'}
                  </span>
                </div>
                <p className="lead">
                  The React room route now handles entry, identity persistence, topbar
                  badges and the session layout. Voting, tasks and reactions can be
                  connected next without revisiting the room lifecycle flow.
                </p>

                <div className="session-metric-grid">
                  <article className="status-card">
                    <span className="status-label">Connection</span>
                    <strong>{session.connectionStatus}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Players online</span>
                    <strong>{session.players.length}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Selected task</span>
                    <strong>{session.selectedTask || 'No task selected yet'}</strong>
                  </article>
                  <article className="status-card">
                    <span className="status-label">Current note</span>
                    <strong>{session.note || 'No note from admin yet'}</strong>
                  </article>
                </div>
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Participants</p>
                    <h2>Live room roster</h2>
                  </div>
                  <span className="connection-pill connection-pill-neutral">
                    {session.revealed ? 'Revealed' : 'Hidden votes'}
                  </span>
                </div>

                {session.players.length ? (
                  <div className="participant-grid">
                    {session.players.map((player) => (
                      <article className="participant-card" key={player.id}>
                        <div className="participant-card-header">
                          <strong>{player.name}</strong>
                          {player.isAdmin ? (
                            <span className="participant-chip participant-chip-admin">
                              Admin
                            </span>
                          ) : (
                            <span className="participant-chip">Viewer</span>
                          )}
                        </div>
                        <p className="participant-copy">
                          {player.id === session.socketId
                            ? 'This is your current socket session.'
                            : 'Connected through the shared room route.'}
                        </p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="entry-status">
                    Waiting for the first players snapshot from the realtime store.
                  </p>
                )}
              </article>

              <article className="panel panel-subtle">
                <p className="eyebrow">Next surface</p>
                <div className="event-grid">
                  <div className="event-card">
                    <span className="status-label">Pending actions</span>
                    <strong>
                      {Object.entries(session.pending)
                        .filter(([, isPending]) => isPending)
                        .map(([actionName]) => actionName)
                        .join(', ') || 'idle'}
                    </strong>
                  </div>
                  <div className="event-card">
                    <span className="status-label">Last room event</span>
                    <strong>
                      {session.lastUserEvent
                        ? `${session.lastUserEvent.type}: ${session.lastUserEvent.message}`
                        : 'No room event yet'}
                    </strong>
                  </div>
                  <div className="event-card">
                    <span className="status-label">Last error</span>
                    <strong>
                      {session.lastError
                        ? `${session.lastError.code}: ${session.lastError.message}`
                        : 'No transport errors'}
                    </strong>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
