export const FLY_REPLAY_CONTENT_TYPE = 'application/vnd.fly.replay+json'

/**
 * Typed representation of the JSON body accepted by Fly Proxy for replaying requests.
 * See https://fly.io/docs/networking/dynamic-request-routing/ for full semantics.
 */
export interface FlyReplayPayload {
  /** Comma-separated Fly region codes (e.g., "iad,ord,any"). */
  region?: string
  /** Force replay to the exact Machine ID provided. */
  instance?: string
  /** Prefer this Machine ID, but allow Fly to fall back when unavailable. */
  prefer_instance?: string
  /** Replay to a different Fly app within the same organization. */
  app?: string
  /** Arbitrary metadata echoed back in `fly-replay-src`. */
  state?: string
  /** Exclude the current Machine on the next load balance pass. */
  elsewhere?: boolean
  /** Apply request mutations before the replay is delivered. */
  transform?: FlyReplayTransform
  /** Configure Fly Proxy replay caching behaviour. */
  cache?: FlyReplayCache
  /** Allow clients to bypass an existing replay cache entry. */
  allow_bypass?: boolean
}

/** Request transformation instructions evaluated by Fly Proxy prior to replay. */
export interface FlyReplayTransform {
  /** Override the path and query string on the replayed request. */
  path?: string
  /** Remove headers from the replayed request. */
  delete_headers?: string[]
  /** Add or overwrite headers on the replayed request. */
  set_headers?: FlyReplayHeaderOverride[]
}

/** Header override applied during replay request transformation. */
export interface FlyReplayHeaderOverride {
  /** Header name to set on the replayed request. */
  name: string
  /** Header value to set on the replayed request. */
  value: string
}

/** Replay cache configuration evaluated by Fly Proxy. */
export interface FlyReplayCache {
  /** Path pattern (`/path/*`) used to match cached replays. */
  prefix?: string
  /** Time-to-live for the cached replay, expressed in seconds. */
  ttl?: number
  /** Invalidate a previously cached replay for this route when true. */
  invalidate?: boolean
}
