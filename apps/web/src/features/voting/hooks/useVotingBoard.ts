import type { EstimationMode, PlayerDto } from '@contracts';
import { useEffect, useMemo, useRef } from 'react';

import {
  clearStoredVote,
  readStoredVote,
  writeStoredVote,
} from '../model/votePersistence';
import {
  calculateAverageVote,
  getAverageVoteLabel,
  getVoteValuesForMode,
  hasNumericVotes,
  sortPlayersForDisplay,
} from '../model/voteScale';

type UseVotingBoardInput = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  currentPlayer: PlayerDto | null;
  estimationMode: EstimationMode;
  players: PlayerDto[];
  revealed: boolean;
  roomId: string;
  userName: string;
  vote: (value: string | null) => void;
};

export function useVotingBoard(input: UseVotingBoardInput) {
  const {
    connectionStatus,
    currentPlayer,
    estimationMode,
    players,
    revealed,
    roomId,
    userName,
    vote,
  } = input;
  const voteRestoreKeyRef = useRef('');
  const storageScopeKey = roomId && userName
    ? `${roomId}:${userName}`
    : '';

  useEffect(() => {
    voteRestoreKeyRef.current = '';
  }, [storageScopeKey]);

  useEffect(() => {
    if (!storageScopeKey || !currentPlayer || currentPlayer.vote !== null) {
      return;
    }
    if (voteRestoreKeyRef.current === storageScopeKey) {
      return;
    }

    voteRestoreKeyRef.current = storageScopeKey;
    const storedVote = readStoredVote(roomId, userName);

    if (storedVote) {
      vote(storedVote);
    }
  }, [currentPlayer, roomId, storageScopeKey, userName, vote]);

  useEffect(() => {
    if (!storageScopeKey || !currentPlayer) {
      return;
    }

    if (typeof currentPlayer.vote === 'string') {
      writeStoredVote(roomId, userName, currentPlayer.vote);
      return;
    }

    clearStoredVote(roomId, userName);
  }, [currentPlayer, roomId, storageScopeKey, userName]);

  return useMemo(() => ({
    averageLabel: getAverageVoteLabel(estimationMode),
    averageValue: calculateAverageVote(players),
    canVote:
      connectionStatus === 'connected' && Boolean(currentPlayer),
    currentVote: currentPlayer?.vote ?? null,
    hasVotes: hasNumericVotes(players),
    orderedPlayers: sortPlayersForDisplay(players, revealed),
    voteValues: getVoteValuesForMode(estimationMode),
    visibleAverageValue: revealed
      ? calculateAverageVote(players)
      : 'Hidden until reveal',
  }), [
    connectionStatus,
    currentPlayer,
    estimationMode,
    players,
    revealed,
  ]);
}
