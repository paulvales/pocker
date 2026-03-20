import {
  ESTIMATION_HISTORY_DEFAULT_PAGE,
  ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
  parseHistoryFilters,
  type HistoryFiltersDto,
  type PaginationDto,
} from '@contracts';

const estimateTypeLabels = {
  points: 'Points',
  hours: 'Hours',
} as const;

const recordedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const HISTORY_FALLBACK_ESTIMATE_TYPES = ['points', 'hours'] as const;
export const HISTORY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export type HistoryFilterField = Exclude<
  keyof HistoryFiltersDto,
  'page' | 'pageSize'
>;

export type HistoryPaginationItem =
  | {
      type: 'page';
      value: number;
      active: boolean;
    }
  | {
      type: 'ellipsis';
      key: string;
    };

export function createDefaultHistoryFilters(): HistoryFiltersDto {
  return {
    roomId: '',
    taskId: '',
    participantName: '',
    estimate: '',
    estimateType: '',
    recordedOn: '',
    page: ESTIMATION_HISTORY_DEFAULT_PAGE,
    pageSize: ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
  };
}

export function parseHistorySearchParams(
  searchParams: URLSearchParams,
): HistoryFiltersDto {
  return parseHistoryFilters(searchParams);
}

export function buildHistorySearchParams(
  filters: HistoryFiltersDto,
): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (filters.roomId) {
    searchParams.set('roomId', filters.roomId);
  }

  if (filters.taskId) {
    searchParams.set('taskId', filters.taskId);
  }

  if (filters.participantName) {
    searchParams.set('participantName', filters.participantName);
  }

  if (filters.estimate) {
    searchParams.set('estimate', filters.estimate);
  }

  if (filters.estimateType) {
    searchParams.set('estimateType', filters.estimateType);
  }

  if (filters.recordedOn) {
    searchParams.set('recordedOn', filters.recordedOn);
  }

  if (filters.page !== ESTIMATION_HISTORY_DEFAULT_PAGE) {
    searchParams.set('page', String(filters.page));
  }

  if (filters.pageSize !== ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE) {
    searchParams.set('pageSize', String(filters.pageSize));
  }

  return searchParams;
}

export function toHistoryQueryString(filters: HistoryFiltersDto): string {
  return buildHistorySearchParams(filters).toString();
}

export function hasActiveHistoryFilters(filters: HistoryFiltersDto): boolean {
  return Boolean(
    filters.roomId ||
      filters.taskId ||
      filters.participantName ||
      filters.estimate ||
      filters.estimateType ||
      filters.recordedOn,
  );
}

export function buildHistoryOptionList(
  values: string[],
  selectedValue = '',
  fallbackValues: string[] = [],
): string[] {
  const options: string[] = [];
  const seen = new Set<string>();

  function addOption(candidate: string) {
    const normalizedCandidate = String(candidate ?? '').trim();
    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      return;
    }

    seen.add(normalizedCandidate);
    options.push(normalizedCandidate);
  }

  values.forEach(addOption);
  fallbackValues.forEach(addOption);
  addOption(selectedValue);

  return options;
}

export function formatEstimateTypeLabel(value: string): string {
  if (value === 'points' || value === 'hours') {
    return estimateTypeLabels[value];
  }

  return value || '-';
}

export function formatRecordedAt(value: string): string {
  if (!value) {
    return '-';
  }

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime())) {
    return value;
  }

  return recordedAtFormatter.format(parsedValue);
}

export function getHistoryVisibleRange(
  pagination: PaginationDto,
  itemCount: number,
): string {
  if (!pagination.totalItems || !itemCount) {
    return 'Showing 0-0';
  }

  const rangeStart = (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = rangeStart + itemCount - 1;

  return `Showing ${rangeStart}-${rangeEnd}`;
}

export function getHistoryPaginationItems(
  pagination: PaginationDto,
): HistoryPaginationItem[] {
  if (pagination.totalPages <= 1) {
    return [];
  }

  const items: HistoryPaginationItem[] = [];
  let startPage = Math.max(1, pagination.page - 2);
  const endPage = Math.min(pagination.totalPages, startPage + 4);

  startPage = Math.max(1, endPage - 4);

  if (startPage > 1) {
    items.push({
      type: 'page',
      value: 1,
      active: pagination.page === 1,
    });

    if (startPage > 2) {
      items.push({
        type: 'ellipsis',
        key: 'leading',
      });
    }
  }

  for (let page = startPage; page <= endPage; page += 1) {
    items.push({
      type: 'page',
      value: page,
      active: pagination.page === page,
    });
  }

  if (endPage < pagination.totalPages) {
    if (endPage < pagination.totalPages - 1) {
      items.push({
        type: 'ellipsis',
        key: 'trailing',
      });
    }

    items.push({
      type: 'page',
      value: pagination.totalPages,
      active: pagination.page === pagination.totalPages,
    });
  }

  return items;
}
