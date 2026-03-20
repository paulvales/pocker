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
      state.players.find((player) => player.id === state.socketId) || null;
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
