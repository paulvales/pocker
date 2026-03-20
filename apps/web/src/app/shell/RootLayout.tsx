import { Outlet } from 'react-router-dom';

import { AppShell } from '@/app/shell/AppShell';

export function RootLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
