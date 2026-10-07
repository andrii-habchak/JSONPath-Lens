import http from 'node:http';
import type { AddressInfo } from 'node:net';

export const SAMPLE = {
  array: [
    { key: 1, dictionary: { a: 'x' } },
    { key: 2, dictionary: { a: 'yes' } },
  ],
  users: [
    { name: 'Andrii', email: 'a@gmail.com', id: 'BIG_ID' }, // replaced by an unsafe integer below
    { name: 'bob', email: 'bob@corp.io', id: 2 },
  ],
};

const SAMPLE_TEXT = JSON.stringify(SAMPLE).replace('"BIG_ID"', '12345678901234567890');

const NDJSON = [
  '{"level":"INFO","service":"wallet","msg":"ok"}',
  '{"level":"ERROR","service":"wallet","msg":"insufficient funds"}',
  'this line is broken',
  '{"level":"ERROR","service":"bonus","msg":"expired"}',
].join('\n');

type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

const send =
  (body: string, type: string, extra: Record<string, string> = {}): Route =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': type, ...extra });
    res.end(body);
  };

const routes: Record<string, Route> = {
  '/data.json': send(SAMPLE_TEXT, 'application/json'),
  '/csp.json': send(SAMPLE_TEXT, 'application/json; charset=utf-8', {
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  }),
  '/sandboxed.json': send(SAMPLE_TEXT, 'application/json', {
    'content-security-policy': "default-src 'none'; sandbox",
  }),
  '/plain.json': send(SAMPLE_TEXT, 'text/plain; charset=utf-8'),
  '/problem.json': send('{"type":"about:blank","status":404}', 'application/problem+json'),
  '/not-json.txt': send('hello, this is just text', 'text/plain'),
  '/broken.json': send('{\n  "a": 1,\n  "b": }', 'application/json'),
  '/lines.txt': send(NDJSON, 'text/plain'),
  '/page.html': send('<!doctype html><title>page</title><p>Not JSON</p>', 'text/html'),
  '/auth.json': (req, res) => {
    if (req.headers.authorization !== 'Bearer secret-token') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end('{"error":"unauthorized"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"user":{"id":7,"roles":["admin","dev"]}}');
  },
  '/embed.html': (req, res) => {
    const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><iframe id="f" src="chrome-extension://${id}/viewer.html?stash=forged" width="800" height="300"></iframe>`);
  },
  '/export.ndjson': send(NDJSON, 'application/x-ndjson', { 'content-disposition': 'attachment; filename="export.ndjson"' }),
};

export async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const route = routes[path];
    if (route) route(req, res);
    else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
