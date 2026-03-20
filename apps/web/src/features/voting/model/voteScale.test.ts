import type { PlayerDto } from '@contracts';
import { describe, expect, it } from 'vitest';

import {
  calculateAverageVote,
  getAverageVoteLabel,
  getVisibleVoteValue,
  getVoteValuesForMode,
  hasNumericVotes,
  sortPlayersForDisplay,
} from './voteScale';

const players: PlayerDto[] = [
  {
    id: 'socket-1',
    name: 'Charlie',
    vote: '8',
    reaction: null,
    isAdmin: false,
  },
  {
    id: 'socket-2',
    name: 'Alpha',
    vote: '3',
    reaction: null,
    isAdmin: true,
  },
  {
    id: 'socket-3',
    name: 'Bravo',
    vote: '?',
    reaction: null,
    isAdmin: false,
  },
];

describe('voteScale', () => {
  it('exposes mode-specific vote values and labels', () => {
    expect(getVoteValuesForMode('points')).toContain('13');
    expect(getVoteValuesForMode('hours')).toContain('24');
    expect(getAverageVoteLabel('points')).toBe('Average in points');
    expect(getAverageVoteLabel('hours')).toBe('Average in hours');
  });

  it('computes average and numeric vote presence from player snapshots', () => {
    expect(hasNumericVotes(players)).toBe(true);
    expect(calculateAverageVote(players)).toBe('6');
    expect(calculateAverageVote([])).toBe('0');
  });

  it('sorts revealed players by numeric vote and hides foreign unrevealed votes', () => {
    expect(sortPlayersForDisplay(players, true).map((player) => player.name)).toEqual([
      'Alpha',
      'Charlie',
      'Bravo',
    ]);

    expect(
      getVisibleVoteValue(players[0], {
        revealed: false,
        socketId: 'socket-1',
      }),
    ).toBe('8');
    expect(
      getVisibleVoteValue(players[1], {
        revealed: false,
        socketId: 'socket-1',
      }),
    ).toBe('?');
  });
});
