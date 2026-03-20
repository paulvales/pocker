export type EstimationMode = 'points' | 'hours';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'billing';
export type WorkspaceMemberKind = 'member' | 'guest';
export type MembershipStatus = 'active' | 'invited';
export type GuestMode = 'open' | 'invite_only';
export type RoomCreationMode = 'member_or_guest' | 'member_only';
export type GuestAdminMode = 'guest_or_member' | 'member_only';
export type InviteKind = 'workspace_member' | 'room_guest';
export type InviteRole = 'member' | 'guest';
export type InviteStatus = 'active' | 'revoked' | 'expired';
export type RoomOwnerType = 'member' | 'guest' | 'system';
export type RoomVisibility = 'workspace' | 'guest_link';
export type BillingPlan = 'free' | 'team' | 'enterprise';
export type BillingStatus =
  | 'ready'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'inactive';
export type SettingsSectionStatus = 'available' | 'planned' | 'restricted';

export type PublicRoomDto = {
  id: string;
  suffix: string;
  label: string;
  createdAt: string | null;
  joinPath: string;
};

export type PlayerDto = {
  id: string;
  name: string;
  vote: string | null;
  reaction: string | null;
  isAdmin: boolean;
};

export type TaskStateDto = {
  items: string[];
  selectedIndex: number;
};

export type RoomSnapshotDto = {
  room: PublicRoomDto | null;
  players: PlayerDto[];
  revealed: boolean;
  note: string;
  taskState: TaskStateDto;
  estimationMode: EstimationMode;
};

export type HistoryFiltersDto = {
  roomId: string;
  taskId: string;
  participantName: string;
  estimate: string;
  estimateType: string;
  recordedOn: string;
  page: number;
  pageSize: number;
};

export type HistoryItemDto = {
  roomId: string;
  taskId: string;
  participantName: string;
  estimate: string;
  estimateType: EstimationMode;
  recordedAt: string;
};

export type PaginationDto = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type HistoryResponseDto = {
  items: HistoryItemDto[];
  meta: {
    rooms: string[];
    participants: string[];
    estimateTypes: string[];
    pagination: PaginationDto;
  };
};

export type WorkspaceActorDto = {
  id: string;
  name: string;
  email: string | null;
  kind: WorkspaceMemberKind;
  role: WorkspaceRole | null;
  permissions: string[];
};

export type WorkspaceSummaryDto = {
  id: string;
  slug: string;
  name: string;
  guestMode: GuestMode;
  roomCreationMode: RoomCreationMode;
  guestAdminMode: GuestAdminMode;
  billingReady: boolean;
};

export type WorkspaceMembershipDto = {
  userId: string;
  name: string;
  email: string | null;
  role: WorkspaceRole;
  status: MembershipStatus;
};

export type WorkspaceInviteDto = {
  id: string;
  code: string;
  kind: InviteKind;
  role: InviteRole;
  status: InviteStatus;
  workspaceId: string;
  roomId: string | null;
};

export type WorkspaceRoomDto = {
  id: string;
  workspaceId: string;
  ownerUserId: string | null;
  ownerType: RoomOwnerType;
  visibility: RoomVisibility;
  guestMode: GuestMode;
  createdAt: string;
};

export type BillingSummaryDto = {
  plan: BillingPlan;
  status: BillingStatus;
  billingContactEmail: string | null;
  seatLimit: number;
  seatsUsed: number;
  meteredFeatures: string[];
};

export type WorkspaceAuthorizationDto = {
  canManageWorkspace: boolean;
  canManageMembers: boolean;
  canManageBilling: boolean;
  canManageRooms: boolean;
};

export type SettingsSectionDto = {
  id: string;
  title: string;
  description: string;
  status: SettingsSectionStatus;
};

