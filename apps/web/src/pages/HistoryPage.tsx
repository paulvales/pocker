import type { HistoryFiltersDto } from '@contracts';
import { startTransition, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { HistoryFiltersPanel } from '@/features/history/components/HistoryFiltersPanel';
import { HistoryResultsPanel } from '@/features/history/components/HistoryResultsPanel';
import { useEstimationHistory } from '@/features/history/hooks/useEstimationHistory';
import {
  buildHistoryOptionList,
  buildHistorySearchParams,
  createDefaultHistoryFilters,
  HISTORY_FALLBACK_ESTIMATE_TYPES,
  parseHistorySearchParams,
} from '@/features/history/model/historyFilters';

export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [refreshNonce, setRefreshNonce] = useState(0);
  const filters = parseHistorySearchParams(searchParams);
  const { data, status, errorCode, requestedAt } = useEstimationHistory(
    filters,
    refreshNonce,
  );
  const canonicalSearch = buildHistorySearchParams(filters).toString();
  const currentSearch = searchParams.toString();

  useEffect(() => {
    if (currentSearch === canonicalSearch) {
      return;
    }

    startTransition(() => {
      setSearchParams(canonicalSearch, { replace: true });
    });
  }, [canonicalSearch, currentSearch, setSearchParams]);

  useEffect(() => {
    if (status !== 'success') {
      return;
    }

    if (
      data.meta.pagination.page === filters.page &&
      data.meta.pagination.pageSize === filters.pageSize
    ) {
      return;
    }

    startTransition(() => {
      setSearchParams(
        buildHistorySearchParams({
          roomId: filters.roomId,
          taskId: filters.taskId,
          participantName: filters.participantName,
          estimate: filters.estimate,
          estimateType: filters.estimateType,
          recordedOn: filters.recordedOn,
          page: data.meta.pagination.page,
          pageSize: data.meta.pagination.pageSize,
        }),
        { replace: true },
      );
    });
  }, [
    data.meta.pagination.page,
    data.meta.pagination.pageSize,
    filters.estimate,
    filters.estimateType,
    filters.page,
    filters.pageSize,
    filters.participantName,
    filters.recordedOn,
    filters.roomId,
    filters.taskId,
    setSearchParams,
    status,
  ]);

  const roomOptions = buildHistoryOptionList(data.meta.rooms, filters.roomId);
  const participantOptions = buildHistoryOptionList(
    data.meta.participants,
    filters.participantName,
  );
  const estimateTypeOptions = buildHistoryOptionList(
    data.meta.estimateTypes,
    filters.estimateType,
    [...HISTORY_FALLBACK_ESTIMATE_TYPES],
  );

  function updateUrlFilters(nextFilters: HistoryFiltersDto) {
    startTransition(() => {
      setSearchParams(buildHistorySearchParams(nextFilters), { replace: true });
    });
  }

  function handleApply(nextFilters: HistoryFiltersDto) {
    updateUrlFilters({
      roomId: nextFilters.roomId,
      taskId: nextFilters.taskId,
      participantName: nextFilters.participantName,
      estimate: nextFilters.estimate,
      estimateType: nextFilters.estimateType,
      recordedOn: nextFilters.recordedOn,
      page: nextFilters.page,
      pageSize: nextFilters.pageSize,
    });
  }

  function handleReset() {
    updateUrlFilters(createDefaultHistoryFilters());
  }

  function handlePageChange(page: number) {
    if (page === filters.page) {
      return;
    }

    updateUrlFilters({
      ...filters,
      page,
    });
  }

  function handlePageSizeChange(pageSize: number) {
    if (pageSize === filters.pageSize) {
      return;
    }

    updateUrlFilters({
      ...filters,
      page: 1,
      pageSize,
    });
  }

  return (
    <section className="page-grid">
      <article className="panel panel-stage history-hero-panel">
        <div className="history-hero-copy">
          <p className="eyebrow">APP-20</p>
          <h2>Estimate history now lives inside the React shell.</h2>
          <p className="lead">
            The page reads <code>/api/estimation-history</code>, syncs filters
            with the URL and keeps pagination inside the same frontend
            architecture as the room flow.
          </p>
        </div>

        <div className="hero-actions">
          <Link className="button-secondary" to="/">
            Back to overview
          </Link>
          <button
            className="button-primary"
            type="button"
            onClick={() => {
              setRefreshNonce((value) => value + 1);
            }}
          >
            Refresh history
          </button>
        </div>
      </article>

      <HistoryFiltersPanel
        key={canonicalSearch || 'history-default-filters'}
        filters={filters}
        roomOptions={roomOptions}
        participantOptions={participantOptions}
        estimateTypeOptions={estimateTypeOptions}
        onApply={handleApply}
        onReset={handleReset}
      />

      <HistoryResultsPanel
        data={data}
        filters={filters}
        status={status}
        errorCode={errorCode}
        requestedAt={requestedAt}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    </section>
  );
}
