const {
  ESTIMATION_HISTORY_DEFAULT_PAGE,
  ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
  ESTIMATION_HISTORY_MAX_PAGE_SIZE,
  ERROR_CODES,
  HTTP_ROUTES,
  SOCKET_EVENT_NAMES,
  createHistoryResponse,
  createSocketAckError,
  createSocketAckSuccess,
  parseHistoryFilters,
  parseJoinPayload,
  parseTaskListUpdatePayload,
} = require('../packages/contracts');

describe('shared contracts', () => {
  test('exposes stable HTTP routes and socket event names', () => {
    expect(HTTP_ROUTES.estimationHistory).toBe('/api/estimation-history');
    expect(SOCKET_EVENT_NAMES.client.join).toBe('join');
    expect(SOCKET_EVENT_NAMES.server.taskStateUpdate).toBe('task_state_update');
  });

  test('normalizes join payloads and boolean admin intent', () => {
    expect(parseJoinPayload({
      roomId: ' room-a ',
      name: ' Alice ',
      isAdmin: 'true',
    })).toEqual({
      roomId: 'room-a',
      name: 'Alice',
      isAdmin: true,
    });
  });

  test('normalizes task list payloads into trimmed unique items', () => {
    expect(parseTaskListUpdatePayload({
      roomId: ' room-a ',
      items: ['  A-1  ', 'A-1', '', 'B-2'],
    })).toEqual({
      roomId: 'room-a',
      items: ['A-1', 'B-2'],
    });
  });

  test('normalizes history filters and caps page size', () => {
    const searchParams = new URLSearchParams({
      taskId: ' APP-1 ',
      page: '2',
      pageSize: String(ESTIMATION_HISTORY_MAX_PAGE_SIZE + 500),
    });

    expect(parseHistoryFilters(searchParams)).toEqual({
      roomId: '',
      taskId: 'APP-1',
      participantName: '',
      estimate: '',
      estimateType: '',
      recordedOn: '',
      page: 2,
      pageSize: ESTIMATION_HISTORY_MAX_PAGE_SIZE,
    });

    expect(parseHistoryFilters(new URLSearchParams())).toEqual({
      roomId: '',
      taskId: '',
      participantName: '',
      estimate: '',
      estimateType: '',
      recordedOn: '',
      page: ESTIMATION_HISTORY_DEFAULT_PAGE,
      pageSize: ESTIMATION_HISTORY_DEFAULT_PAGE_SIZE,
    });
  });

  test('creates normalized history responses and socket acks', () => {
    expect(createHistoryResponse({
      items: [
        {
          roomId: ' room-a ',
          taskId: 'APP-1',
          participantName: ' Alice ',
          estimate: 8,
          estimateType: 'hours',
          recordedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      meta: {
        rooms: [' room-a '],
        participants: [' Alice '],
        estimateTypes: ['hours'],
        pagination: {
          page: 3,
          pageSize: 10,
          totalItems: 21,
          totalPages: 3,
          hasPreviousPage: true,
          hasNextPage: false,
        },
      },
    })).toEqual({
      items: [
        {
          roomId: 'room-a',
          taskId: 'APP-1',
          participantName: 'Alice',
          estimate: '8',
          estimateType: 'hours',
          recordedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      meta: {
        rooms: ['room-a'],
        participants: ['Alice'],
        estimateTypes: ['hours'],
        pagination: {
          page: 3,
          pageSize: 10,
          totalItems: 21,
          totalPages: 3,
          hasPreviousPage: true,
          hasNextPage: false,
        },
      },
    });

    expect(createSocketAckSuccess({ roomId: 'room-a' })).toEqual({
      ok: true,
      roomId: 'room-a',
    });
    expect(createSocketAckError(new Error(ERROR_CODES.roomNotFound))).toEqual({
      ok: false,
      error: ERROR_CODES.roomNotFound,
    });
  });
});
