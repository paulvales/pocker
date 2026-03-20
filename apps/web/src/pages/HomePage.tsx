import { startTransition, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { buildRoomPath, isValidRoomSlug, normalizeRoomSlug } from '@/features/rooms/model/roomRoute';
import { readStoredPlayerName } from '@/features/rooms/model/sessionPersistence';

const checkpoints = [
  'Room routes, local identity persistence and admin intent now run through the React shell.',
  'Voting, reactions, task navigation and history all share the same frontend runtime.',
  'Legacy room links stay compatible while the product runs on the React entry by default.',
];

export function HomePage() {
  const navigate = useNavigate();
  const [roomSlug, setRoomSlug] = useState('alpha-room');
  const normalizedRoomSlug = useMemo(() => normalizeRoomSlug(roomSlug), [roomSlug]);
  const roomSlugIsValid = useMemo(() => isValidRoomSlug(roomSlug), [roomSlug]);
  const savedPlayerName = readStoredPlayerName();

  function handleOpenRoom() {
    if (!roomSlugIsValid || !normalizedRoomSlug) {
      return;
    }

    startTransition(() => {
      void navigate(buildRoomPath(normalizedRoomSlug));
    });
  }

  return (
    <section className="page-grid">
      <article className="panel panel-hero">
        <p className="eyebrow">Rooms</p>
        <h2>Open a planning room in one step.</h2>
        <p className="lead">
          Create a room, reopen an existing slug or jump straight into a shared
          planning session from the React application shell.
        </p>

        <div className="room-launch-form">
          <div className="field-stack">
            <label className="field-label" htmlFor="homeRoomSlug">
              Room slug
            </label>
            <div className="room-launch-row">
              <input
                id="homeRoomSlug"
                className="room-input room-input-mono"
                value={roomSlug}
                onChange={(event) => {
                  setRoomSlug(event.target.value);
                }}
                placeholder="team-sync"
              />
              <button
                className="button-primary"
                type="button"
                onClick={handleOpenRoom}
                disabled={!roomSlugIsValid || !normalizedRoomSlug}
              >
                Open room
              </button>
            </div>
            <p className="field-help">
              {roomSlugIsValid && normalizedRoomSlug
                ? `Route preview: ${buildRoomPath(normalizedRoomSlug)}`
                : 'Use letters, numbers, hyphen or underscore. Service routes are reserved.'}
            </p>
          </div>

          <div className="saved-identity">
            <span className="status-label">Saved identity</span>
            <strong>{savedPlayerName || 'No local player name yet'}</strong>
          </div>
        </div>

        <div className="hero-actions">
          <button
            className="button-secondary"
            type="button"
            onClick={handleOpenRoom}
            disabled={!roomSlugIsValid || !normalizedRoomSlug}
          >
            Go to room route
          </button>
          <Link className="button-secondary" to="/history">
            Open history
          </Link>
        </div>
      </article>

      <article className="panel">
        <p className="eyebrow">What you can do</p>
        <ul className="check-list">
          {checkpoints.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>
    </section>
  );
}
