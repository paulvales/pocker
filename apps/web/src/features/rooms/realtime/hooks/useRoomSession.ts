import { useContext, useMemo, useSyncExternalStore } from 'react';

import { RoomSessionContext } from '../RoomSessionContext';

export function useRoomSession() {
  const context = useContext(RoomSessionContext);

  if (!context) {
    throw new Error('ROOM_SESSION_CONTEXT_MISSING');
  }

  const state = useSyncExternalStore(
    context.store.subscribe,
    context.store.getState,
    context.store.getState,
  );

  return useMemo(() => {
    const currentPlayer =
      state.players.find((player) => player.id === state.currentPlayerId)
      || state.players.find((player) => player.id === state.socketId)
      || findCurrentPlayerFallback(state.players, state.session.userName, state.session.isAdmin);
    const adminPlayer = state.players.find((player) => player.isAdmin) || null;
    const selectedTask =
      state.taskState.items[state.taskState.selectedIndex] || null;

    return {
      ...state,
      currentPlayer,
      adminPlayer,
      selectedTask,
      actions: context.actions,
    };
  }, [context.actions, state]);
}

function findCurrentPlayerFallback(
  players: Array<{ id: string; isAdmin: boolean; name: string }>,
  userName: string,
  isAdmin: boolean,
) {
  if (!userName) {
    return null;
  }

  const exactRoleMatch =
    players.find((player) => player.name === userName && player.isAdmin === isAdmin)
    || null;

  if (exactRoleMatch) {
    return exactRoleMatch;
  }

  return players.find((player) => player.name === userName) || null;
}
