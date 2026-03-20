const {
    ERROR_CODES,
    createSaasBootstrapPayload,
} = require('../../../../../packages/contracts');

const DEFAULT_SETTINGS_SECTIONS = Object.freeze([
    {
        id: 'workspace',
        title: 'Workspace',
        description: 'Tenant identity, room policies and ownership boundaries.',
        status: 'available',
    },
    {
        id: 'members',
        title: 'Members',
        description: 'Membership roles, invitations and server-side access control.',
        status: 'available',
    },
    {
        id: 'access',
        title: 'Guest access',
        description: 'Guest policies, invite model and admin seat restrictions.',
        status: 'available',
    },
    {
        id: 'rooms',
        title: 'Rooms',
        description: 'Workspace-owned room catalog and room metadata foundation.',
        status: 'available',
    },
    {
        id: 'billing',
        title: 'Billing',
        description: 'Plan boundaries and billing-ready tenant metadata.',
        status: 'available',
    },
    {
        id: 'integrations',
        title: 'Integrations',
        description: 'Settings surface is ready for YouTrack and future SaaS extensions.',
        status: 'planned',
    },
]);

const DEFAULT_METERED_FEATURES = Object.freeze([
    'active_rooms',
    'estimation_history',
    'integrations',
]);

function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeNullableText(value) {
    const normalizedValue = normalizeText(value);
    return normalizedValue || null;
}

function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        if (typeof value === 'string') {
            return [...new Set(value
                .split(',')
                .map(item => normalizeText(item))
                .filter(Boolean))];
        }

        return [];
    }

    return [...new Set(value
        .map(item => normalizeText(item))
        .filter(Boolean))];
}

function normalizePositiveInteger(value, fallback, { min = 0 } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, parsed);
}

function normalizeWorkspaceRole(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (
        normalizedValue === 'owner'
        || normalizedValue === 'admin'
        || normalizedValue === 'billing'
    ) {
        return normalizedValue;
    }

    return 'member';
}

function normalizeOptionalWorkspaceRole(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (
        normalizedValue === 'owner'
        || normalizedValue === 'admin'
        || normalizedValue === 'member'
        || normalizedValue === 'billing'
    ) {
        return normalizedValue;
    }

    return null;
}

function normalizeMemberKind(value) {
    return normalizeText(value).toLowerCase() === 'guest' ? 'guest' : 'member';
}

function normalizeOptionalMemberKind(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (normalizedValue === 'member' || normalizedValue === 'guest') {
        return normalizedValue;
    }

    return null;
}

function normalizeMembershipStatus(value) {
    return normalizeText(value).toLowerCase() === 'invited' ? 'invited' : 'active';
}

function normalizeGuestMode(value) {
    return normalizeText(value).toLowerCase() === 'invite_only' ? 'invite_only' : 'open';
}

function normalizeRoomCreationMode(value) {
    return normalizeText(value).toLowerCase() === 'member_only'
        ? 'member_only'
        : 'member_or_guest';
}

function normalizeGuestAdminMode(value) {
    return normalizeText(value).toLowerCase() === 'member_only'
        ? 'member_only'
        : 'guest_or_member';
}

function normalizeInviteKind(value) {
    return normalizeText(value).toLowerCase() === 'workspace_member'
        ? 'workspace_member'
        : 'room_guest';
}

function normalizeInviteRole(value) {
    return normalizeText(value).toLowerCase() === 'member' ? 'member' : 'guest';
}

function normalizeInviteStatus(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (normalizedValue === 'revoked' || normalizedValue === 'expired') {
        return normalizedValue;
    }

    return 'active';
}

function normalizeRoomVisibility(value) {
    return normalizeText(value).toLowerCase() === 'workspace'
        ? 'workspace'
        : 'guest_link';
}

function normalizeBillingPlan(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (normalizedValue === 'team' || normalizedValue === 'enterprise') {
        return normalizedValue;
    }

    return 'free';
}

function normalizeBillingStatus(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (
        normalizedValue === 'trialing'
        || normalizedValue === 'active'
        || normalizedValue === 'past_due'
        || normalizedValue === 'inactive'
    ) {
        return normalizedValue;
    }

    return 'ready';
}

