import {
  createHistoryResponse,
  type HistoryFiltersDto,
  type HistoryResponseDto,
} from '@contracts';
import { useEffect, useState } from 'react';

import { fetchEstimationHistory } from '@/features/history/api/fetchEstimationHistory';
import { toHistoryQueryString } from '@/features/history/model/historyFilters';

export type HistoryLoadStatus = 'loading' | 'success' | 'error';

type HistoryLoadState = {
  completedRequestKey: string | null;
  status: Exclude<HistoryLoadStatus, 'loading'>;
  data: HistoryResponseDto;
  errorCode: string | null;
  requestedAt: number | null;
};

export function useEstimationHistory(
  filters: HistoryFiltersDto,
  refreshNonce = 0,
): HistoryLoadState {
  const [state, setState] = useState<HistoryLoadState>(() => ({
    completedRequestKey: null,
    status: 'success',
    data: createHistoryResponse(),
    errorCode: null,
    requestedAt: null,
  }));
  const queryString = toHistoryQueryString(filters);
  const requestKey = `${queryString}::${refreshNonce}`;

  useEffect(() => {
    const abortController = new AbortController();

    void fetchEstimationHistory(queryString, abortController.signal)
      .then((data) => {
        setState({
          completedRequestKey: requestKey,
          status: 'success',
          data,
          errorCode: null,
          requestedAt: Date.now(),
        });
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }

        setState((previousState) => ({
          ...previousState,
          completedRequestKey: requestKey,
          status: 'error',
          errorCode:
            error instanceof Error && error.message
              ? error.message
              : 'UNKNOWN_ERROR',
          requestedAt: Date.now(),
        }));
      });

    return () => {
      abortController.abort();
    };
  }, [queryString, requestKey]);

  if (state.completedRequestKey !== requestKey) {
    return {
      ...state,
      status: 'loading',
      errorCode: null,
    };
  }

  return state;
}
