/** "Load URL" in the workspace: a GET from the extension page (no CORS limits with host permissions). */

export type FetchOutcome =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string | null;
      text: string;
      ms: number;
      requestHeaders: Record<string, string>;
      responseHeaders: [string, string][];
      credentials: RequestCredentials;
    }
  | {
      ok: false;
      url: string;
      error: string;
      requestHeaders: Record<string, string>;
      credentials: RequestCredentials;
    };

/** Parse `Name: value` lines. Blank lines and `#` comments are skipped. */
export function parseHeaderLines(text: string): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {};
  const errors: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    const name = i > 0 ? line.slice(0, i).trim() : '';
    if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) {
      errors.push(line.length > 30 ? line.slice(0, 30) + '…' : line);
      continue;
    }
    headers[name] = line.slice(i + 1).trim();
  }
  return { headers, errors };
}

export async function fetchJson(url: string, headers: Record<string, string>, sendCookies: boolean): Promise<FetchOutcome> {
  const credentials: RequestCredentials = sendCookies ? 'include' : 'omit';
  const t0 = performance.now();
  try {
    const res = await fetch(url, { method: 'GET', headers, credentials, cache: 'no-store' });
    const text = await res.text();
    return {
      ok: true,
      url: res.url || url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      text,
      ms: Math.round(performance.now() - t0),
      requestHeaders: headers,
      responseHeaders: Array.from(res.headers.entries()),
      credentials,
    };
  } catch (e) {
    return { ok: false, url, error: (e as Error).message || 'Network error', requestHeaders: headers, credentials };
  }
}
