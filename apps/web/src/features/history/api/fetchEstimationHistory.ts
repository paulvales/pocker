import {
  createHistoryResponse,
  HTTP_ROUTES,
  type HistoryResponseDto,
} from '@contracts';

export async function fetchEstimationHistory(
  queryString: string,
  signal?: AbortSignal,
): Promise<HistoryResponseDto> {
  const requestUrl = queryString
    ? `${HTTP_ROUTES.estimationHistory}?${queryString}`
    : HTTP_ROUTES.estimationHistory;

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    let errorCode = `HTTP_${response.status}`;

    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        errorCode = payload.error.trim();
      }
    } catch {
      // Keep the HTTP fallback code when the error body is empty or malformed.
    }

    throw new Error(errorCode);
  }

  const payload: unknown = await response.json();
  return createHistoryResponse(payload);
}
