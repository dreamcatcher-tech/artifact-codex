import { checkPort } from '@openjs/port-free'
export async function waitForPort(
  port: number,
  host: string,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new Error('port was aborted already')
  }
  while (await checkPort(port, host)) {
    if (signal?.aborted) {
      throw new DOMException('port wait aborted', 'AbortError')
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 50)
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout)
        reject(new Error('port wait aborted'))
      }, { once: true })
    })
  }
}
