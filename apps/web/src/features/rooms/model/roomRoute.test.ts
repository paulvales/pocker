import { describe, expect, it } from 'vitest';

import {
  buildRoomLink,
  buildRoomPath,
  isValidRoomSlug,
  normalizeRoomSlug,
} from './roomRoute';

describe('roomRoute', () => {
  it('normalizes user-facing slugs into stable route ids', () => {
    expect(normalizeRoomSlug(' Backend Sprint 42 ')).toBe('backend-sprint-42');
    expect(normalizeRoomSlug('qa_team')).toBe('qa_team');
    expect(normalizeRoomSlug('history')).toBe('history');
  });

  it('rejects reserved and malformed slugs', () => {
    expect(isValidRoomSlug('history')).toBe(false);
    expect(isValidRoomSlug('settings')).toBe(false);
    expect(isValidRoomSlug('socket.io')).toBe(false);
    expect(isValidRoomSlug('   ')).toBe(false);
    expect(isValidRoomSlug('team sync')).toBe(true);
  });

  it('builds compatible room paths and absolute links', () => {
    expect(buildRoomPath(' Backend Sprint 42 ')).toBe('/backend-sprint-42');
    expect(buildRoomPath('')).toBe('/');
    expect(buildRoomLink('qa_team')).toBe(`${window.location.origin}/qa_team/`);
  });
});