export type SaasBootstrapDto = {
  actor: WorkspaceActorDto;
  workspace: WorkspaceSummaryDto;
  memberships: WorkspaceMembershipDto[];
  invites: WorkspaceInviteDto[];
  rooms: WorkspaceRoomDto[];
  billing: BillingSummaryDto;
  authorization: WorkspaceAuthorizationDto;
  settingsSections: SettingsSectionDto[];
};

export const HTTP_ROUTES: Readonly<{
  home: '/';
  homeHtml: '/index.html';
  settings: '/settings';
  settingsPage: '/settings/';
  health: '/health';
  version: '/version';
  history: '/history';
  historyPage: '/history/';
  historyHtml: '/history.html';
  estimationHistory: '/api/estimation-history';
  settingsBootstrap: '/api/settings/bootstrap';
}>;

export const SOCKET_EVENT_NAMES: Readonly<{
  client: {
    createRoom: 'create_room';
    noteUpdate: 'note_update';
    join: 'join';
    taskListUpdate: 'task_list_update';
    setEstimationMode: 'set_estimation_mode';
    taskSelect: 'task_select';
    vote: 'vote';
    setReaction: 'set_reaction';
    reveal: 'reveal';
    reset: 'reset';
    setStoryPoints: 'set_story_points';
    getPlayers: 'get_players';
    requestAdminStatus: 'request_admin_status';
  };
  server: {
    playersUpdate: 'players_update';
    userEvent: 'user_event';
    noteUpdate: 'note_update';
    taskStateUpdate: 'task_state_update';
    estimationModeUpdate: 'estimation_mode_update';
    votesUpdate: 'votes_update';
    reactionsUpdate: 'reactions_update';
    revealUpdate: 'reveal_update';
  };
}>;

export const ERROR_CODES: Readonly<Record<string, string>>;
export const ESTIMATION_HISTORY_DEFAULT_PAGE: 1;
export const ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE: 25;
export const ESTIMATION_HISTORY_MAX_PAGE_SIZE: 100;

export function createHealthPayload(input: {
  version: string;
  build?: string | null;
}): {
  status: 'ok';
  version: string;
  build: string | null;
};

export function createVersionPayload(input: {
  version: string;
  build?: string | null;
  label: string;
}): {
  version: string;
  build: string | null;
  label: string;
};

export function createRoomSnapshotPayload(value?: unknown): RoomSnapshotDto;
export function createHistoryResponse(value?: unknown): HistoryResponseDto;
export function createSaasBootstrapPayload(value?: unknown): SaasBootstrapDto;

export function createSocketAckSuccess<T extends Record<string, unknown>>(
  payload?: T,
): { ok: true } & T;
export function createSocketAckError(
  error?: unknown,
  fallback?: string,
): {
  ok: false;
  error: string;
};
export function getErrorCode(error?: unknown, fallback?: string): string;

export function normalizeEstimationMode(mode?: unknown): EstimationMode;
export function normalizePublicRoom(value?: unknown): PublicRoomDto | null;
export function normalizeTaskState(value?: unknown): TaskStateDto;

export function parseCreateRoomPayload(value?: unknown): {
  roomSuffix: string;
};
export function parseNoteUpdatePayload(value?: unknown): {
  roomId: string;
  note: string;
};
export function parseJoinPayload(value?: unknown): {
  roomId: string;
  name: string;
  isAdmin: boolean;
};
export function parseTaskListUpdatePayload(value?: unknown): {
  roomId: string;
  items: string[];
};
export function parseSetEstimationModePayload(value?: unknown): {
  roomId: string;
  mode: EstimationMode;
};
export function parseTaskSelectPayload(value?: unknown): {
  roomId: string;
  direction: -1 | 1;
};
export function parseVotePayload(value?: unknown): {
  roomId: string;
  value: string | null;
};
export function parseSetReactionPayload(value?: unknown): {
  roomId: string;
  value: string | null;
};
export function parseSetStoryPointsPayload(value?: unknown): {
  roomId: string;
};
export function parseRoomIdPayload(value?: unknown): string;
export function parseHistoryFilters(value?: unknown): HistoryFiltersDto;