function createWorkspace(config) {
    const workspace = asRecord(config);

    return {
        id: normalizeText(workspace.id) || 'workspace-core',
        slug: normalizeText(workspace.slug) || 'core',
        name: normalizeText(workspace.name) || 'Core Workspace',
        guestMode: normalizeGuestMode(workspace.guestMode),
        roomCreationMode: normalizeRoomCreationMode(workspace.roomCreationMode),
        guestAdminMode: normalizeGuestAdminMode(workspace.guestAdminMode),
        billingReady: normalizeText(workspace.billingReady) === ''
            ? true
            : normalizeBoolean(workspace.billingReady),
    };
}

function createDefaultActor(config) {
    const actor = asRecord(config);

    return {
        id: normalizeText(actor.id) || 'owner-user',
        name: normalizeText(actor.name) || 'Workspace owner',
        email: normalizeNullableText(actor.email),
        kind: normalizeMemberKind(actor.kind),
        role: normalizeWorkspaceRole(actor.role || 'owner'),
    };
}

function createMembershipList(config, workspace, defaultActor) {
    const inputMemberships = Array.isArray(config) ? config : [];
    const membershipSeeds = inputMemberships.length
        ? inputMemberships
        : [
            {
                userId: defaultActor.id,
                name: defaultActor.name,
                email: defaultActor.email,
                role: defaultActor.role,
                status: 'active',
            },
            {
                userId: 'delivery-admin',
                name: 'Delivery Admin',
                email: 'delivery@example.com',
                role: 'admin',
                status: 'active',
            },
            {
                userId: 'team-member',
                name: 'Team Member',
                email: 'member@example.com',
                role: 'member',
                status: 'active',
            },
            {
                userId: 'billing-owner',
                name: 'Billing Owner',
                email: 'billing@example.com',
                role: 'billing',
                status: 'invited',
            },
        ];

    const memberships = membershipSeeds
        .map((membership, index) => {
            const payload = asRecord(membership);
            const userId = normalizeText(payload.userId) || `workspace-member-${index + 1}`;

            return {
                userId,
                name: normalizeText(payload.name) || userId,
                email: normalizeNullableText(payload.email),
                role: normalizeWorkspaceRole(payload.role),
                status: normalizeMembershipStatus(payload.status),
                workspaceId: workspace.id,
            };
        });

    if (!memberships.some(membership => membership.userId === defaultActor.id)) {
        memberships.unshift({
            userId: defaultActor.id,
            name: defaultActor.name,
            email: defaultActor.email,
            role: defaultActor.role,
            status: 'active',
            workspaceId: workspace.id,
        });
    }

    return memberships;
}

function createInviteList(config, workspace) {
    const inputInvites = Array.isArray(config) ? config : [];
    const inviteSeeds = inputInvites.length
        ? inputInvites
        : [
            {
                id: `${workspace.id}-member-invite`,
                code: 'TEAM-ACCESS',
                kind: 'workspace_member',
                role: 'member',
                status: 'active',
                roomId: null,
            },
            {
                id: `${workspace.id}-guest-invite`,
                code: 'GUEST-ROOM',
                kind: 'room_guest',
                role: 'guest',
                status: 'active',
                roomId: null,
            },
        ];

    return inviteSeeds.map((invite, index) => {
        const payload = asRecord(invite);

        return {
            id: normalizeText(payload.id) || `${workspace.id}-invite-${index + 1}`,
            code: normalizeText(payload.code) || `INVITE-${index + 1}`,
            kind: normalizeInviteKind(payload.kind),
            role: normalizeInviteRole(payload.role),
            status: normalizeInviteStatus(payload.status),
            workspaceId: workspace.id,
            roomId: normalizeNullableText(payload.roomId),
        };
    });
}

function createBillingSummary(config, memberships) {
    const billing = asRecord(config);
    const seatLimit = normalizePositiveInteger(billing.seatLimit, 25, { min: 1 });
    const seatsUsed = memberships.filter(membership => membership.status === 'active').length;

    return {
        plan: normalizeBillingPlan(billing.plan),
        status: normalizeBillingStatus(billing.status),
        billingContactEmail: normalizeNullableText(billing.billingContactEmail),
        seatLimit,
        seatsUsed,
        meteredFeatures: normalizeStringArray(billing.meteredFeatures).length
            ? normalizeStringArray(billing.meteredFeatures)
            : [...DEFAULT_METERED_FEATURES],
    };
}

