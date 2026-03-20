import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the SaaS bootstrap snapshot from the settings API', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          actor: {
            id: 'owner-user',
            name: 'Workspace owner',
            email: 'owner@example.com',
            kind: 'member',
            role: 'owner',
            permissions: ['settings:read', 'rooms:create'],
          },
          workspace: {
            id: 'workspace-core',
            slug: 'core',
            name: 'Pocker Core Workspace',
            guestMode: 'open',
            roomCreationMode: 'member_or_guest',
            guestAdminMode: 'guest_or_member',
            billingReady: true,
          },
          memberships: [
            {
              userId: 'owner-user',
              name: 'Workspace owner',
              email: 'owner@example.com',
              role: 'owner',
              status: 'active',
            },
          ],
          invites: [
            {
              id: 'invite-1',
              code: 'TEAM-ACCESS',
              kind: 'workspace_member',
              role: 'member',
              status: 'active',
              workspaceId: 'workspace-core',
              roomId: null,
            },
          ],
          rooms: [
            {
              id: 'alpha-room',
              workspaceId: 'workspace-core',
              ownerUserId: 'owner-user',
              ownerType: 'member',
              visibility: 'workspace',
              guestMode: 'open',
              createdAt: '2026-03-20T12:00:00.000Z',
            },
          ],
          billing: {
            plan: 'free',
            status: 'ready',
            billingContactEmail: 'billing@example.com',
            seatLimit: 25,
            seatsUsed: 3,
            meteredFeatures: ['active_rooms'],
          },
          authorization: {
            canManageWorkspace: true,
            canManageMembers: true,
            canManageBilling: true,
            canManageRooms: true,
          },
          settingsSections: [
            {
              id: 'workspace',
              title: 'Workspace',
              description: 'Tenant identity and policies.',
              status: 'available',
            },
          ],
        }),
    } as Response);

    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Pocker Core Workspace');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/bootstrap',
      expect.any(Object),
    );
    expect(screen.getByText('/alpha-room')).toBeInTheDocument();
    expect(screen.getAllByText('Workspace owner')).toHaveLength(2);
    expect(screen.getByText('TEAM-ACCESS')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('active_rooms')).toBeInTheDocument();
    });
  });
});
