import type {
  EstimationMode,
  PlayerDto,
  PublicRoomDto,
  RoomSnapshotDto,
  TaskStateDto,
} from '@contracts';

export type RoomConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type RoomPendingAction =
  | 'createRoom'
  | 'join'
  | 'adminStatus'
  | 'noteUpdate'
  | 'taskListUpdate'
  | 'setEstimationMode'
  | 'taskSelect'
  | 'setReaction'
  | 'setStoryPoints';

export type RoomSessionError = {
  code: string;
  message: string;
  source: 'transport' | 'socket' | 'runtime';
  at: number;
};

export type RoomUserEvent = {
  message: string;
  type: string;
  receivedAt: number;
};

export type RoomJoinIntent = {
  roomId: string;
  name: string;
  isAdmin: boolean;
};

export type JoinedRoomSnapshot = RoomSnapshotDto & {
  currentPlayerId: string | null;
};

export type RoomSessionState = {
  routeRoomSlug: string;
  roomId: string;
  room: PublicRoomDto | null;
  players: PlayerDto[];
  revealed: boolean;
  note: string;
  taskState: TaskStateDto;
  estimationMode: EstimationMode;
  connectionStatus: RoomConnectionStatus;
  socketId: string | null;
  currentPlayerId: string | null;
  adminSeatAvailable: boolean | null;
  lastError: RoomSessionError | null;
  lastUserEvent: RoomUserEvent | null;
  lastJoinIntent: RoomJoinIntent | null;
  session: {
    joined: boolean;
    userName: string;
    isAdmin: boolean;
  };
  pending: Record<RoomPendingAction, boolean>;
};

export type RoomSessionStore = {
  getState: () => RoomSessionState;
  subscribe: (listener: () => void) => () => void;
  setState: (
    updater:
      | Partial<RoomSessionState>
      | ((currentState: RoomSessionState) => RoomSessionState),
  ) => void;
};

export type RoomGatewaySubscriptionHandlers = {
  onConnect?: (socketId: string) => void;
  onDisconnect?: (reason: string) => void;
  onConnectError?: (message: string) => void;
  onPlayersUpdate?: (players: PlayerDto[]) => void;
  onVotesUpdate?: (players: PlayerDto[]) => void;
  onReactionsUpdate?: (players: PlayerDto[]) => void;
  onRevealUpdate?: (revealed: boolean) => void;
  onNoteUpdate?: (note: string) => void;
  onTaskStateUpdate?: (taskState: TaskStateDto) => void;
  onEstimationModeUpdate?: (mode: EstimationMode) => void;
  onUserEvent?: (event: { message: string; type: string }) => void;
};

export type CreateRoomInput = {
  roomSuffix: string;
};

export type JoinRoomInput = {
  roomId: string;
  name: string;
  isAdmin: boolean;
};

export type UpdateNoteInput = {
  roomId: string;
  note: string;
};

export type UpdateTaskListInput = {
  roomId: string;
  items: string[];
};

export type SetEstimationModeInput = {
  roomId: string;
  mode: EstimationMode;
};

export type SelectTaskInput = {
  roomId: string;
  direction: -1 | 1;
};

export type SetReactionInput = {
  roomId: string;
  value: string | null;
};

export type SetStoryPointsResult = {
  average: number;
  issueIdReadable: string;
  issueSummary: string;
};

export type RoomSocketGateway = {
  connect: () => void;
  disconnect: () => void;
  subscribe: (
    handlers: RoomGatewaySubscriptionHandlers,
  ) => () => void;
  createRoom: (input: CreateRoomInput) => Promise<PublicRoomDto>;
  joinRoom: (input: JoinRoomInput) => Promise<JoinedRoomSnapshot>;
  requestAdminStatus: (roomId: string) => Promise<boolean>;
  updateNote: (input: UpdateNoteInput) => Promise<void>;
  updateTaskList: (input: UpdateTaskListInput) => Promise<void>;
  setEstimationMode: (input: SetEstimationModeInput) => Promise<void>;
  selectTask: (input: SelectTaskInput) => Promise<void>;
  setReaction: (input: SetReactionInput) => Promise<void>;
  setStoryPoints: (roomId: string) => Promise<SetStoryPointsResult>;
  vote: (roomId: string, value: string | null) => void;
  reveal: (roomId: string) => void;
  reset: (roomId: string) => void;
  getPlayers: (roomId: string) => void;
};

export type RoomSessionActions = {
  connect: () => void;
  disconnect: () => void;
  resetSession: () => void;
  createRoom: (roomSuffix: string) => Promise<PublicRoomDto>;
  join: (input: {
    name: string;
    isAdmin: boolean;
    roomId?: string;
  }) => Promise<JoinedRoomSnapshot>;
  refreshAdminSeat: () => Promise<boolean>;
  updateNote: (note: string) => Promise<void>;
  updateTaskList: (items: string[]) => Promise<void>;
  setEstimationMode: (mode: EstimationMode) => Promise<void>;
  selectTask: (direction: -1 | 1) => Promise<void>;
  setReaction: (value: string | null) => Promise<void>;
  setStoryPoints: () => Promise<SetStoryPointsResult>;
  vote: (value: string | null) => void;
  reveal: () => void;
  reset: () => void;
};
