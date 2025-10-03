async function readStableJson(filePath: string): Promise<string | null> {
  for (let i = 0; i < 50; i++) {
    try {
      const raw = await Deno.readTextFile(filePath)
      try {
        JSON.parse(raw)
        return raw
      } catch {
        // ignore parse failure; retry
      }
    } catch {
      // ignore read errors; retry
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  return null
}

async function consumeNotification(
  filePath: string,
  onNotify: (raw: string) => void | Promise<void>,
): Promise<boolean> {
  try {
    const raw = await readStableJson(filePath)
    if (raw != null) await onNotify(raw)
    return raw != null
  } finally {
    try {
      await Deno.remove(filePath)
    } catch {
      // ignore
    }
  }
}

export async function startNotifyWatcher(
  dir: string,
  onNotify: (raw: string) => void | Promise<void>,
  filename = 'notify.json',
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return
  const filePath = `${dir}/${filename}`
  const watcher = Deno.watchFs(dir)
  const stop = () => {
    try {
      watcher.close()
    } catch {
      // ignore
    }
  }
  if (signal) {
    signal.addEventListener('abort', stop, { once: true })
  }
  try {
    if (signal?.aborted) return
    try {
      const st = await Deno.stat(filePath)
      if (st.isFile) {
        if (signal?.aborted) return
        await consumeNotification(filePath, onNotify)
        return
      }
    } catch {
      // ignore missing
    }
    for await (const ev of watcher) {
      if (signal?.aborted) break
      if (
        (ev.kind === 'create' || ev.kind === 'modify') &&
        ev.paths.some((p) => p === filePath)
      ) {
        if (signal?.aborted) break
        await consumeNotification(filePath, onNotify)
        break
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener('abort', stop)
    }
    stop()
  }
}
