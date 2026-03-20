import { normalizeRoomSlug } from '@/features/rooms/model/roomRoute';

const VOTE_TTL_MS = 60 * 60 * 1000;

type StoredVotePayload = {
  expires: number;
  value: string;
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getVoteStorageKey(roomId: string, playerName: string): string {
  return `pokerVote:${normalizeRoomSlug(roomId)}:${String(playerName || '').trim()}`;
}

export function readStoredVote(
  roomId: string,
  playerName: string,
): string | null {
  if (!canUseStorage()) {
    return null;
  }

  const key = getVoteStorageKey(roomId, playerName);
  if (!key) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return null;
    }

    const payload = JSON.parse(rawValue) as StoredVotePayload;
    if (!payload || typeof payload.value !== 'string' || typeof payload.expires !== 'number') {
      window.localStorage.removeItem(key);
      return null;
    }

    if (payload.expires < Date.now()) {
      window.localStorage.removeItem(key);
      return null;
    }

    return payload.value;
  } catch {
    return null;
  }
}

export function writeStoredVote(
  roomId: string,
  playerName: string,
  value: string,
): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    const key = getVoteStorageKey(roomId, playerName);
    window.localStorage.setItem(
      key,
      JSON.stringify({
        expires: Date.now() + VOTE_TTL_MS,
        value,
      } satisfies StoredVotePayload),
    );
  } catch {
    // ignore persistence errors
  }
}

export function clearStoredVote(roomId: string, playerName: string): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(getVoteStorageKey(roomId, playerName));
  } catch {
    // ignore persistence errors
  }
}
