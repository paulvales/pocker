import {
  createSaasBootstrapPayload,
  type SaasBootstrapDto,
} from '@contracts';
import { useEffect, useState } from 'react';

import { fetchSaasBootstrap } from '@/features/settings/api/fetchSaasBootstrap';

export type SettingsLoadStatus = 'loading' | 'success' | 'error';

type SettingsLoadState = {
  completedRequestKey: string | null;
  status: Exclude<SettingsLoadStatus, 'loading'>;
  data: SaasBootstrapDto;
  errorCode: string | null;
  requestedAt: number | null;
};

export function useSaasBootstrap(refreshNonce = 0): SettingsLoadState {
  const [state, setState] = useState<SettingsLoadState>(() => ({
    completedRequestKey: null,
    status: 'success',
    data: createSaasBootstrapPayload(),
    errorCode: null,
    requestedAt: null,
  }));
  const requestKey = String(refreshNonce);

  useEffect(() => {
    const abortController = new AbortController();

    void fetchSaasBootstrap(abortController.signal)
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
  }, [requestKey]);

  if (state.completedRequestKey !== requestKey) {
    return {
      ...state,
      status: 'loading',
      errorCode: null,
    };
  }

  return state;
}
