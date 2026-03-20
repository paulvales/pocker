import { createContext } from 'react';

import type { RoomSessionActions, RoomSessionStore } from './types';

export type RoomSessionContextValue = {
  actions: RoomSessionActions;
  store: RoomSessionStore;
};

export const RoomSessionContext = createContext<RoomSessionContextValue | null>(
  null,
);
