export function readAppVersionLabel(): string {
  if (typeof document === 'undefined') {
    return '';
  }

  return (
    document
      .querySelector('meta[name="app-version"]')
      ?.getAttribute('content')
      ?.trim() || ''
  );
}
