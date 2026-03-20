import type { HistoryFiltersDto } from '@contracts';
import type { FormEvent } from 'react';
import { startTransition, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useEstimationHistory } from '@/features/history/hooks/useEstimationHistory';
import {
  buildHistoryOptionList,
  buildHistorySearchParams,
  createDefaultHistoryFilters,
  HISTORY_FALLBACK_ESTIMATE_TYPES,
  HISTORY_PAGE_SIZE_OPTIONS,
  parseHistorySearchParams,
} from '@/features/history/model/historyFilters';
import { readAppVersionLabel } from '@/shared/appVersion';

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
  const roomOptions = useMemo(
    () => buildHistoryOptionList(data.meta.rooms, filters.roomId),
    [data.meta.rooms, filters.roomId],
  );
  const participantOptions = useMemo(
    () => buildHistoryOptionList(data.meta.participants, filters.participantName),
    [data.meta.participants, filters.participantName],
  );
  const estimateTypeOptions = useMemo(
    () => buildHistoryOptionList(
      data.meta.estimateTypes,
      filters.estimateType,
      [...HISTORY_FALLBACK_ESTIMATE_TYPES],
    ),
    [data.meta.estimateTypes, filters.estimateType],
  );
  const versionLabel = readAppVersionLabel();

  useEffect(() => {
    document.title = 'История оценок';
    document.body.classList.add('history-page-body');
    return () => {
      document.body.classList.remove('history-page-body');
    };
  }, []);

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
      data.meta.pagination.page === filters.page
      && data.meta.pagination.pageSize === filters.pageSize
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

  function updateUrlFilters(nextFilters: HistoryFiltersDto) {
    startTransition(() => {
      setSearchParams(buildHistorySearchParams(nextFilters), { replace: true });
    });
  }

  function handleApply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    updateUrlFilters({
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

  function handleReset() {
    updateUrlFilters(createDefaultHistoryFilters());
  }

  const pagination = data.meta.pagination;
  const totalCount = pagination.totalItems;
  const rangeText = totalCount
    ? `Показано ${(pagination.page - 1) * pagination.pageSize + 1}-${(pagination.page - 1) * pagination.pageSize + data.items.length}`
    : 'Показано 0-0';
  const statusText = status === 'loading'
    ? 'Загрузка...'
    : status === 'error'
      ? `Ошибка${errorCode ? `: ${errorCode}` : ''}`
      : requestedAt
        ? `Обновлено: ${new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(requestedAt)}`
        : 'Готово';

  return (
    <div className="ui container history-shell">
      <div className="history-hero ui clearing basic segment">
        <div>
          <h1 className="ui header">История оценок</h1>
          <p>
            Журнал сохранённых оценок по задачам с фильтрами по комнате,
            задаче, участнику, типу оценки и дате.
          </p>
        </div>
        <div className="history-toolbar">
          <Link className="ui button" to="/">
            <i className="arrow left icon" />
            Назад
          </Link>
          <button
            className="ui primary button"
            id="refreshBtn"
            type="button"
            onClick={() => {
              setRefreshNonce((value) => value + 1);
            }}
          >
            <i className="sync alternate icon" />
            Обновить
          </button>
        </div>
      </div>

      <div className="ui segment history-card">
        <form className="ui form" id="filtersForm" onSubmit={handleApply}>
          <input id="pageFilter" name="page" type="hidden" value={String(filters.page)} readOnly />
          <div className="fields">
            <div className="field">
              <label htmlFor="roomDropdown">Комната</label>
              <select className="ui fluid dropdown" id="roomDropdown" name="roomId" defaultValue={filters.roomId}>
                <option value="">Все</option>
                {roomOptions.map((roomId) => (
                  <option key={roomId} value={roomId}>
                    {roomId}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="taskIdFilter">Ид задачи</label>
              <input id="taskIdFilter" name="taskId" type="text" defaultValue={filters.taskId} placeholder="APP-12" />
            </div>
            <div className="field">
              <label htmlFor="participantDropdown">Участник</label>
              <select
                className="ui fluid dropdown"
                id="participantDropdown"
                name="participantName"
                defaultValue={filters.participantName}
              >
                <option value="">Все</option>
                {participantOptions.map((participantName) => (
                  <option key={participantName} value={participantName}>
                    {participantName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="estimateFilter">Оценка</label>
              <input
                id="estimateFilter"
                name="estimate"
                type="text"
                defaultValue={filters.estimate}
                placeholder="5"
              />
            </div>
            <div className="field">
              <label htmlFor="estimateTypeDropdown">Тип</label>
              <select
                className="ui fluid dropdown"
                id="estimateTypeDropdown"
                name="estimateType"
                defaultValue={filters.estimateType}
              >
                <option value="">Поинты и часы</option>
                {estimateTypeOptions.map((estimateType) => (
                  <option key={estimateType} value={estimateType}>
                    {estimateType === 'hours' ? 'Часы' : estimateType === 'points' ? 'Поинты' : estimateType}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="recordedOnFilter">Дата</label>
              <input
                id="recordedOnFilter"
                name="recordedOn"
                type="date"
                defaultValue={filters.recordedOn}
              />
            </div>
          </div>
          <div className="ui buttons">
            <button className="ui primary button" type="submit">
              Применить
            </button>
            <div className="or" />
            <button
              className="ui button"
              id="resetFiltersBtn"
              type="button"
              onClick={handleReset}
            >
              Сбросить
            </button>
          </div>
        </form>
      </div>

      <div className="ui segment history-card">
        <div className="history-summary">
          <div className="history-summary-main">
            <span>
              Всего записей: <strong id="historyCount">{totalCount}</strong>
            </span>
            <span id="historyRange">{rangeText}</span>
            <span id="historyStatus">{statusText}</span>
          </div>
          <div className="history-page-controls">
            <span>На странице</span>
            <select
              className="ui compact dropdown"
              id="pageSizeDropdown"
              name="pageSize"
              value={String(pagination.pageSize)}
              onChange={(event) => {
                updateUrlFilters({
                  ...filters,
                  page: 1,
                  pageSize: Number(event.target.value),
                });
              }}
            >
              {HISTORY_PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="history-table-wrap">
          <table
            className="ui celled striped table history-table"
            id="historyTable"
            style={{ display: data.items.length ? undefined : 'none' }}
          >
            <thead>
              <tr>
                <th>Комната</th>
                <th>Ид задачи</th>
                <th>Участник</th>
                <th>Оценка</th>
                <th>Тип</th>
                <th>Дата оценки</th>
              </tr>
            </thead>
            <tbody id="historyTableBody">
              {data.items.map((item, index) => (
                <tr
                  key={`${item.taskId}-${item.participantName}-${item.recordedAt}-${index}`}
                >
                  <td>{item.roomId || '-'}</td>
                  <td className="history-task">{item.taskId || '-'}</td>
                  <td>{item.participantName || '-'}</td>
                  <td>
                    <span className="history-estimate">{item.estimate || '-'}</span>
                  </td>
                  <td>{item.estimateType === 'hours' ? 'Часы' : 'Поинты'}</td>
                  <td>{formatRecordedAt(item.recordedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="ui message history-empty"
          id="historyEmptyState"
          style={{ display: data.items.length ? 'none' : undefined }}
        >
          {status === 'error' ? 'Не удалось загрузить историю.' : 'По текущим фильтрам данных нет.'}
        </div>

        <div
          className="history-pagination-wrap"
          id="historyPaginationWrap"
          style={{ display: pagination.totalPages > 1 ? 'flex' : 'none' }}
        >
          <div className="ui pagination menu" id="historyPagination">
            <button
              className={`item${pagination.hasPreviousPage ? '' : ' disabled'}`}
              type="button"
              onClick={() => {
                if (pagination.hasPreviousPage) {
                  updateUrlFilters({ ...filters, page: pagination.page - 1 });
                }
              }}
            >
              Назад
            </button>
            {Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                className={`item${page === pagination.page ? ' active' : ''}`}
                type="button"
                onClick={() => {
                  updateUrlFilters({ ...filters, page });
                }}
              >
                {page}
              </button>
            ))}
            <button
              className={`item${pagination.hasNextPage ? '' : ' disabled'}`}
              type="button"
              onClick={() => {
                if (pagination.hasNextPage) {
                  updateUrlFilters({ ...filters, page: pagination.page + 1 });
                }
              }}
            >
              Вперёд
            </button>
          </div>
        </div>
      </div>

      <div className="footer-note">{versionLabel ? `v ${versionLabel}` : 'v'}</div>
    </div>
  );
}

function readFormDataText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function formatRecordedAt(value: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
