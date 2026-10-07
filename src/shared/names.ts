/** A short download name from a URL: last path segment, else the host. */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(seg || u.hostname || 'response');
  } catch {
    return 'response';
  }
}