function createRoomDefaults(config, workspace) {
    const roomDefaults = asRecord(config);

    return {
        visibility: normalizeRoomVisibility(roomDefaults.visibility || 'workspace'),
        guestMode: normalizeGuestMode(roomDefaults.guestMode || workspace.guestMode),
    };
}

function createSettingsSectionSeeds(config) {
    const sections = Array.isArray(config) ? config : [];
    if (!sections.length) {
        return [...DEFAULT_SETTINGS_SECTIONS];
    }

    return sections.map((section, index) => {
        const payload = asRecord(section);

        return {
            id: normalizeText(payload.id) || `settings-section-${index + 1}`,
            title: normalizeText(payload.title) || `Section ${index + 1}`,
            description: normalizeText(payload.description),
            status: normalizeText(payload.status).toLowerCase() || 'available',
        };
    });
}

function readHeader(headers, name) {
    const normalizedHeaders = asRecord(headers);
    const targetName = String(name || '').toLowerCase();

    for (const [key, value] of Object.entries(normalizedHeaders)) {
        if (String(key).toLowerCase() !== targetName) {
            continue;
        }

        if (Array.isArray(value)) {
            return normalizeText(value[0]);
        }

        return normalizeText(value);
    }

    return '';
}

function buildAuthorization(actor) {
    if (actor.kind !== 'member') {
        return {
            canManageWorkspace: false,
            canManageMembers: false,
            canManageBilling: false,
            canManageRooms: false,
        };
    }

    return {
        canManageWorkspace: actor.role === 'owner' || actor.role === 'admin',
        canManageMembers: actor.role === 'owner' || actor.role === 'admin',
        canManageBilling: actor.role === 'owner' || actor.role === 'billing',
        canManageRooms: actor.role === 'owner'
            || actor.role === 'admin'
            || actor.role === 'member',
    };
}

function buildPermissions(actor, authorization) {
    const permissions = new Set();

    if (actor.kind === 'guest') {
        permissions.add('rooms:join');
        return [...permissions];
    }

    permissions.add('settings:read');
    permissions.add('rooms:join');

    if (authorization.canManageRooms) {
        permissions.add('rooms:create');
        permissions.add('rooms:manage');
    }

    if (authorization.canManageWorkspace) {
        permissions.add('workspace:manage');
    }

    if (authorization.canManageMembers) {
        permissions.add('members:manage');
    }

    if (authorization.canManageBilling) {
        permissions.add('billing:manage');
    }

    return [...permissions];
}

function createGuestActor(source) {
    const connectionId = normalizeText(source.connectionId);
    const actorId = normalizeText(source.actorId)
        || (connectionId ? `guest-${connectionId}` : 'guest-user');

    return {
        id: actorId,
        name: normalizeText(source.actorName) || 'Guest participant',
        email: normalizeNullableText(source.actorEmail),
        kind: 'guest',
        role: null,
    };
}

function buildSettingsSections(sectionSeeds, authorization) {
    return sectionSeeds.map(section => {
        let status = section.status;

        if (section.id === 'workspace' && !authorization.canManageWorkspace) {
            status = 'restricted';
        }
        if (section.id === 'members' && !authorization.canManageMembers) {
            status = 'restricted';
        }
        if (section.id === 'billing' && !authorization.canManageBilling) {
            status = 'restricted';
        }
        if (section.id === 'rooms' && !authorization.canManageRooms) {
            status = 'restricted';
        }

        return {
            ...section,
            status,
        };
    });
}

