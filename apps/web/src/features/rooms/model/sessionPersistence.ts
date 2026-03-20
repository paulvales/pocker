import { normalizeRoomSlug } from './roomRoute';

const PLAYER_NAME_STORAGE_KEY = 'pokerName';

function getAdminStorageKey(roomSlug: string): string {
  return `pokerAdmin:${normalizeRoomSlug(roomSlug) || 'default'}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readStoredPlayerName(): string {
  if (!canUseStorage()) {
    return '';
  }

  try {
    return window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function writeStoredPlayerName(playerName: string): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
  } catch {
    // ignore persistence errors
  }
}

export function clearStoredPlayerName(): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
  } catch {
    // ignore persistence errors
  }
}

export function readStoredAdminIntent(roomSlug: string): boolean {
  if (!canUseStorage()) {
    return false;
  }

  try {
    return window.localStorage.getItem(getAdminStorageKey(roomSlug)) === 'true';
  } catch {
    return false;
  }
}

export function writeStoredAdminIntent(
  roomSlug: string,
  isAdmin: boolean,
): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(getAdminStorageKey(roomSlug), String(isAdmin));
  } catch {
    // ignore persistence errors
  }
}

export function clearStoredAdminIntent(roomSlug: string): void {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(getAdminStorageKey(roomSlug));
  } catch {
    // ignore persistence errors
  }
}
