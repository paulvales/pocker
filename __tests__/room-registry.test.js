const {
    createRoomRegistry,
    normalizeRoomId,
    normalizeRoomSuffix,
    normalizeEstimationMode,
    normalizeTaskState,
    normalizeReaction,
    AVAILABLE_REACTIONS,
} = require('../room-registry');

describe('normalizeRoomId', () => {
    test('normalizes to lowercase', () => {
        expect(normalizeRoomId('MyRoom')).toBe('myroom');
    });

    test('trims whitespace', () => {
        expect(normalizeRoomId('  room  ')).toBe('room');
    });

    test('replaces special characters with hyphens', () => {
        expect(normalizeRoomId('my room!@#')).toBe('my-room');
    });

    test('removes leading and trailing hyphens', () => {
        expect(normalizeRoomId('--room--')).toBe('room');
    });

    test('preserves underscores and hyphens', () => {
        expect(normalizeRoomId('my_room-123')).toBe('my_room-123');
    });

    test('limits length to 64 characters', () => {
        const longId = 'a'.repeat(100);
        expect(normalizeRoomId(longId).length).toBeLessThanOrEqual(64);
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeRoomId(null)).toBe('');
        expect(normalizeRoomId(undefined)).toBe('');
    });

    test('normalizes unicode characters (NFKC)', () => {
        expect(normalizeRoomId('café')).toBe('café');
    });
});

describe('normalizeRoomSuffix', () => {
    test('delegates to normalizeRoomId', () => {
        expect(normalizeRoomSuffix('My Room')).toBe('my-room');
    });
});

describe('normalizeEstimationMode', () => {
    test('returns "hours" for "hours"', () => {
        expect(normalizeEstimationMode('hours')).toBe('hours');
    });

    test('returns "points" for "points"', () => {
        expect(normalizeEstimationMode('points')).toBe('points');
    });

    test('returns "points" for invalid values', () => {
        expect(normalizeEstimationMode('invalid')).toBe('points');
        expect(normalizeEstimationMode(null)).toBe('points');
        expect(normalizeEstimationMode(undefined)).toBe('points');
        expect(normalizeEstimationMode(123)).toBe('points');
    });
});

describe('normalizeTaskState', () => {
    test('returns empty state for undefined', () => {
        const result = normalizeTaskState();
        expect(result).toEqual({ items: [], selectedIndex: 0 });
    });

    test('filters empty strings and trims items', () => {
        const result = normalizeTaskState({
            items: ['  task1  ', '', 'task2', null, undefined],
        });
        expect(result.items).toEqual(['task1', 'task2']);
    });

    test('removes duplicate items', () => {
        const result = normalizeTaskState({
            items: ['task1', 'task2', 'task1'],
        });
        expect(result.items).toEqual(['task1', 'task2']);
    });

    test('clamps selectedIndex to valid range', () => {
        expect(normalizeTaskState({ items: ['a', 'b'], selectedIndex: 10 }).selectedIndex).toBe(1);
        expect(normalizeTaskState({ items: ['a', 'b'], selectedIndex: -5 }).selectedIndex).toBe(0);
        expect(normalizeTaskState({ items: ['a', 'b'], selectedIndex: 1 }).selectedIndex).toBe(1);
    });

    test('defaults selectedIndex to 0 for empty items', () => {
        expect(normalizeTaskState({ items: [], selectedIndex: 5 }).selectedIndex).toBe(0);
    });

    test('truncates non-integer selectedIndex', () => {
        expect(normalizeTaskState({ items: ['a', 'b', 'c'], selectedIndex: 1.7 }).selectedIndex).toBe(1);
    });

    test('defaults selectedIndex to 0 for non-numeric values', () => {
        expect(normalizeTaskState({ items: ['a'], selectedIndex: 'abc' }).selectedIndex).toBe(0);
    });
});

