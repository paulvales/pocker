import {
  createSaasBootstrapPayload,
  HTTP_ROUTES,
  type SaasBootstrapDto,
} from '@contracts';

export async function fetchSaasBootstrap(
  signal?: AbortSignal,
): Promise<SaasBootstrapDto> {
  const response = await fetch(HTTP_ROUTES.settingsBootstrap, {
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
  return createSaasBootstrapPayload(payload);
}
