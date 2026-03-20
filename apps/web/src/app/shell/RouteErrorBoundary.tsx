import { useRouteError } from 'react-router-dom';

import { AppShell } from '@/app/shell/AppShell';

export function RouteErrorBoundary() {
  const error = useRouteError();
  const message =
    error instanceof Error ? error.message : 'Unexpected route failure';

  return (
    <AppShell>
      <section className="panel panel-error">
        <p className="eyebrow">Routing Error</p>
        <h1>Foundation route crashed</h1>
        <p className="lead">
          The page shell is mounted correctly, but this route still needs
          implementation hardening.
        </p>
        <pre className="error-details">{message}</pre>
      </section>
    </AppShell>
  );
}