describe('normalizeReaction', () => {
    test('returns null for null/undefined', () => {
        expect(normalizeReaction(null)).toBeNull();
        expect(normalizeReaction(undefined)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(normalizeReaction('')).toBeNull();
        expect(normalizeReaction('   ')).toBeNull();
    });

    test('accepts valid reactions from AVAILABLE_REACTIONS', () => {
        AVAILABLE_REACTIONS.forEach(reaction => {
            expect(normalizeReaction(reaction)).toBe(reaction);
        });
    });

    test('throws for invalid reaction', () => {
        expect(() => normalizeReaction('🚀')).toThrow('REACTION_INVALID');
        expect(() => normalizeReaction('invalid')).toThrow('REACTION_INVALID');
    });
});

describe('createRoomRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = createRoomRegistry();
    });

    describe('createRoom', () => {
        test('creates a room with valid suffix', () => {
            const result = registry.createRoom({ roomSuffix: 'test-room' });
            expect(result.roomId).toBe('test-room');
            expect(result.room.id).toBe('test-room');
        });

        test('normalizes room suffix', () => {
            const result = registry.createRoom({ roomSuffix: 'Test Room 42' });
            expect(result.roomId).toBe('test-room-42');
        });

        test('throws for empty suffix', () => {
            expect(() => registry.createRoom({ roomSuffix: '' })).toThrow('ROOM_SUFFIX_REQUIRED');
        });

        test('throws for invalid suffix (too short after normalization)', () => {
            expect(() => registry.createRoom({ roomSuffix: '---' })).toThrow('ROOM_SUFFIX_REQUIRED');
        });

        test('throws for reserved room id', () => {
            expect(() => registry.createRoom({ roomSuffix: 'health' })).toThrow('ROOM_SUFFIX_INVALID');
        });

        test('throws for duplicate room', () => {
            registry.createRoom({ roomSuffix: 'test' });
            expect(() => registry.createRoom({ roomSuffix: 'test' })).toThrow('ROOM_ALREADY_EXISTS');
        });
    });

    describe('joinRoom', () => {
        test('joins a player to a room', () => {
            registry.createRoom({ roomSuffix: 'test' });
            const result = registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            expect(result.player.name).toBe('Alice');
            expect(result.player.isAdmin).toBe(false);
        });

        test('joins an admin to a room', () => {
            registry.createRoom({ roomSuffix: 'test' });
            const result = registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Admin',
                isAdmin: true,
            });
            expect(result.player.isAdmin).toBe(true);
        });

        test('prevents multiple admins', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Admin',
                isAdmin: true,
            });
            expect(() => registry.joinRoom({
                roomId: 'test',
                socketId: 'socket2',
                name: 'User',
                isAdmin: true,
            })).toThrow('ADMIN_ALREADY_EXISTS');
        });

        test('throws for empty name', () => {
            registry.createRoom({ roomSuffix: 'test' });
            expect(() => registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: '',
            })).toThrow('NAME_REQUIRED');
        });

        test('creates room on join if it does not exist', () => {
            const result = registry.joinRoom({
                roomId: 'new-room',
                socketId: 'socket1',
                name: 'Alice',
            });
            expect(result.roomId).toBe('new-room');
        });
    });

    describe('leaveRoom', () => {
        test('removes player from room', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            const result = registry.leaveRoom({ roomId: 'test', socketId: 'socket1' });
            expect(result.player.name).toBe('Alice');
        });

        test('returns null for non-existent room/player', () => {
            expect(registry.leaveRoom({ roomId: 'test', socketId: 'socket1' })).toBeNull();
        });
    });

    describe('recordVote', () => {
        test('records a vote for a player', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            const players = registry.recordVote('test', 'socket1', '5');
            expect(players[0].vote).toBe('5');
        });

        test('throws for non-member', () => {
            registry.createRoom({ roomSuffix: 'test' });
            expect(() => registry.recordVote('test', 'socket1', '5')).toThrow('FORBIDDEN');
        });
    });

    describe('recordReaction', () => {
        test('records a valid reaction', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            const players = registry.recordReaction('test', 'socket1', '👍');
            expect(players[0].reaction).toBe('👍');
        });

        test('clears reaction with null', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            registry.recordReaction('test', 'socket1', '👍');
            const players = registry.recordReaction('test', 'socket1', null);
            expect(players[0].reaction).toBeNull();
        });

        test('throws for invalid reaction', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            expect(() => registry.recordReaction('test', 'socket1', '🚀')).toThrow('REACTION_INVALID');
        });
    });

    describe('revealVotes', () => {
        test('reveals votes', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            registry.recordVote('test', 'socket1', '5');
            const revealed = registry.revealVotes('test');
            expect(revealed).toBe(true);
        });
    });

    describe('resetRoom', () => {
        test('resets votes and note', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            registry.recordVote('test', 'socket1', '5');
            registry.updateNote('test', 'some note');
            const result = registry.resetRoom('test');
            expect(result.players[0].vote).toBeNull();
            expect(result.note).toBe('');
            expect(result.revealed).toBe(false);
        });
    });

    describe('assertMembership', () => {
        test('returns membership info for valid member', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            const result = registry.assertMembership('test', 'socket1');
            expect(result.player.name).toBe('Alice');
        });

        test('throws for non-member', () => {
            registry.createRoom({ roomSuffix: 'test' });
            expect(() => registry.assertMembership('test', 'socket1')).toThrow('FORBIDDEN');
        });

        test('throws for non-admin when requireAdmin is true', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            expect(() => registry.assertMembership('test', 'socket1', { requireAdmin: true })).toThrow('FORBIDDEN');
        });
    });

    describe('getSnapshot', () => {
        test('returns room snapshot', () => {
            registry.createRoom({ roomSuffix: 'test' });
            registry.joinRoom({
                roomId: 'test',
                socketId: 'socket1',
                name: 'Alice',
            });
            const snapshot = registry.getSnapshot('test');
            expect(snapshot.room.id).toBe('test');
            expect(snapshot.players).toHaveLength(1);
            expect(snapshot.revealed).toBe(false);
        });

        test('throws for non-existent room without allowMissing', () => {
            expect(() => registry.getSnapshot('nonexistent')).toThrow('ROOM_NOT_FOUND');
        });

        test('returns empty snapshot with allowMissing', () => {
            const snapshot = registry.getSnapshot('nonexistent', { allowMissing: true });
            expect(snapshot.players).toHaveLength(0);
        });
    });
});
