const {
    normalizeText,
    normalizeRecordedAt,
    normalizePositiveInteger,
    normalizeEntry,
    mapRowToEntry,
    buildPoolConfig,
} = require('../estimation-history-store');

describe('normalizeText', () => {
    test('converts to string and trims', () => {
        expect(normalizeText('  hello  ')).toBe('hello');
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });

    test('converts numbers to string', () => {
        expect(normalizeText(123)).toBe('123');
    });
});

describe('normalizeRecordedAt', () => {
    test('returns ISO string for valid date', () => {
        const result = normalizeRecordedAt('2024-01-15T10:30:00.000Z');
        expect(result).toBe('2024-01-15T10:30:00.000Z');
    });

    test('returns current time for invalid date', () => {
        const before = new Date().toISOString();
        const result = normalizeRecordedAt('invalid-date');
        const after = new Date().toISOString();
        expect(result >= before).toBe(true);
        expect(result <= after).toBe(true);
    });

    test('returns current time for empty string', () => {
        const before = new Date().toISOString();
        const result = normalizeRecordedAt('');
        const after = new Date().toISOString();
        expect(result >= before).toBe(true);
        expect(result <= after).toBe(true);
    });
});

describe('normalizePositiveInteger', () => {
    test('parses valid integer', () => {
        expect(normalizePositiveInteger('42', 1)).toBe(42);
    });

    test('returns fallback for invalid values', () => {
        expect(normalizePositiveInteger('abc', 10)).toBe(10);
        expect(normalizePositiveInteger(null, 5)).toBe(5);
        expect(normalizePositiveInteger('', 7)).toBe(7);
    });

    test('respects min and max bounds', () => {
        expect(normalizePositiveInteger('0', 5, { min: 1 })).toBe(1);
        expect(normalizePositiveInteger('200', 50, { max: 100 })).toBe(100);
    });

    test('handles negative numbers by clamping to min', () => {
        expect(normalizePositiveInteger('-5', 10)).toBe(1);
    });
});

describe('normalizeEntry', () => {
    test('normalizes entry fields', () => {
        const entry = {
            roomId: '  room1  ',
            taskId: '  TASK-123  ',
            participantName: '  Alice  ',
            estimate: '  5  ',
            estimateType: '  points  ',
            recordedAt: '2024-01-15T10:30:00.000Z',
        };
        const result = normalizeEntry(entry);
        expect(result).toEqual({
            roomId: 'room1',
            taskId: 'TASK-123',
            participantName: 'Alice',
            estimate: '5',
            estimateType: 'points',
            recordedAt: '2024-01-15T10:30:00.000Z',
        });
    });

    test('defaults estimateType to points', () => {
        const result = normalizeEntry({ roomId: 'r', taskId: 't', participantName: 'p', estimate: '1' });
        expect(result.estimateType).toBe('points');
    });

    test('uses estimationMode as fallback for estimateType', () => {
        const result = normalizeEntry({
            roomId: 'r',
            taskId: 't',
            participantName: 'p',
            estimate: '1',
            estimationMode: 'hours',
        });
        expect(result.estimateType).toBe('hours');
    });

    test('handles undefined entry', () => {
        const result = normalizeEntry();
        expect(result.roomId).toBe('');
        expect(result.taskId).toBe('');
    });
});

describe('mapRowToEntry', () => {
    test('maps database row to entry format', () => {
        const row = {
            room_id: 'room1',
            task_id: 'TASK-123',
            participant_name: 'Alice',
            estimate: '5',
            estimate_type: 'points',
            recorded_at: '2024-01-15T10:30:00.000Z',
        };
        const result = mapRowToEntry(row);
        expect(result).toEqual({
            roomId: 'room1',
            taskId: 'TASK-123',
            participantName: 'Alice',
            estimate: '5',
            estimateType: 'points',
            recordedAt: '2024-01-15T10:30:00.000Z',
        });
    });

    test('defaults estimateType to points if empty', () => {
        const row = {
            room_id: 'r',
            task_id: 't',
            participant_name: 'p',
            estimate: '1',
            estimate_type: '',
            recorded_at: '2024-01-15T10:30:00.000Z',
        };
        const result = mapRowToEntry(row);
        expect(result.estimateType).toBe('points');
    });

    test('handles undefined row', () => {
        const result = mapRowToEntry();
        expect(result.roomId).toBe('');
    });
});

describe('buildPoolConfig', () => {
    test('returns null for empty connection string', () => {
        expect(buildPoolConfig('')).toBeNull();
        expect(buildPoolConfig(null)).toBeNull();
    });

    test('parses connection string without sslmode', () => {
        const config = buildPoolConfig('postgres://user:pass@localhost:5432/db');
        expect(config.connectionString).toBe('postgres://user:pass@localhost:5432/db');
        expect(config.ssl).toBeUndefined();
    });

    test('parses connection string with sslmode=require', () => {
        const config = buildPoolConfig('postgres://user:pass@localhost:5432/db?sslmode=require');
        expect(config.ssl).toEqual({ rejectUnauthorized: false });
        expect(config.connectionString).not.toContain('sslmode');
    });

    test('parses connection string with sslmode=disable', () => {
        const config = buildPoolConfig('postgres://user:pass@localhost:5432/db?sslmode=disable');
        expect(config.ssl).toBeUndefined();
    });

    test('falls back to raw string for invalid URL', () => {
        const config = buildPoolConfig('not-a-valid-url');
        expect(config.connectionString).toBe('not-a-valid-url');
        expect(config.ssl).toBeUndefined();
    });
});
