import type { EstimationMode, PlayerDto } from '@contracts';

export const POINT_VOTE_VALUES = ['1', '2', '3', '5', '8', '13', '20', '40', '?'];
export const HOUR_VOTE_VALUES = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '20',
  '24',
  '32',
  '40',
  '?',
];

export function getVoteValuesForMode(mode: EstimationMode): string[] {
  return mode === 'hours' ? HOUR_VOTE_VALUES : POINT_VOTE_VALUES;
}

export function isBaseVoteValue(value: string): boolean {
  return POINT_VOTE_VALUES.includes(value);
}

export function hasNumericVotes(players: PlayerDto[]): boolean {
  return players.some((player) => Number.isFinite(Number(player.vote)));
}

export function calculateAverageVote(players: PlayerDto[]): string {
  const numericVotes = players
    .map((player) => Number(player.vote))
    .filter((vote) => Number.isFinite(vote));

  if (!numericVotes.length) {
    return '0';
  }

  const average =
    numericVotes.reduce((total, value) => total + value, 0) / numericVotes.length;

  return String(Math.round(average));
}

export function getAverageVoteLabel(mode: EstimationMode): string {
  return mode === 'hours' ? 'Average in hours' : 'Average in points';
}

export function sortPlayersForDisplay(
  players: PlayerDto[],
  revealed: boolean,
): PlayerDto[] {
  if (!revealed) {
    return [...players];
  }

  return [...players].sort((leftPlayer, rightPlayer) => {
    const leftVote = Number(leftPlayer.vote);
    const rightVote = Number(rightPlayer.vote);
    const leftIsNumber = Number.isFinite(leftVote);
    const rightIsNumber = Number.isFinite(rightVote);

    if (!leftIsNumber && !rightIsNumber) {
      return leftPlayer.name.localeCompare(rightPlayer.name);
    }
    if (!leftIsNumber) {
      return 1;
    }
    if (!rightIsNumber) {
      return -1;
    }

    return leftVote - rightVote;
  });
}

export function getVisibleVoteValue(
  player: PlayerDto,
  options: {
    revealed: boolean;
    socketId: string | null;
  },
): string {
  if (!player.vote) {
    return '?';
  }

  if (options.revealed || player.id === options.socketId) {
    return player.vote;
  }

  return '?';
}
