import { useEffect, useMemo } from 'react';

import { createRoomSocketGateway } from './api/createRoomSocketGateway';
import { createRoomSessionController } from './controller/createRoomSessionController';
import { RoomSessionContext } from './RoomSessionContext';

type RoomSessionProviderProps = {
  roomSlug: string;
  children: React.ReactNode;
};

export function RoomSessionProvider({
  roomSlug,
  children,
}: RoomSessionProviderProps) {
  const session = useMemo(() => {
    const serverOrigin =
      typeof import.meta.env.VITE_SERVER_ORIGIN === 'string'
        ? import.meta.env.VITE_SERVER_ORIGIN
        : undefined;
    const gateway = createRoomSocketGateway({
      serverOrigin,
    });

    return createRoomSessionController({
      routeRoomSlug: roomSlug,
      gateway,
    });
  }, [roomSlug]);

  useEffect(() => {
    session.start();
    return () => {
      session.stop();
    };
  }, [session]);

  const contextValue = useMemo(
    () => ({
      actions: session.actions,
      store: session.store,
    }),
    [session.actions, session.store],
  );

  return (
    <RoomSessionContext.Provider value={contextValue}>
      {children}
    </RoomSessionContext.Provider>
  );
}
