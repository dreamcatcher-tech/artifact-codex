export async function startNotifyWatcher(
  dir: string,
  onNotify: (raw: string) => void | Promise<void>,
  filename = 'notify.json',
): Promise<void> {
  const filePath = `${dir}/${filename}`
  const watcher = Deno.watchFs(dir)
  try {
    let created = false
    try {
      const s = await Deno.stat(filePath)
      created = s.isFile
    } catch {
      // ignore
    }
    if (created) {
      try {
        const raw = await Deno.readTextFile(filePath)
        await onNotify(raw)
      } finally {
        try {
          await Deno.remove(filePath)
        } catch {
          // ignore
        }
      }
      return
    }
    for await (const ev of watcher) {
      if (
        (ev.kind === 'create' || ev.kind === 'modify') &&
        ev.paths.some((p) => p === filePath)
      ) {
        try {
          const raw = await Deno.readTextFile(filePath)
          await onNotify(raw)
        } catch {
          await new Promise((r) => setTimeout(r, 10))
          try {
            const raw = await Deno.readTextFile(filePath)
            await onNotify(raw)
          } catch {
            // give up silently
          }
        } finally {
          try {
            await Deno.remove(filePath)
          } catch {
            // ignore
          }
        }
        break
      }
    }
  } finally {
    watcher.close()
  }
}
