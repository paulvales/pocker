import type { PropsWithChildren } from 'react';

export function AppShell({ children }: PropsWithChildren) {
  return <main className="app-main">{children}</main>;
}
