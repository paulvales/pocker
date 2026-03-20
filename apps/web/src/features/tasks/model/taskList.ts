export function parseTaskListInput(rawValue: string): string[] {
  return Array.from(new Set(String(rawValue || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

export function getIssueIdFromText(text: string): string {
  const match = String(text || '').match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
  return match ? match[1].toUpperCase() : '';
}

export function getTaskHref(taskReference: string): string | null {
  const rawValue = String(taskReference || '').trim();
  if (!rawValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawValue);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:'
      ? parsedUrl.toString()
      : null;
  } catch {
    return null;
  }
}

export function getTaskLabel(taskReference: string): string {
  const issueId = getIssueIdFromText(taskReference);
  if (issueId) {
    return issueId;
  }

  try {
    const parsedUrl = new URL(taskReference);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments.pop();
    return decodeURIComponent(lastSegment || parsedUrl.hostname);
  } catch {
    return taskReference.length > 42
      ? `${taskReference.slice(0, 39)}...`
      : taskReference;
  }
}
