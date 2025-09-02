const TTYD_ORIGIN = Deno.env.get('TTYD_ORIGIN') ?? 'https://codex-rs.fly.dev';
const DEBUG = /^(1|true|yes|on)$/i.test(Deno.env.get('DEBUG_TTYD_PROXY') ?? '');
// Use Node ws client to control headers (e.g., Origin) when dialing upstream
// deno-lint-ignore no-explicit-any
import WS from 'npm:ws';

const hopByHop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

const filterHeaders = (hdrs: Headers) => {
  const out = new Headers();
  hdrs.forEach((v, k) => {
    const key = k.toLowerCase();
    if (hopByHop.has(key)) return;
    // drop host/content-length; fetch sets them
    if (key === 'host' || key === 'content-length') return;
    out.set(k, v);
  });
  return out;
};

const rewriteLocation = (loc: string): string => {
  try {
    const u = new URL(loc, TTYD_ORIGIN);
    const base = new URL(TTYD_ORIGIN);
    if (u.origin === base.origin) {
      // map back under /tty
      const path = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
      const qs = u.search ?? '';
      return `/tty/${path}${qs}`.replace(/\/+$/, '/');
    }
  } catch {
    // ignore
  }
  return loc;
};

const mapPath = (incomingPath: string): string => {
  // /tty -> /
  if (incomingPath === '/tty') return '/';
  if (incomingPath.startsWith('/tty/')) return incomingPath.slice('/tty'.length);
  return incomingPath; // shouldn't happen
};

export const proxyHTTP = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const target = new URL(TTYD_ORIGIN);
  target.pathname = mapPath(url.pathname);
  target.search = url.search;

  const headers = filterHeaders(req.headers);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const method = req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : req.body;
  DEBUG && console.log('[ttyd:http] ->', method, target.toString());
  const upstream = await fetch(target.toString(), { method, headers, body, redirect: 'manual' });

  const resHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    if (hopByHop.has(k.toLowerCase())) return;
    if (k.toLowerCase() === 'location' && v) {
      resHeaders.set('location', rewriteLocation(v));
    } else {
      resHeaders.set(k, v);
    }
  });

  DEBUG && console.log('[ttyd:http] <-', upstream.status, target.toString());
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
};

export const proxyWS = (req: Request): Response => {
  const protoHeader = req.headers.get('sec-websocket-protocol') || '';
  const requested = protoHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const accept = requested.includes('tty') ? 'tty' : requested[0];

  const { socket: client, response } = accept
    ? Deno.upgradeWebSocket(req, { protocol: accept })
    : Deno.upgradeWebSocket(req);
  // Prefer ArrayBuffer to avoid Blob conversions
  try { (client as unknown as { binaryType?: string }).binaryType = 'arraybuffer'; } catch {}
  const inUrl = new URL(req.url);
  const target = new URL(TTYD_ORIGIN);
  target.protocol = 'wss:'; // ensure TLS
  target.pathname = mapPath(inUrl.pathname);
  target.search = inUrl.search;

  // Preserve requested subprotocols (e.g., 'tty') to satisfy ttyd
  const filtered = filterHeaders(req.headers);
  const headersObj: Record<string, string> = {};
  filtered.forEach((v, k) => (headersObj[k] = v));
  headersObj['x-forwarded-host'] = inUrl.host;
  headersObj['x-forwarded-proto'] = inUrl.protocol.replace(':', '');
  // Ensure cookies (session) propagate to upstream ttyd
  DEBUG && console.log('[ttyd:ws] ->', target.toString(), 'protocol=', accept);
  const upstream = new WS(target.toString(), accept ? accept : undefined, {
    origin: new URL(TTYD_ORIGIN).origin,
    rejectUnauthorized: true,
    perMessageDeflate: false,
    headers: headersObj,
  });

  // Pipe client -> upstream (handle string/blob/arraybuffer)
  client.onmessage = async (e) => {
    try {
      if (upstream.readyState !== WS.OPEN) return;
      const d = e.data as unknown;
      if (typeof d === 'string') {
        upstream.send(d);
      } else if (d instanceof Uint8Array) {
        upstream.send(d);
      } else if (d instanceof ArrayBuffer) {
        upstream.send(new Uint8Array(d));
      } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
        const ab = await d.arrayBuffer();
        upstream.send(new Uint8Array(ab));
      } else {
        // fallback: try toString
        upstream.send(String(d ?? ''));
      }
    } catch (_) {}
  };
  client.onclose = () => {
    try {
      if (upstream.readyState === WS.OPEN) upstream.close();
    } catch (_) {}
  };
  client.onerror = () => {
    try {
      if (upstream.readyState === WS.OPEN) upstream.close();
    } catch (_) {}
  };

  // Pipe upstream -> client
  upstream.on('open', () => {
    DEBUG && console.log('[ttyd:ws] open');
    // no-op
  });
  upstream.on('message', (data: WS.RawData) => {
    try {
      if (client.readyState === WebSocket.OPEN) {
        if (typeof data === 'string') client.send(data);
        else if (data instanceof Uint8Array) client.send(data);
        else if (data instanceof ArrayBuffer) client.send(new Uint8Array(data));
        else client.send(new Uint8Array(data as ArrayBuffer));
      }
    } catch (_) {}
  });
  upstream.on('close', (code: number, reason: Buffer) => {
    DEBUG && console.log('[ttyd:ws] close', code, reason?.toString());
    try {
      if (client.readyState === WebSocket.OPEN) client.close(code, reason?.toString());
    } catch (_) {}
  });
  upstream.on('error', () => {
    DEBUG && console.log('[ttyd:ws] error');
    try {
      if (client.readyState === WebSocket.OPEN) client.close();
    } catch (_) {}
  });

  return response;
};
