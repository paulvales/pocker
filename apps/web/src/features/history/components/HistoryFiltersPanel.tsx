import type { HistoryFiltersDto } from '@contracts';
import type { FormEvent } from 'react';

import { formatEstimateTypeLabel } from '@/features/history/model/historyFilters';

type HistoryFiltersPanelProps = {
  filters: HistoryFiltersDto;
  roomOptions: string[];
  participantOptions: string[];
  estimateTypeOptions: string[];
  onApply: (filters: HistoryFiltersDto) => void;
  onReset: () => void;
};

export function HistoryFiltersPanel({
  filters,
  roomOptions,
  participantOptions,
  estimateTypeOptions,
  onApply,
  onReset,
}: HistoryFiltersPanelProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    onApply({
      roomId: readFormDataText(formData, 'roomId'),
      taskId: readFormDataText(formData, 'taskId'),
      participantName: readFormDataText(formData, 'participantName'),
      estimate: readFormDataText(formData, 'estimate'),
      estimateType: readFormDataText(formData, 'estimateType'),
      recordedOn: readFormDataText(formData, 'recordedOn'),
      page: 1,
      pageSize: filters.pageSize,
    });
  }

  return (
    <article className="panel panel-subtle history-filter-panel">
      <div className="history-panel-copy">
        <p className="eyebrow">Filters</p>
        <h2>Slice saved estimates by room, task and participant.</h2>
        <p className="lead">
          The query string stays in sync with the current filter set, so any
          result state can be refreshed or shared directly.
        </p>
      </div>

      <form className="history-filter-form" onSubmit={handleSubmit}>
        <label className="field-stack" htmlFor="historyRoomId">
          <span className="field-label">Room</span>
          <input
            id="historyRoomId"
            className="room-input room-input-mono"
            list="history-room-options"
            name="roomId"
            defaultValue={filters.roomId}
            placeholder="alpha-room"
          />
          <datalist id="history-room-options">
            {roomOptions.map((roomId) => (
              <option key={roomId} value={roomId} />
            ))}
          </datalist>
        </label>

        <label className="field-stack" htmlFor="historyTaskId">
          <span className="field-label">Task</span>
          <input
            id="historyTaskId"
            className="room-input room-input-mono"
            name="taskId"
            defaultValue={filters.taskId}
            placeholder="APP-1204"
          />
        </label>

        <label className="field-stack" htmlFor="historyParticipantName">
          <span className="field-label">Participant</span>
          <input
            id="historyParticipantName"
            className="room-input"
            list="history-participant-options"
            name="participantName"
            defaultValue={filters.participantName}
            placeholder="Viewer"
          />
          <datalist id="history-participant-options">
            {participantOptions.map((participantName) => (
              <option key={participantName} value={participantName} />
            ))}
          </datalist>
        </label>

        <label className="field-stack" htmlFor="historyEstimate">
          <span className="field-label">Estimate</span>
          <input
            id="historyEstimate"
            className="room-input room-input-mono"
            name="estimate"
            defaultValue={filters.estimate}
            placeholder="5"
          />
        </label>

        <label className="field-stack" htmlFor="historyEstimateType">
          <span className="field-label">Type</span>
          <select
            id="historyEstimateType"
            className="history-select"
            name="estimateType"
            defaultValue={filters.estimateType}
          >
            <option value="">All types</option>
            {estimateTypeOptions.map((estimateType) => (
              <option key={estimateType} value={estimateType}>
                {formatEstimateTypeLabel(estimateType)}
              </option>
            ))}
          </select>
        </label>

        <label className="field-stack" htmlFor="historyRecordedOn">
          <span className="field-label">Recorded on</span>
          <input
            id="historyRecordedOn"
            className="room-input"
            type="date"
            name="recordedOn"
            defaultValue={filters.recordedOn}
          />
        </label>

        <div className="hero-actions history-filter-actions">
          <button className="button-primary" type="submit">
            Apply filters
          </button>
          <button
            className="button-secondary"
            type="reset"
            onClick={onReset}
          >
            Reset
          </button>
        </div>
      </form>
    </article>
  );
}

function readFormDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
