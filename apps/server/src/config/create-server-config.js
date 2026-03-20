const path = require('path');
const packageJson = require('../../../../package.json');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeNullableText(value) {
    const normalizedValue = normalizeText(value);
    return normalizedValue || null;
}

function normalizeBoolean(value, fallback = false) {
    if (value === '' || value === null || typeof value === 'undefined') {
        return fallback;
    }

    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(1, parsed);
}

function normalizeStringArray(value) {
    if (Array.isArray(value)) {
        return value
            .map(item => normalizeText(item))
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(item => normalizeText(item))
            .filter(Boolean);
    }

    return [];
}

function normalizeFrontendMode(value) {
    return value === 'legacy' ? 'legacy' : 'react';
}

function normalizeLogLevel(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    if (
        normalizedValue === 'debug'
        || normalizedValue === 'info'
        || normalizedValue === 'warn'
        || normalizedValue === 'error'
    ) {
        return normalizedValue;
    }

    return 'info';
}

function createServerConfig(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '../../../../');
    const version = normalizeText(options.version ?? process.env.APP_VERSION ?? packageJson.version ?? 'dev');
    const build = normalizeText(options.build ?? process.env.APP_BUILD ?? '');

    return {
        host: normalizeText(options.host ?? process.env.HOST ?? '0.0.0.0'),
        port: options.port ?? process.env.PORT ?? 3000,
        projectRoot,
        version,
        build,
        versionLabel: build ? `${version} (${build})` : version,
        frontend: {
            mode: normalizeFrontendMode(options.frontendMode ?? process.env.POCKER_FRONTEND_MODE),
            legacyHomeFilePath: path.join(projectRoot, 'index.html'),
            legacyHistoryFilePath: path.join(projectRoot, 'history.html'),
            reactEntryFilePath: path.join(projectRoot, 'apps', 'web', 'dist', 'index.html'),
        },
        observability: {
            serviceName: normalizeText(
                options.serviceName
                ?? process.env.POCKER_SERVICE_NAME
                ?? 'pocker',
            ),
            logLevel: normalizeLogLevel(
                options.logLevel
                ?? process.env.POCKER_LOG_LEVEL,
            ),
        },
        security: {
            rateLimits: {
                createRoom: {
                    limit: normalizePositiveInteger(
                        options.createRoomRateLimitLimit
                        ?? process.env.POCKER_RATE_LIMIT_CREATE_ROOM,
                        100,
                    ),
                    windowMs: normalizePositiveInteger(
                        options.createRoomRateLimitWindowMs
                        ?? process.env.POCKER_RATE_LIMIT_CREATE_ROOM_WINDOW_MS,
                        60 * 1000,
                    ),
                },
                join: {
                    limit: normalizePositiveInteger(
                        options.joinRateLimitLimit
                        ?? process.env.POCKER_RATE_LIMIT_JOIN,
                        200,
                    ),
                    windowMs: normalizePositiveInteger(
                        options.joinRateLimitWindowMs
                        ?? process.env.POCKER_RATE_LIMIT_JOIN_WINDOW_MS,
                        60 * 1000,
                    ),
                },
                mutation: {
                    limit: normalizePositiveInteger(
                        options.mutationRateLimitLimit
                        ?? process.env.POCKER_RATE_LIMIT_MUTATION,
                        300,
                    ),
                    windowMs: normalizePositiveInteger(
                        options.mutationRateLimitWindowMs
                        ?? process.env.POCKER_RATE_LIMIT_MUTATION_WINDOW_MS,
                        60 * 1000,
                    ),
                },
                vote: {
                    limit: normalizePositiveInteger(
                        options.voteRateLimitLimit
                        ?? process.env.POCKER_RATE_LIMIT_VOTE,
                        500,
                    ),
                    windowMs: normalizePositiveInteger(
                        options.voteRateLimitWindowMs
                        ?? process.env.POCKER_RATE_LIMIT_VOTE_WINDOW_MS,
                        60 * 1000,
                    ),
                },
                reaction: {
                    limit: normalizePositiveInteger(
                        options.reactionRateLimitLimit
                        ?? process.env.POCKER_RATE_LIMIT_REACTION,
                        300,
                    ),
                    windowMs: normalizePositiveInteger(
                        options.reactionRateLimitWindowMs
                        ?? process.env.POCKER_RATE_LIMIT_REACTION_WINDOW_MS,
                        60 * 1000,
                    ),
                },
            },
        },
        realtime: {
            sessionRecoveryTtlMs: normalizePositiveInteger(
                options.roomSessionRecoveryTtlMs
                ?? process.env.POCKER_ROOM_SESSION_RECOVERY_TTL_MS,
                5 * 60 * 1000,
            ),
            syncPollIntervalMs: normalizePositiveInteger(
                options.roomSyncPollIntervalMs
                ?? process.env.POCKER_ROOM_SYNC_POLL_INTERVAL_MS,
                750,
            ),
        },
        integrations: {
            youTrack: {
                baseUrl: normalizeText(options.youTrackBaseUrl ?? process.env.YOUTRACK_BASE_URL).replace(/\/+$/, ''),
                token: normalizeText(options.youTrackToken ?? process.env.YOUTRACK_TOKEN),
                storyPointsField: normalizeText(
                    options.youTrackStoryPointsField
                    ?? process.env.YOUTRACK_STORY_POINTS_FIELD
                    ?? 'Story points',
                ),
            },
        },
        saas: {
            workspace: {
                id: normalizeText(
                    options.saasWorkspaceId
                    ?? process.env.POCKER_SAAS_WORKSPACE_ID
                    ?? 'workspace-core',
                ),
                slug: normalizeText(
                    options.saasWorkspaceSlug
                    ?? process.env.POCKER_SAAS_WORKSPACE_SLUG
                    ?? 'core',
                ),
                name: normalizeText(
                    options.saasWorkspaceName
                    ?? process.env.POCKER_SAAS_WORKSPACE_NAME
                    ?? 'Pocker Core Workspace',
                ),
                guestMode: normalizeText(
                    options.saasGuestMode
                    ?? process.env.POCKER_SAAS_GUEST_MODE
                    ?? 'open',
                ),
                roomCreationMode: normalizeText(
                    options.saasRoomCreationMode
                    ?? process.env.POCKER_SAAS_ROOM_CREATION_MODE
                    ?? 'member_or_guest',
                ),
                guestAdminMode: normalizeText(
                    options.saasGuestAdminMode
                    ?? process.env.POCKER_SAAS_GUEST_ADMIN_MODE
                    ?? 'guest_or_member',
                ),
                billingReady: normalizeBoolean(
                    options.saasBillingReady ?? process.env.POCKER_SAAS_BILLING_READY,
                    true,
                ),
            },
            defaultActor: {
                id: normalizeText(
                    options.saasDefaultActorId
                    ?? process.env.POCKER_SAAS_DEFAULT_ACTOR_ID
                    ?? 'owner-user',
                ),
                name: normalizeText(
                    options.saasDefaultActorName
                    ?? process.env.POCKER_SAAS_DEFAULT_ACTOR_NAME
                    ?? 'Workspace owner',
                ),
                email: normalizeNullableText(
                    options.saasDefaultActorEmail
                    ?? process.env.POCKER_SAAS_DEFAULT_ACTOR_EMAIL
                    ?? 'owner@example.com',
                ),
                kind: normalizeText(
                    options.saasDefaultActorKind
                    ?? process.env.POCKER_SAAS_DEFAULT_ACTOR_KIND
                    ?? 'member',
                ),
                role: normalizeText(
                    options.saasDefaultActorRole
                    ?? process.env.POCKER_SAAS_DEFAULT_ACTOR_ROLE
                    ?? 'owner',
                ),
            },
            memberships: Array.isArray(options.saasMemberships)
                ? options.saasMemberships
                : [],
            invites: Array.isArray(options.saasInvites)
                ? options.saasInvites
                : [],
            billing: {
                plan: normalizeText(
                    options.saasBillingPlan
                    ?? process.env.POCKER_SAAS_BILLING_PLAN
                    ?? 'free',
                ),
                status: normalizeText(
                    options.saasBillingStatus
                    ?? process.env.POCKER_SAAS_BILLING_STATUS
                    ?? 'ready',
                ),
                billingContactEmail: normalizeNullableText(
                    options.saasBillingContactEmail
                    ?? process.env.POCKER_SAAS_BILLING_CONTACT_EMAIL
                    ?? 'billing@example.com',
                ),
                seatLimit: normalizePositiveInteger(
                    options.saasSeatLimit
                    ?? process.env.POCKER_SAAS_SEAT_LIMIT,
                    25,
                ),
                meteredFeatures: normalizeStringArray(
                    options.saasMeteredFeatures
                    ?? process.env.POCKER_SAAS_METERED_FEATURES,
                ),
            },
            roomDefaults: {
                visibility: normalizeText(
                    options.saasRoomVisibility
                    ?? process.env.POCKER_SAAS_ROOM_VISIBILITY
                    ?? 'workspace',
                ),
                guestMode: normalizeText(
                    options.saasRoomGuestMode
                    ?? process.env.POCKER_SAAS_ROOM_GUEST_MODE
                    ?? options.saasGuestMode
                    ?? process.env.POCKER_SAAS_GUEST_MODE
                    ?? 'open',
                ),
            },
            settingsSections: Array.isArray(options.saasSettingsSections)
                ? options.saasSettingsSections
                : [],
        },
    };
}

module.exports = {
    createServerConfig,
};
