// Minimal DOM polyfills for xterm in JSDOM
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore
globalThis.ResizeObserver = globalThis.ResizeObserver ||
  (NoopResizeObserver as any)
