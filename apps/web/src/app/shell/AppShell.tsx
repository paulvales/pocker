import type { PropsWithChildren } from 'react';
import { Link, NavLink } from 'react-router-dom';

type AppShellProps = PropsWithChildren;

const navItems = [
  { to: '/', label: 'Overview', end: true },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <Link className="brand-mark" to="/">
            PK
          </Link>
          <div className="brand-copy">
            <p className="eyebrow">Planning Poker</p>
            <h1>Pocker</h1>
          </div>
        </div>
        <nav className="app-nav" aria-label="Primary">
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link-active' : 'nav-link'
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app-main">{children}</main>
    </div>
  );
}
