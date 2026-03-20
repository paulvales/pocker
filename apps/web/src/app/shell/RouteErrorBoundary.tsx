import { useRouteError } from 'react-router-dom';

import { AppShell } from '@/app/shell/AppShell';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : 'Unexpected route failure';

  return (
    <AppShell>
      <div className="ui container" style={{ padding: '2rem 1rem' }}>
        <div className="ui negative message">
          <div className="header">Ошибка маршрута</div>
          <p>Экран не удалось отрисовать.</p>
          <pre className="route-error-pre">{message}</pre>
        </div>
      </div>
    </AppShell>
  );
}
