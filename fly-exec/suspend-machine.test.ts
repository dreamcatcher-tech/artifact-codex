import { expect } from '@std/expect'
import { FlyIoClient } from '@alexarena/fly-io-client'
import { suspendCurrentMachine } from './suspend-machine.ts'

const FLY_APP_NAME = 'my-app'
const FLY_MACHINE_ID = 'machine-123'

const fixture = (postRewrite: unknown) => {
  const originalPost = FlyIoClient.prototype.post
  FlyIoClient.prototype.post = postRewrite as typeof FlyIoClient.prototype.post
  return {
    [Symbol.dispose]() {
      FlyIoClient.prototype.post = originalPost
    },
  }
}

Deno.test('suspends current machine without injecting auth headers', async () => {
  const calls: Array<{ path: string; options?: unknown }> = []

  const post = (path: string, options?: unknown) => {
    calls.push({ path, options })
    return Promise.resolve()
  }
  using _ = fixture(post)

  const result = await suspendCurrentMachine({ FLY_APP_NAME, FLY_MACHINE_ID })
  expect(result).toBeUndefined()

  expect(calls).toHaveLength(1)

  const [{ path, options }] = calls
  expect(path).toBe('/apps/my-app/machines/machine-123/suspend')

  let headerValues: Headers | undefined
  let nullHeaders: Set<string> | undefined
  if (options && typeof options === 'object' && 'headers' in options) {
    const candidate = (options as { headers?: unknown }).headers
    if (
      candidate &&
      typeof candidate === 'object' &&
      'values' in candidate &&
      (candidate as { values?: unknown }).values instanceof Headers
    ) {
      headerValues = (candidate as { values: Headers }).values
      const maybeNulls = (candidate as { nulls?: unknown }).nulls
      if (maybeNulls instanceof Set) {
        nullHeaders = maybeNulls as Set<string>
      }
    }
  }

  expect(headerValues).toBeDefined()
  expect(headerValues?.get('authorization')).toBeNull()
  expect(headerValues?.get('accept')).toBe('*/*')
  expect(nullHeaders?.has('authorization')).toBe(false)
})

Deno.test('wraps errors from suspend endpoint with machine context', async () => {
  const failure = new Error('Request failed with status 500')
  const post = () => {
    return Promise.reject(failure)
  }
  using _ = fixture(post)

  await expect(suspendCurrentMachine({ FLY_APP_NAME, FLY_MACHINE_ID }))
    .rejects.toThrow(
      'Failed to suspend machine machine-123: Request failed with status 500',
    )
})
