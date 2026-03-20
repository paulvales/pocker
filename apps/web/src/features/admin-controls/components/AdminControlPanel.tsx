import type { EstimationMode } from '@contracts';
import { useState } from 'react';

import type { SetStoryPointsResult } from '@/features/rooms/realtime/types';

type AdminControlPanelProps = {
  averageLabel: string;
  averageValue: string;
  canMutate: boolean;
  estimationMode: EstimationMode;
  hasVotes: boolean;
  onReveal: () => void;
  onReset: () => void;
  onSendStoryPoints: () => Promise<SetStoryPointsResult>;
  onSetEstimationMode: (mode: EstimationMode) => Promise<void>;
  pending: {
    setEstimationMode: boolean;
    setStoryPoints: boolean;
  };
  revealed: boolean;
};

type FeedbackState =
  | { kind: 'idle'; message: string }
  | { kind: 'success' | 'warning'; message: string };

export function AdminControlPanel({
  averageLabel,
  averageValue,
  canMutate,
  estimationMode,
  hasVotes,
  onReveal,
  onReset,
  onSendStoryPoints,
  onSetEstimationMode,
  pending,
  revealed,
}: AdminControlPanelProps) {
  const [feedback, setFeedback] = useState<FeedbackState>({
    kind: 'idle',
    message: 'Admin-only controls stay isolated here and do not leak into the route component.',
  });

  async function handleSendStoryPoints() {
    if (!revealed) {
      setFeedback({
        kind: 'warning',
        message: 'Reveal votes before sending story points to YouTrack.',
      });
      return;
    }

    if (!hasVotes) {
      setFeedback({
        kind: 'warning',
        message: 'No numeric votes are available for a YouTrack update yet.',
      });
      return;
    }

    const result = await onSendStoryPoints();
    setFeedback({
      kind: 'success',
      message: `${result.issueIdReadable}: Story points = ${result.average}`,
    });
  }

  return (
    <article className="panel session-rail-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Admin controls</p>
          <h2>Round management</h2>
        </div>
        <span className="role-pill">Admin</span>
      </div>

      <div className="admin-action-grid">
        <button
          className={
            estimationMode === 'points'
              ? 'toggle-pill toggle-pill-active'
              : 'toggle-pill'
          }
          type="button"
          disabled={!canMutate || pending.setEstimationMode}
          onClick={() => {
            void onSetEstimationMode('points');
          }}
        >
          Points
        </button>
        <button
          className={
            estimationMode === 'hours'
              ? 'toggle-pill toggle-pill-active'
              : 'toggle-pill'
          }
          type="button"
          disabled={!canMutate || pending.setEstimationMode}
          onClick={() => {
            void onSetEstimationMode('hours');
          }}
        >
          Hours
        </button>
      </div>

      <div className="average-card">
        <span className="status-label">{averageLabel}</span>
        <strong>{revealed ? averageValue : 'Hidden until reveal'}</strong>
      </div>

      <div className="hero-actions">
        <button
          className="button-primary"
          type="button"
          disabled={!canMutate}
          onClick={onReveal}
        >
          Reveal
        </button>
        <button
          className="button-secondary"
          type="button"
          disabled={!canMutate}
          onClick={onReset}
        >
          Reset round
        </button>
      </div>

      <div className="hero-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={!canMutate || pending.setStoryPoints}
          onClick={() => {
            void handleSendStoryPoints().catch(() => {});
          }}
        >
          {pending.setStoryPoints ? 'Sending...' : 'Send story points'}
        </button>
      </div>

      <p className={`entry-status${
        feedback.kind === 'warning' ? ' entry-status-error' : ''
      }`}
      >
        {feedback.message}
      </p>
    </article>
  );
}