function createSaasFoundationService({ config = {} } = {}) {
    const saasConfig = asRecord(config.saas);
    const workspace = createWorkspace(saasConfig.workspace);
    const defaultActor = createDefaultActor(saasConfig.defaultActor);
    const memberships = createMembershipList(saasConfig.memberships, workspace, defaultActor);
    const invites = createInviteList(saasConfig.invites, workspace);
    const billing = createBillingSummary(saasConfig.billing, memberships);
    const roomDefaults = createRoomDefaults(saasConfig.roomDefaults, workspace);
    const settingsSectionSeeds = createSettingsSectionSeeds(saasConfig.settingsSections);
    const roomCatalog = new Map();

    function findMembership(userId) {
        return memberships.find(membership => membership.userId === userId) || null;
    }

    function hasActiveInvite(inviteCode, roomId) {
        const normalizedCode = normalizeText(inviteCode);
        if (!normalizedCode) {
            return false;
        }

        return invites.some(invite => invite.status === 'active'
            && invite.code === normalizedCode
            && invite.workspaceId === workspace.id
            && (invite.kind === 'workspace_member' || invite.roomId === null || invite.roomId === roomId));
    }

    function resolveContext(source = {}) {
        const authSource = asRecord(source);
        const requestedWorkspaceId = normalizeText(authSource.workspaceId);
        const requestedWorkspaceSlug = normalizeText(authSource.workspaceSlug);

        if (
            (requestedWorkspaceId && requestedWorkspaceId !== workspace.id)
            || (requestedWorkspaceSlug && requestedWorkspaceSlug !== workspace.slug)
        ) {
            throw new Error(ERROR_CODES.workspaceNotFound);
        }

        const explicitActorId = normalizeText(authSource.actorId);
        const explicitActorKind = normalizeOptionalMemberKind(authSource.actorKind);
        let actor = null;
        let membership = null;

        if (!explicitActorId && !explicitActorKind) {
            membership = findMembership(defaultActor.id);
            actor = {
                id: defaultActor.id,
                name: defaultActor.name,
                email: defaultActor.email,
                kind: defaultActor.kind,
                role: defaultActor.role,
            };
        } else if (explicitActorKind === 'guest') {
            actor = createGuestActor(authSource);
        } else if (explicitActorId) {
            membership = findMembership(explicitActorId);

            if (!membership) {
                throw new Error(ERROR_CODES.unauthorized);
            }

            actor = {
                id: membership.userId,
                name: normalizeText(authSource.actorName) || membership.name,
                email: normalizeNullableText(authSource.actorEmail) || membership.email,
                kind: 'member',
                role: normalizeOptionalWorkspaceRole(authSource.actorRole) || membership.role,
            };
        } else {
            throw new Error(ERROR_CODES.unauthorized);
        }

        const authorization = buildAuthorization(actor);

        return {
            actor: {
                ...actor,
                permissions: buildPermissions(actor, authorization),
            },
            authorization,
            inviteCode: normalizeText(authSource.inviteCode),
            membership,
            workspace,
        };
    }

    function resolveHttpContext(req) {
        return resolveContext({
            workspaceId: readHeader(req?.headers, 'x-pocker-workspace-id'),
            workspaceSlug: readHeader(req?.headers, 'x-pocker-workspace-slug'),
            actorId: readHeader(req?.headers, 'x-pocker-actor-id'),
            actorName: readHeader(req?.headers, 'x-pocker-actor-name'),
            actorEmail: readHeader(req?.headers, 'x-pocker-actor-email'),
            actorKind: readHeader(req?.headers, 'x-pocker-actor-kind'),
            actorRole: readHeader(req?.headers, 'x-pocker-actor-role'),
            inviteCode: readHeader(req?.headers, 'x-pocker-invite-code'),
        });
    }

    function resolveSocketContext(socket) {
        const auth = asRecord(socket?.handshake?.auth);

        return resolveContext({
            connectionId: normalizeText(socket?.id),
            workspaceId: normalizeText(auth.workspaceId) || readHeader(socket?.handshake?.headers, 'x-pocker-workspace-id'),
            workspaceSlug: normalizeText(auth.workspaceSlug) || readHeader(socket?.handshake?.headers, 'x-pocker-workspace-slug'),
            actorId: normalizeText(auth.actorId) || readHeader(socket?.handshake?.headers, 'x-pocker-actor-id'),
            actorName: normalizeText(auth.actorName) || readHeader(socket?.handshake?.headers, 'x-pocker-actor-name'),
            actorEmail: normalizeNullableText(auth.actorEmail) || readHeader(socket?.handshake?.headers, 'x-pocker-actor-email'),
            actorKind: normalizeText(auth.actorKind) || readHeader(socket?.handshake?.headers, 'x-pocker-actor-kind'),
            actorRole: normalizeText(auth.actorRole) || readHeader(socket?.handshake?.headers, 'x-pocker-actor-role'),
            inviteCode: normalizeText(auth.inviteCode) || readHeader(socket?.handshake?.headers, 'x-pocker-invite-code'),
        });
    }

    function assertCanReadSettings(context) {
        if (context.actor.kind !== 'member') {
            throw new Error(ERROR_CODES.forbidden);
        }
    }

    function assertCanCreateRoom(context) {
        if (context.actor.kind !== 'guest') {
            return;
        }

        if (workspace.roomCreationMode === 'member_only') {
            throw new Error(ERROR_CODES.forbidden);
        }

        if (workspace.guestMode === 'invite_only' && !hasActiveInvite(context.inviteCode, null)) {
            throw new Error(ERROR_CODES.forbidden);
        }
    }

    function assertCanJoinRoom(context, { roomId, isAdmin = false } = {}) {
        if (context.actor.kind !== 'guest') {
            return;
        }

        const normalizedRoomId = normalizeText(roomId);
        const existingRoom = roomCatalog.get(normalizedRoomId) || null;
        const effectiveGuestMode = existingRoom ? existingRoom.guestMode : roomDefaults.guestMode;

        if (!existingRoom && workspace.roomCreationMode === 'member_only') {
            throw new Error(ERROR_CODES.forbidden);
        }

        if (effectiveGuestMode === 'invite_only' && !hasActiveInvite(context.inviteCode, normalizedRoomId)) {
            throw new Error(ERROR_CODES.forbidden);
        }

        if (isAdmin && workspace.guestAdminMode === 'member_only') {
            throw new Error(ERROR_CODES.forbidden);
        }
    }

    function canRequestAdminSeat(context, roomId) {
        try {
            assertCanJoinRoom(context, { roomId, isAdmin: true });
            return true;
        } catch (error) {
            return false;
        }
    }

    function registerRoom(context, {
        roomId,
        createdAt,
        visibility,
        guestMode,
    } = {}) {
        const normalizedRoomId = normalizeText(roomId);
        if (!normalizedRoomId) {
            return null;
        }

        const existingRoom = roomCatalog.get(normalizedRoomId);
        if (existingRoom) {
            const nextRoom = {
                ...existingRoom,
                visibility: normalizeRoomVisibility(visibility || existingRoom.visibility),
                guestMode: normalizeGuestMode(guestMode || existingRoom.guestMode),
                createdAt: normalizeText(createdAt) || existingRoom.createdAt,
            };

            roomCatalog.set(normalizedRoomId, nextRoom);
            return nextRoom;
        }

        const isGuestOwner = context?.actor?.kind === 'guest';
        const metadata = {
            id: normalizedRoomId,
            workspaceId: workspace.id,
            ownerUserId: context?.actor?.id || null,
            ownerType: isGuestOwner ? 'guest' : 'member',
            visibility: normalizeRoomVisibility(
                visibility || (isGuestOwner ? 'guest_link' : roomDefaults.visibility),
            ),
            guestMode: normalizeGuestMode(guestMode || roomDefaults.guestMode),
            createdAt: normalizeText(createdAt) || new Date().toISOString(),
        };

        roomCatalog.set(normalizedRoomId, metadata);
        return metadata;
    }

    function listRooms() {
        return [...roomCatalog.values()].sort((leftRoom, rightRoom) => (
            rightRoom.createdAt.localeCompare(leftRoom.createdAt)
        ));
    }

    function getSettingsBootstrap(context) {
        assertCanReadSettings(context);

        return createSaasBootstrapPayload({
            actor: context.actor,
            workspace,
            memberships,
            invites,
            rooms: listRooms(),
            billing,
            authorization: context.authorization,
            settingsSections: buildSettingsSections(
                settingsSectionSeeds,
                context.authorization,
            ),
        });
    }

    return {
        assertCanCreateRoom,
        assertCanJoinRoom,
        canRequestAdminSeat,
        getSettingsBootstrap,
        registerRoom,
        resolveHttpContext,
        resolveSocketContext,
    };
}

module.exports = {
    createSaasFoundationService,
};
