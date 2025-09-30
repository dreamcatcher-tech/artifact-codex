import Debug from 'debug'

type ProxyConfig = {
  apiKey: string
  apiBase: URL
  allowedOrigins: string[]
  project?: string
  organization?: string
  betaHeader?: string
}

const hopByHopHeaders = new Set(
  [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'content-length',
    'host',
  ],
)

export function normalizeAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return ['*']
  }

  const entries = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (entries.length === 0) {
    return ['*']
  }

  return Array.from(new Set(entries))
}

export function isOriginAllowed(
  origin: string | null,
  allowed: string[],
): boolean {
  if (!origin) {
    return true
  }

  if (allowed.includes('*')) {
    return true
  }

  return allowed.includes(origin)
}

function resolveCorsOrigin(
  origin: string | null,
  allowed: string[],
): string {
  if (allowed.includes('*')) {
    return '*'
  }

  if (origin && allowed.includes(origin)) {
    return origin
  }

  // fall back to the first allowed origin to make preflight caching stable
  return allowed[0] ?? '*'
}

function applyCorsHeaders(
  responseHeaders: Headers,
  corsHeaders: Headers,
): void {
  for (const [key, value] of corsHeaders.entries()) {
    if (key.toLowerCase() === 'vary') {
      const current = responseHeaders.get('Vary')
      responseHeaders.set(
        'Vary',
        current ? `${current}, ${value}` : value,
      )
      continue
    }

    responseHeaders.set(key, value)
  }
}

function buildCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): Headers {
  const headers = new Headers()
  headers.set(
    'Access-Control-Allow-Origin',
    resolveCorsOrigin(origin, allowedOrigins),
  )
  headers.set('Vary', 'Origin')
  headers.set('Access-Control-Allow-Credentials', 'false')
  return headers
}

function sanitizeUpstreamHeaders(
  incoming: Headers,
  config: ProxyConfig,
): Headers {
  const sanitized = new Headers()

  for (const [key, value] of incoming.entries()) {
    if (hopByHopHeaders.has(key.toLowerCase())) {
      continue
    }

    if (key.toLowerCase() === 'authorization') {
      continue
    }

    sanitized.set(key, value)
  }

  sanitized.set('Authorization', `Bearer ${config.apiKey}`)

  if (config.organization) {
    sanitized.set('OpenAI-Organization', config.organization)
  }

  if (config.project) {
    sanitized.set('OpenAI-Project', config.project)
  }

  if (config.betaHeader && !sanitized.has('OpenAI-Beta')) {
    sanitized.set('OpenAI-Beta', config.betaHeader)
  }

  sanitized.set('User-Agent', 'fly-openai-proxy/1.0')

  return sanitized
}

const log = Debug('@artifact/fly-openai')

export function createProxyHandler(config: ProxyConfig) {
  return async function handle(req: Request): Promise<Response> {
    const requestUrl = new URL(req.url)
    const origin = req.headers.get('Origin')
    const started = performance.now()
    const requestPath = `${requestUrl.pathname}${requestUrl.search}`

    log('%s %s', req.method, requestPath)

    const respond = (res: Response): Response => {
      const duration = Math.round(performance.now() - started)
      const statusText = res.statusText ? ` ${res.statusText}` : ''
      log(
        '%s %s -> %d%s %dms',
        req.method,
        requestPath,
        res.status,
        statusText,
        duration,
      )
      return res
    }

    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      return respond(new Response('Origin not allowed', { status: 403 }))
    }

    const corsHeaders = buildCorsHeaders(origin, config.allowedOrigins)

    if (req.method === 'OPTIONS') {
      const headers = new Headers(corsHeaders)
      headers.set(
        'Access-Control-Allow-Methods',
        'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      )
      headers.set(
        'Access-Control-Allow-Headers',
        req.headers.get('Access-Control-Request-Headers') ??
          'Authorization, Content-Type, OpenAI-Beta, OpenAI-Project',
      )
      headers.set('Access-Control-Max-Age', '600')
      return respond(new Response(null, { status: 204, headers }))
    }

    if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
      const headers = new Headers(corsHeaders)
      headers.set('Content-Type', 'application/json; charset=utf-8')
      return respond(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers,
        }),
      )
    }

    const upstreamUrl = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      config.apiBase,
    )

    const upstreamHeaders = sanitizeUpstreamHeaders(req.headers, config)

    const init: RequestInit = {
      method: req.method,
      headers: upstreamHeaders,
      body: req.body,
      redirect: 'manual',
    }

    if (req.body && !['GET', 'HEAD'].includes(req.method)) {
      // deno requires explicit duplex to forward streaming bodies
      ;(init as { duplex: 'half' }).duplex = 'half'
    }

    let upstream: Response

    try {
      upstream = await fetch(upstreamUrl, init)
    } catch (error) {
      log('upstream request failed: %o', error)
      const headers = new Headers(corsHeaders)
      headers.set('Content-Type', 'application/json; charset=utf-8')
      return respond(
        new Response(JSON.stringify({ error: 'bad_gateway' }), {
          status: 502,
          headers,
        }),
      )
    }

    const responseHeaders = new Headers()

    for (const [key, value] of upstream.headers.entries()) {
      if (hopByHopHeaders.has(key.toLowerCase())) {
        continue
      }

      responseHeaders.set(key, value)
    }

    applyCorsHeaders(responseHeaders, corsHeaders)

    responseHeaders.set('Access-Control-Expose-Headers', '*')
    responseHeaders.delete('Content-Length')

    return respond(
      new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      }),
    )
  }
}

function loadConfigFromEnv(): ProxyConfig {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required')
  }

  const apiBaseRaw = Deno.env.get('OPENAI_API_BASE')?.trim() ??
    'https://api.openai.com'
  const apiBase = new URL(
    apiBaseRaw.endsWith('/') ? apiBaseRaw : `${apiBaseRaw}/`,
  )

  const allowedOrigins = normalizeAllowedOrigins(
    Deno.env.get('ALLOWED_ORIGINS'),
  )

  const project = Deno.env.get('OPENAI_PROJECT')?.trim()
  const organization = Deno.env.get('OPENAI_ORG_ID')?.trim()
  const betaHeader = Deno.env.get('OPENAI_BETA_HEADER')?.trim()

  return {
    apiKey,
    apiBase,
    allowedOrigins,
    project: project?.length ? project : undefined,
    organization: organization?.length ? organization : undefined,
    betaHeader: betaHeader?.length ? betaHeader : undefined,
  }
}

if (import.meta.main) {
  Debug.enable('@artifact/fly-openai:*')

  const config = loadConfigFromEnv()
  const port = Number(Deno.env.get('PORT') ?? '8080')

  log(
    'starting openai proxy on port=%d target=%s',
    port,
    config.apiBase.toString(),
  )

  Deno.serve({ port }, createProxyHandler(config))
}
