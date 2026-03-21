import { normalizeRoomSlug } from './roomRoute';

const PLAYER_NAME_STORAGE_KEY = 'pokerName';
const CREATE_ROOM_INTENT_STORAGE_KEY = 'pockerCreateRoomIntent';
const AUTO_JOIN_STORAGE_KEY_PREFIX = 'pockerAutoJoin:';

function getAdminStorageKey(roomSlug: string): string {
  return `pokerAdmin:${normalizeRoomSlug(roomSlug) || 'default'}`;
}

function getAutoJoinStorageKey(roomSlug: string): string {
  return `${AUTO_JOIN_STORAGE_KEY_PREFIX}${normalizeRoomSlug(roomSlug) || 'default'}`;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
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

export function readStoredAutoJoinIntent(roomSlug: string): boolean {
  if (!canUseSessionStorage()) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(getAutoJoinStorageKey(roomSlug)) === 'true';
  } catch {
    return false;
  }
}

export function writeStoredAutoJoinIntent(roomSlug: string): void {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(getAutoJoinStorageKey(roomSlug), 'true');
  } catch {
    // ignore persistence errors
  }
}

export function clearStoredAutoJoinIntent(roomSlug: string): void {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(getAutoJoinStorageKey(roomSlug));
  } catch {
    // ignore persistence errors
  }
}

export function readStoredCreateRoomIntent(): string {
  if (!canUseSessionStorage()) {
    return '';
  }

  try {
    return normalizeRoomSlug(
      window.sessionStorage.getItem(CREATE_ROOM_INTENT_STORAGE_KEY) || '',
    );
  } catch {
    return '';
  }
}

export function writeStoredCreateRoomIntent(roomSlug: string): void {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      CREATE_ROOM_INTENT_STORAGE_KEY,
      normalizeRoomSlug(roomSlug),
    );
  } catch {
    // ignore persistence errors
  }
}

export function clearStoredCreateRoomIntent(): void {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(CREATE_ROOM_INTENT_STORAGE_KEY);
  } catch {
    // ignore persistence errors
  }
}
