import type { EstimationMode } from '@contracts';

import { isBaseVoteValue } from '../model/voteScale';

type VotingBoardProps = {
  canVote: boolean;
  currentVote: string | null;
  estimationMode: EstimationMode;
  revealed: boolean;
  visibleAverageValue: string;
  averageLabel: string;
  voteValues: string[];
  onVote: (value: string) => void;
};

export function VotingBoard({
  canVote,
  currentVote,
  estimationMode,
  revealed,
  visibleAverageValue,
  averageLabel,
  voteValues,
  onVote,
}: VotingBoardProps) {
  return (
    <article className="panel panel-stage voting-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Voting</p>
          <h2>Round controls</h2>
        </div>
        <div className="voting-panel-meta">
          <span className="role-pill">
            {estimationMode === 'hours' ? 'Hours' : 'Points'}
          </span>
          <span className="connection-pill connection-pill-neutral">
            {revealed ? 'Revealed' : 'Hidden votes'}
          </span>
        </div>
      </div>

      <div className="average-card">
        <span className="status-label">{averageLabel}</span>
        <strong>{visibleAverageValue}</strong>
      </div>

      <div className="vote-grid" role="group" aria-label="Vote values">
        {voteValues.map((value) => {
          const isActive = currentVote === value;
          const isAccent = isBaseVoteValue(value);

          return (
            <button
              key={value}
              className={`vote-button${
                isActive ? ' vote-button-active' : ''
              }${isAccent ? ' vote-button-accent' : ''}`}
              type="button"
              disabled={!canVote}
              onClick={() => {
                onVote(value);
              }}
            >
              {value}
            </button>
          );
        })}
      </div>

      <p className="field-help">
        {currentVote
          ? `Your current vote: ${currentVote}.`
          : 'You have not voted in this round yet.'}{' '}
        Other votes stay hidden until reveal.
      </p>
    </article>
  );
}
