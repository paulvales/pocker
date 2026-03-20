import type { PlayerDto } from '@contracts';

import { getVisibleVoteValue } from '../model/voteScale';

type ParticipantGridProps = {
  players: PlayerDto[];
  revealed: boolean;
  socketId: string | null;
};

export function ParticipantGrid({
  players,
  revealed,
  socketId,
}: ParticipantGridProps) {
  if (!players.length) {
    return (
      <p className="entry-status">
        Waiting for the first players snapshot from the realtime store.
      </p>
    );
  }

  return (
    <div className="participant-grid">
      {players.map((player) => {
        const isCurrentUser = player.id === socketId;
        const visibleVote = getVisibleVoteValue(player, {
          revealed,
          socketId,
        });

        return (
          <article
            className={`participant-card${
              isCurrentUser ? ' participant-card-current' : ''
            }${player.vote ? ' participant-card-voted' : ''}`}
            key={player.id}
          >
            <div className="participant-card-header">
              <strong>{player.name}</strong>
              <div className="participant-chip-row">
                {player.isAdmin ? (
                  <span className="participant-chip participant-chip-admin">
                    Admin
                  </span>
                ) : null}
                {isCurrentUser ? (
                  <span className="participant-chip participant-chip-current">
                    You
                  </span>
                ) : null}
              </div>
            </div>

            <div className="participant-vote">{visibleVote}</div>

            {player.reaction ? (
              <div className="participant-reaction" aria-label={`Reaction ${player.reaction}`}>
                {player.reaction}
              </div>
            ) : null}

            <p className="participant-copy">
              {player.vote
                ? revealed || isCurrentUser
                  ? 'Vote is visible in the current round state.'
                  : 'Vote is submitted and stays private until reveal.'
                : 'Vote is still pending for this participant.'}
            </p>
          </article>
        );
      })}
    </div>
  );
}
