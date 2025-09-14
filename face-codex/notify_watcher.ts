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
): Promise<void> {
  const filePath = `${dir}/${filename}`
  const watcher = Deno.watchFs(dir)
  try {
    try {
      const st = await Deno.stat(filePath)
      if (st.isFile) {
        await consumeNotification(filePath, onNotify)
        return
      }
    } catch {
      // ignore missing
    }
    for await (const ev of watcher) {
      if (
        (ev.kind === 'create' || ev.kind === 'modify') &&
        ev.paths.some((p) => p === filePath)
      ) {
        await consumeNotification(filePath, onNotify)
        break
      }
    }
  } finally {
    watcher.close()
  }
}
