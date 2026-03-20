import { useState } from 'react';

import {
  type BillingSummaryDto,
  type SettingsSectionDto,
  type WorkspaceInviteDto,
  type WorkspaceMembershipDto,
  type WorkspaceRoomDto,
} from '@contracts';

import {
  useSaasBootstrap,
  type SettingsLoadStatus,
} from '@/features/settings/hooks/useSaasBootstrap';

const refreshTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function SettingsPage() {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { data, status, errorCode, requestedAt } = useSaasBootstrap(refreshNonce);
  const restrictedSections = data.settingsSections.filter(
    (section) => section.status === 'restricted',
  ).length;
  const statusMessage = getStatusMessage(status, errorCode, requestedAt);

  return (
    <section className="page-grid settings-page-grid">
      <article className="panel panel-stage settings-hero-panel">
        <div className="settings-hero-copy">
          <p className="eyebrow">APP-22</p>
          <h2>SaaS domain foundation is now visible inside the React shell.</h2>
          <p className="lead">
            The page reads <code>/api/settings/bootstrap</code> and surfaces the
            workspace, memberships, invites, room ownership metadata and billing
            readiness through the same frontend architecture as the room and
            history flows.
          </p>
        </div>

        <div className="hero-actions">
          <button
            className="button-primary"
            type="button"
            onClick={() => {
              setRefreshNonce((value) => value + 1);
            }}
          >
            Refresh settings
          </button>
        </div>
      </article>

      <article className="panel settings-summary-panel">
        <div className="settings-summary-header">
          <div>
            <p className="eyebrow">Tenant snapshot</p>
            <h2>{data.workspace.name || 'Workspace is loading'}</h2>
            <p className="field-help settings-status-copy">{statusMessage}</p>
          </div>

          <div className="settings-identity-badge">
            <span className="status-label">Actor</span>
            <strong>{data.actor.name || 'Unknown actor'}</strong>
            <span className="field-help">
              {data.actor.kind}
              {data.actor.role ? ` / ${data.actor.role}` : ''}
            </span>
          </div>
        </div>

        <div className="settings-stat-grid">
          <div className="settings-stat-card">
            <span className="status-label">Workspace slug</span>
            <strong>{data.workspace.slug || '-'}</strong>
          </div>
          <div className="settings-stat-card">
            <span className="status-label">Members</span>
            <strong>{data.memberships.length}</strong>
          </div>
          <div className="settings-stat-card">
            <span className="status-label">Invites</span>
            <strong>{data.invites.length}</strong>
          </div>
          <div className="settings-stat-card">
            <span className="status-label">Room catalog</span>
            <strong>{data.rooms.length}</strong>
          </div>
          <div className="settings-stat-card">
            <span className="status-label">Billing plan</span>
            <strong>{data.billing.plan || '-'}</strong>
          </div>
          <div className="settings-stat-card">
            <span className="status-label">Restricted sections</span>
            <strong>{restrictedSections}</strong>
          </div>
        </div>
      </article>

      <div className="settings-two-column-grid">
        <article className="panel settings-policy-panel">
          <p className="eyebrow">Workspace policy</p>
          <h2>Tenant boundaries</h2>
          <dl className="settings-definition-list">
            <div>
              <dt>Guest access</dt>
              <dd>{data.workspace.guestMode || '-'}</dd>
            </div>
            <div>
              <dt>Room creation</dt>
              <dd>{data.workspace.roomCreationMode || '-'}</dd>
            </div>
            <div>
              <dt>Guest admin</dt>
              <dd>{data.workspace.guestAdminMode || '-'}</dd>
            </div>
            <div>
              <dt>Billing ready</dt>
              <dd>{data.workspace.billingReady ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        </article>

        <article className="panel settings-policy-panel">
          <p className="eyebrow">Authorization</p>
          <h2>Server-side permissions</h2>
          <div className="settings-permission-grid">
            <PermissionTile
              label="Manage workspace"
              enabled={data.authorization.canManageWorkspace}
            />
            <PermissionTile
              label="Manage members"
              enabled={data.authorization.canManageMembers}
            />
            <PermissionTile
              label="Manage billing"
              enabled={data.authorization.canManageBilling}
            />
            <PermissionTile
              label="Manage rooms"
              enabled={data.authorization.canManageRooms}
            />
          </div>

          <div className="settings-tag-row">
            {data.actor.permissions.length ? (
              data.actor.permissions.map((permission) => (
                <span key={permission} className="settings-tag">
                  {permission}
                </span>
              ))
            ) : (
              <span className="field-help">
                This actor does not expose any explicit workspace permissions.
              </span>
            )}
          </div>
        </article>
      </div>

      <div className="settings-two-column-grid">
        <article className="panel settings-list-panel">
          <p className="eyebrow">Memberships</p>
          <h2>Workspace roles</h2>
          <ul className="settings-list">
            {data.memberships.length ? (
              data.memberships.map((membership) => (
                <MembershipRow key={membership.userId} membership={membership} />
              ))
            ) : (
              <li className="settings-list-empty">
                Memberships will appear here once the tenant model is seeded.
              </li>
            )}
          </ul>
        </article>

        <article className="panel settings-list-panel">
          <p className="eyebrow">Invites</p>
          <h2>Invite and guest model</h2>
          <ul className="settings-list">
            {data.invites.length ? (
              data.invites.map((invite) => (
                <InviteRow key={invite.id} invite={invite} />
              ))
            ) : (
              <li className="settings-list-empty">
                Invite policies have not been seeded yet.
              </li>
            )}
          </ul>
        </article>
      </div>

      <article className="panel settings-rooms-panel">
        <div className="settings-panel-header">
          <div>
            <p className="eyebrow">Room catalog</p>
            <h2>Ownership and persistent room metadata</h2>
          </div>
        </div>

        {data.rooms.length ? (
          <div className="settings-room-grid">
            {data.rooms.map((room) => (
              <RoomMetadataCard key={room.id} room={room} />
            ))}
          </div>
        ) : (
          <div className="settings-empty-state">
            <strong>No room metadata has been registered yet.</strong>
            <p>
              Create or join a room through the realtime flow and the workspace
              catalog will start tracking owner and visibility metadata.
            </p>
          </div>
        )}
      </article>

      <div className="settings-two-column-grid">
        <article className="panel settings-policy-panel">
          <p className="eyebrow">Billing</p>
          <h2>Billing-ready boundaries</h2>
          <BillingSummaryCard billing={data.billing} />
        </article>

        <article className="panel settings-list-panel">
          <p className="eyebrow">Settings surface</p>
          <h2>Section readiness</h2>
          <ul className="settings-section-list">
            {data.settingsSections.length ? (
              data.settingsSections.map((section) => (
                <SettingsSectionRow key={section.id} section={section} />
              ))
            ) : (
              <li className="settings-list-empty">
                Settings sections will appear once the workspace surface is
                configured.
              </li>
            )}
          </ul>
        </article>
      </div>
    </section>
  );
}

function MembershipRow({ membership }: { membership: WorkspaceMembershipDto }) {
  return (
    <li className="settings-list-row">
      <div>
        <strong>{membership.name || membership.userId}</strong>
        <p>{membership.email || 'Email is not set'}</p>
      </div>

      <div className="settings-meta-stack">
        <span className="settings-pill">{membership.role}</span>
        <span className="field-help">{membership.status}</span>
      </div>
    </li>
  );
}

function InviteRow({ invite }: { invite: WorkspaceInviteDto }) {
  return (
    <li className="settings-list-row">
      <div>
        <strong>{invite.code}</strong>
        <p>
          {invite.kind} / {invite.role}
          {invite.roomId ? ` / room ${invite.roomId}` : ''}
        </p>
      </div>

      <div className="settings-meta-stack">
        <span className="settings-pill settings-pill-muted">{invite.status}</span>
        <span className="field-help">{invite.workspaceId}</span>
      </div>
    </li>
  );
}

function RoomMetadataCard({ room }: { room: WorkspaceRoomDto }) {
  return (
    <article className="settings-room-card">
      <div className="settings-room-header">
        <strong>/{room.id}</strong>
        <span className="settings-pill">{room.ownerType}</span>
      </div>

      <dl className="settings-definition-list settings-definition-list-compact">
        <div>
          <dt>Workspace</dt>
          <dd>{room.workspaceId}</dd>
        </div>
        <div>
          <dt>Owner user</dt>
          <dd>{room.ownerUserId || 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{room.visibility}</dd>
        </div>
        <div>
          <dt>Guest mode</dt>
          <dd>{room.guestMode}</dd>
        </div>
        <div>
          <dt>Created at</dt>
          <dd>{formatTimestamp(room.createdAt)}</dd>
        </div>
      </dl>
    </article>
  );
}

function BillingSummaryCard({ billing }: { billing: BillingSummaryDto }) {
  return (
    <>
      <dl className="settings-definition-list">
        <div>
          <dt>Plan</dt>
          <dd>{billing.plan}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{billing.status}</dd>
        </div>
        <div>
          <dt>Billing contact</dt>
          <dd>{billing.billingContactEmail || 'Not configured'}</dd>
        </div>
        <div>
          <dt>Seats</dt>
          <dd>
            {billing.seatsUsed} / {billing.seatLimit}
          </dd>
        </div>
      </dl>

      <div className="settings-tag-row">
        {billing.meteredFeatures.length ? (
          billing.meteredFeatures.map((feature) => (
            <span key={feature} className="settings-tag">
              {feature}
            </span>
          ))
        ) : (
          <span className="field-help">No metered features are configured yet.</span>
        )}
      </div>
    </>
  );
}

function SettingsSectionRow({ section }: { section: SettingsSectionDto }) {
  return (
    <li className="settings-list-row settings-list-row-section">
      <div>
        <strong>{section.title}</strong>
        <p>{section.description}</p>
      </div>
      <span className={`settings-pill settings-pill-${section.status}`}>
        {section.status}
      </span>
    </li>
  );
}

function PermissionTile({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <div className={enabled ? 'settings-permission-tile is-enabled' : 'settings-permission-tile'}>
      <span className="status-label">{label}</span>
      <strong>{enabled ? 'allowed' : 'restricted'}</strong>
    </div>
  );
}

function getStatusMessage(
  status: SettingsLoadStatus,
  errorCode: string | null,
  requestedAt: number | null,
): string {
  if (status === 'loading') {
    return 'Loading the current workspace snapshot...';
  }

  if (status === 'error') {
    return errorCode
      ? `Settings bootstrap failed with ${errorCode}.`
      : 'Settings bootstrap failed.';
  }

  if (!requestedAt) {
    return 'Settings are ready.';
  }

  return `Updated at ${refreshTimeFormatter.format(requestedAt)}.`;
}

function formatTimestamp(value: string): string {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}
