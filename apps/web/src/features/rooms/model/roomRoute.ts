const ROOM_ID_MAX_LENGTH = 64;
const ROOM_ID_PATTERN = new RegExp(
  `^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]{0,${ROOM_ID_MAX_LENGTH - 1}})?$`,
  'u',
);
const RESERVED_ROOM_IDS = new Set([
  'health',
  'version',
  'history',
  'index-html',
  'robots-txt',
  'socket-io',
]);

export function normalizeRoomSlug(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ROOM_ID_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
}

export function isValidRoomSlug(value: string): boolean {
  const normalizedRoomSlug = normalizeRoomSlug(value);
  return (
    Boolean(normalizedRoomSlug) &&
    !RESERVED_ROOM_IDS.has(normalizedRoomSlug) &&
    ROOM_ID_PATTERN.test(normalizedRoomSlug)
  );
}

export function buildRoomPath(roomSlug: string): string {
  const normalizedRoomSlug = normalizeRoomSlug(roomSlug);
  return normalizedRoomSlug ? `/${encodeURIComponent(normalizedRoomSlug)}` : '/';
}

export function buildRoomLink(roomSlug: string): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const normalizedRoomSlug = normalizeRoomSlug(roomSlug);
  if (!normalizedRoomSlug) {
    return '';
  }

  return `${window.location.origin}/${encodeURIComponent(normalizedRoomSlug)}/`;
}
