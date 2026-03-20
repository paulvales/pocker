import { parseHistoryFilters, type PaginationDto } from '@contracts';
import { describe, expect, it } from 'vitest';

import {
  buildHistoryOptionList,
  buildHistorySearchParams,
  createDefaultHistoryFilters,
  getHistoryPaginationItems,
  getHistoryVisibleRange,
} from './historyFilters';

describe('historyFilters', () => {
  it('roundtrips search params through the shared history contract', () => {
    const filters = {
      roomId: 'alpha-room',
      taskId: 'APP-21',
      participantName: 'Viewer',
      estimate: '8',
      estimateType: 'hours',
      recordedOn: '2026-03-20',
      page: 3,
      pageSize: 50,
    };

    expect(parseHistoryFilters(buildHistorySearchParams(filters))).toEqual(filters);
  });

  it('omits default pagination values from the query string', () => {
    expect(buildHistorySearchParams(createDefaultHistoryFilters()).toString()).toBe(
      '',
    );
  });

  it('builds deduplicated filter options and visible ranges', () => {
    expect(
      buildHistoryOptionList(['alpha-room', 'beta-room'], 'alpha-room', [
        'alpha-room',
        'gamma-room',
      ]),
    ).toEqual(['alpha-room', 'beta-room', 'gamma-room']);

    const pagination: PaginationDto = {
      page: 2,
      pageSize: 25,
      totalItems: 60,
      totalPages: 3,
      hasPreviousPage: true,
      hasNextPage: true,
    };

    expect(getHistoryVisibleRange(pagination, 25)).toBe('Showing 26-50');
    expect(getHistoryPaginationItems(pagination)).toEqual([
      { type: 'page', value: 1, active: false },
      { type: 'page', value: 2, active: true },
      { type: 'page', value: 3, active: false },
    ]);
  });
});
