import type {
  HistoryFiltersDto,
  HistoryResponseDto,
} from '@contracts';

import type { HistoryLoadStatus } from '@/features/history/hooks/useEstimationHistory';
import {
  formatEstimateTypeLabel,
  formatRecordedAt,
  getHistoryPaginationItems,
  getHistoryVisibleRange,
  hasActiveHistoryFilters,
  HISTORY_PAGE_SIZE_OPTIONS,
} from '@/features/history/model/historyFilters';

type HistoryResultsPanelProps = {
  data: HistoryResponseDto;
  filters: HistoryFiltersDto;
  status: HistoryLoadStatus;
  errorCode: string | null;
  requestedAt: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

const refreshTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function HistoryResultsPanel({
  data,
  filters,
  status,
  errorCode,
  requestedAt,
  onPageChange,
  onPageSizeChange,
}: HistoryResultsPanelProps) {
  const pagination = data.meta.pagination;
  const paginationItems = getHistoryPaginationItems(pagination);
  const hasActiveFilters = hasActiveHistoryFilters(filters);
  const statusLabel = getStatusLabel({
    data,
    errorCode,
    requestedAt,
    status,
  });
  const showTable = data.items.length > 0;
  const showEmptyState = !showTable && status !== 'error';
  const showErrorState = status === 'error' && !showTable;

  return (
    <article className="panel history-results-panel">
      <div className="history-results-header">
        <div className="history-results-copy">
          <p className="eyebrow">Results</p>
          <h2>Estimate history</h2>
          <p className="field-help history-status-copy">{statusLabel}</p>
        </div>

        <label className="field-stack history-page-size" htmlFor="historyPageSize">
          <span className="field-label">Rows per page</span>
          <select
            id="historyPageSize"
            className="history-select"
            value={String(pagination.pageSize)}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
            }}
          >
            {HISTORY_PAGE_SIZE_OPTIONS.map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                {pageSize}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="history-summary-bar">
        <div className="history-summary-stat">
          <span className="status-label">Total records</span>
          <strong>{pagination.totalItems}</strong>
        </div>
        <div className="history-summary-stat">
          <span className="status-label">Range</span>
          <strong>{getHistoryVisibleRange(pagination, data.items.length)}</strong>
        </div>
        <div className="history-summary-stat">
          <span className="status-label">Page</span>
          <strong>
            {pagination.page} / {pagination.totalPages}
          </strong>
        </div>
      </div>

      {status === 'error' && showTable ? (
        <div className="history-inline-notice">
          History refresh failed. Showing the last successful result set.
          {errorCode ? ` (${errorCode})` : ''}
        </div>
      ) : null}

      {showTable ? (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Task</th>
                <th>Participant</th>
                <th>Estimate</th>
                <th>Type</th>
                <th>Recorded at</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, index) => (
                <tr
                  key={`${item.taskId}-${item.participantName}-${item.estimateType}-${item.recordedAt}-${index}`}
                >
                  <td>{item.roomId || '-'}</td>
                  <td className="history-task-cell">{item.taskId || '-'}</td>
                  <td>{item.participantName || '-'}</td>
                  <td>
                    <span className="history-estimate-pill">
                      {item.estimate || '-'}
                    </span>
                  </td>
                  <td>{formatEstimateTypeLabel(item.estimateType)}</td>
                  <td>{formatRecordedAt(item.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="history-empty-state">
          <strong>
            {status === 'loading'
              ? 'Loading history...'
              : hasActiveFilters
                ? 'No estimates match the current filters.'
                : 'No revealed estimates have been stored yet.'}
          </strong>
          <p>
            {status === 'loading'
              ? 'The page is requesting the current slice from /api/estimation-history.'
              : hasActiveFilters
                ? 'Adjust the filters or reset them to inspect the full history log.'
                : 'Reveal votes in any room and the resulting estimates will appear here.'}
          </p>
        </div>
      ) : null}

      {showErrorState ? (
        <div className="history-empty-state history-empty-state-error">
          <strong>History could not be loaded.</strong>
          <p>
            The API request to /api/estimation-history failed
            {errorCode ? ` with ${errorCode}` : ''}.
          </p>
        </div>
      ) : null}

      {paginationItems.length > 0 ? (
        <div className="history-pagination">
          <button
            className="button-secondary"
            type="button"
            disabled={!pagination.hasPreviousPage}
            onClick={() => {
              onPageChange(pagination.page - 1);
            }}
          >
            Previous
          </button>

          <div className="history-pagination-pages">
            {paginationItems.map((item) => {
              if (item.type === 'ellipsis') {
                return (
                  <span key={item.key} className="history-pagination-ellipsis">
                    ...
                  </span>
                );
              }

              return (
                <button
                  key={item.value}
                  className={
                    item.active
                      ? 'history-page-button history-page-button-active'
                      : 'history-page-button'
                  }
                  type="button"
                  onClick={() => {
                    onPageChange(item.value);
                  }}
                >
                  {item.value}
                </button>
              );
            })}
          </div>

          <button
            className="button-secondary"
            type="button"
            disabled={!pagination.hasNextPage}
            onClick={() => {
              onPageChange(pagination.page + 1);
            }}
          >
            Next
          </button>
        </div>
      ) : null}
    </article>
  );
}

function getStatusLabel({
  data,
  errorCode,
  requestedAt,
  status,
}: {
  data: HistoryResponseDto;
  errorCode: string | null;
  requestedAt: number | null;
  status: HistoryLoadStatus;
}): string {
  if (status === 'loading') {
    return data.items.length
      ? 'Refreshing the current result set...'
      : 'Loading the current history slice...';
  }

  if (status === 'error') {
    return errorCode
      ? `History request failed with ${errorCode}.`
      : 'History request failed.';
  }

  if (!requestedAt) {
    return 'History is ready.';
  }

  return `Updated at ${refreshTimeFormatter.format(requestedAt)}.`;
}
