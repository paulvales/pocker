const HTTP_ROUTES = Object.freeze({
  home: '/',
  homeHtml: '/index.html',
  health: '/health',
  version: '/version',
  history: '/history',
  historyPage: '/history/',
  historyHtml: '/history.html',
  estimationHistory: '/api/estimation-history',
});

const SOCKET_EVENT_NAMES = Object.freeze({
  client: Object.freeze({
    createRoom: 'create_room',
    noteUpdate: 'note_update',
    join: 'join',
    taskListUpdate: 'task_list_update',
    setEstimationMode: 'set_estimation_mode',
    taskSelect: 'task_select',
    vote: 'vote',
    setReaction: 'set_reaction',
    reveal: 'reveal',
    reset: 'reset',
    setStoryPoints: 'set_story_points',
    getPlayers: 'get_players',
    requestAdminStatus: 'request_admin_status',
  }),
  server: Object.freeze({
    playersUpdate: 'players_update',
    userEvent: 'user_event',
    noteUpdate: 'note_update',
    taskStateUpdate: 'task_state_update',
    estimationModeUpdate: 'estimation_mode_update',
    votesUpdate: 'votes_update',
    reactionsUpdate: 'reactions_update',
    revealUpdate: 'reveal_update',
  }),
});

const ERROR_CODES = Object.freeze({
  unknown: 'UNKNOWN_ERROR',
  internalServerError: 'INTERNAL_SERVER_ERROR',
  historyReadFailed: 'HISTORY_READ_FAILED',
  forbidden: 'FORBIDDEN',
  roomSuffixRequired: 'ROOM_SUFFIX_REQUIRED',
  roomSuffixInvalid: 'ROOM_SUFFIX_INVALID',
  roomAlreadyExists: 'ROOM_ALREADY_EXISTS',
  roomNotFound: 'ROOM_NOT_FOUND',
  nameRequired: 'NAME_REQUIRED',
  adminAlreadyExists: 'ADMIN_ALREADY_EXISTS',
  taskListEmpty: 'TASK_LIST_EMPTY',
  reactionInvalid: 'REACTION_INVALID',
  youTrackNotConfigured: 'YOUTRACK_NOT_CONFIGURED',
  noVotes: 'NO_VOTES',
  issueNotFoundInNote: 'ISSUE_NOT_FOUND_IN_NOTE',
  ackTimeout: 'ACK_TIMEOUT',
  socketDisconnected: 'SOCKET_DISCONNECTED',
});

const ESTIMATION_HISTORY_DEFAULT_PAGE = 1;
const ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE = 25;
const ESTIMATION_HISTORY_MAX_PAGE_SIZE = 100;

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLooseText(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value);
}

function normalizeNullableText(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  return String(value).trim() || null;
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(item => normalizeText(item)).filter(Boolean))];
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeEstimationMode(mode) {
  return mode === 'hours' ? 'hours' : 'points';
}

function normalizeTaskState(value = {}) {
  const payload = asRecord(value);
  const items = normalizeStringArray(payload.items);
  const rawIndex = Number(payload.selectedIndex);
  const safeIndex = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
  const maxIndex = items.length ? items.length - 1 : 0;

  return {
    items,
    selectedIndex: items.length ? Math.max(0, Math.min(safeIndex, maxIndex)) : 0,
  };
}

function normalizePublicRoom(value) {
  const payload = asRecord(value);
  const id = normalizeText(payload.id);

  if (!id) {
    return null;
  }

  return {
    id,
    suffix: normalizeText(payload.suffix) || id,
    label: normalizeText(payload.label) || id,
    createdAt: payload.createdAt ? String(payload.createdAt) : null,
    joinPath: normalizeText(payload.joinPath),
  };
}

function normalizePlayer(value) {
  const payload = asRecord(value);

  return {
    id: normalizeText(payload.id),
    name: normalizeText(payload.name),
    vote:
      payload.vote === null || typeof payload.vote === 'undefined'
        ? null
        : String(payload.vote),
    reaction: normalizeNullableText(payload.reaction),
    isAdmin: Boolean(payload.isAdmin),
  };
}

function createRoomSnapshotPayload(value = {}) {
  const payload = asRecord(value);

  return {
    room: normalizePublicRoom(payload.room),
    players: Array.isArray(payload.players) ? payload.players.map(normalizePlayer) : [],
    revealed: Boolean(payload.revealed),
    note: normalizeLooseText(payload.note),
    taskState: normalizeTaskState(payload.taskState),
    estimationMode: normalizeEstimationMode(payload.estimationMode),
  };
}

function parseCreateRoomPayload(value) {
  const payload = asRecord(value);

  return {
    roomSuffix: normalizeText(payload.roomSuffix),
  };
}

function parseNoteUpdatePayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    note: normalizeLooseText(payload.note),
  };
}

function parseJoinPayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    name: normalizeText(payload.name),
    isAdmin: normalizeBoolean(payload.isAdmin),
  };
}

function parseTaskListUpdatePayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    items: normalizeStringArray(payload.items),
  };
}

function parseSetEstimationModePayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    mode: normalizeEstimationMode(payload.mode),
  };
}

function parseTaskSelectPayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    direction: Number(payload.direction) < 0 ? -1 : 1,
  };
}

function parseVotePayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    value:
      payload.value === null || typeof payload.value === 'undefined'
        ? null
        : String(payload.value),
  };
}

function parseSetReactionPayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    value:
      payload.value === null || typeof payload.value === 'undefined'
        ? null
        : String(payload.value).trim(),
  };
}

function parseSetStoryPointsPayload(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
  };
}

function parseRoomIdPayload(value) {
  if (typeof value === 'string') {
    return normalizeText(value);
  }

  const payload = asRecord(value);
  return normalizeText(payload.roomId);
}

function readQueryValue(source, key) {
  if (source && typeof source.get === 'function') {
    return source.get(key);
  }

  const payload = asRecord(source);
  return payload[key];
}

function parseHistoryFilters(source) {
  return {
    roomId: normalizeText(readQueryValue(source, 'roomId')),
    taskId: normalizeText(readQueryValue(source, 'taskId')),
    participantName: normalizeText(readQueryValue(source, 'participantName')),
    estimate: normalizeText(readQueryValue(source, 'estimate')),
    estimateType: normalizeText(readQueryValue(source, 'estimateType')),
    recordedOn: normalizeText(readQueryValue(source, 'recordedOn')),
    page: normalizePositiveInteger(
      readQueryValue(source, 'page'),
      ESTIMATION_HISTORY_DEFAULT_PAGE,
    ),
    pageSize: normalizePositiveInteger(
      readQueryValue(source, 'pageSize'),
      ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
      { max: ESTIMATION_HISTORY_MAX_PAGE_SIZE },
    ),
  };
}

function normalizeHistoryItem(value) {
  const payload = asRecord(value);

  return {
    roomId: normalizeText(payload.roomId),
    taskId: normalizeText(payload.taskId),
    participantName: normalizeText(payload.participantName),
    estimate: normalizeLooseText(payload.estimate),
    estimateType: normalizeEstimationMode(payload.estimateType),
    recordedAt: normalizeLooseText(payload.recordedAt),
  };
}

function normalizePagination(value) {
  const payload = asRecord(value);
  const totalItems = normalizePositiveInteger(payload.totalItems, 0, { min: 0 });
  const totalPages = normalizePositiveInteger(payload.totalPages, 1, { min: 1 });
  const pageSize = normalizePositiveInteger(
    payload.pageSize,
    ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
    { max: ESTIMATION_HISTORY_MAX_PAGE_SIZE },
  );

  return {
    page: normalizePositiveInteger(payload.page, ESTIMATION_HISTORY_DEFAULT_PAGE),
    pageSize,
    totalItems,
    totalPages,
    hasPreviousPage: Boolean(payload.hasPreviousPage),
    hasNextPage: Boolean(payload.hasNextPage),
  };
}

function createHistoryResponse({ items = [], meta = {} } = {}) {
  const normalizedMeta = asRecord(meta);

  return {
    items: Array.isArray(items) ? items.map(normalizeHistoryItem) : [],
    meta: {
      rooms: normalizeStringArray(normalizedMeta.rooms),
      participants: normalizeStringArray(normalizedMeta.participants),
      estimateTypes: normalizeStringArray(normalizedMeta.estimateTypes),
      pagination: normalizePagination(normalizedMeta.pagination),
    },
  };
}

function createHealthPayload({ version, build } = {}) {
  return {
    status: 'ok',
    version: normalizeLooseText(version),
    build: normalizeNullableText(build),
  };
}

function createVersionPayload({ version, build, label } = {}) {
  return {
    version: normalizeLooseText(version),
    build: normalizeNullableText(build),
    label: normalizeLooseText(label),
  };
}

function createSocketAckSuccess(payload = {}) {
  return {
    ok: true,
    ...asRecord(payload),
  };
}

function getErrorCode(error, fallback = ERROR_CODES.unknown) {
  const message = normalizeText(error?.message);
  return message || fallback;
}

function createSocketAckError(error, fallback = ERROR_CODES.unknown) {
  return {
    ok: false,
    error: getErrorCode(error, fallback),
  };
}

module.exports = {
  ERROR_CODES,
  ESTIMATION_HISTORY_DEFAULT_PAGE,
  ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
  ESTIMATION_HISTORY_MAX_PAGE_SIZE,
  HTTP_ROUTES,
  SOCKET_EVENT_NAMES,
  createHealthPayload,
  createHistoryResponse,
  createRoomSnapshotPayload,
  createSocketAckError,
  createSocketAckSuccess,
  createVersionPayload,
  getErrorCode,
  normalizeEstimationMode,
  normalizePublicRoom,
  normalizeTaskState,
  parseCreateRoomPayload,
  parseHistoryFilters,
  parseJoinPayload,
  parseNoteUpdatePayload,
  parseRoomIdPayload,
  parseSetEstimationModePayload,
  parseSetReactionPayload,
  parseSetStoryPointsPayload,
  parseTaskListUpdatePayload,
  parseTaskSelectPayload,
  parseVotePayload,
};
