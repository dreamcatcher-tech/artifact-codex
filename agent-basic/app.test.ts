import { expect } from '@std/expect'
import type { Face, FaceKindId } from '@artifact/shared'
import type { FaceKindConfig } from '@artifact/web-server'

import { selectDefaultFaceKindId } from './app.ts'

const stubStatus = {
  startedAt: '2024-01-01T00:00:00.000Z',
  closed: false,
  interactions: 0,
} as const

function createStubFace(): Face {
  return {
    interaction: () => {},
    awaitInteraction: () => '',
    cancel: () => {},
    destroy: () => {},
    status: () => ({ ...stubStatus }),
  }
}

function makeFaceKind(id: FaceKindId): FaceKindConfig {
  return {
    id,
    title: id,
    description: `${id} face`,
    create: () => createStubFace(),
  }
}

Deno.test('selectDefaultFaceKindId falls back to the first face kind', () => {
  const faceKinds = [makeFaceKind('test'), makeFaceKind('inspector')]
  expect(selectDefaultFaceKindId(faceKinds)).toBe('test')
})

Deno.test('selectDefaultFaceKindId handles single face kind', () => {
  const faceKinds = [makeFaceKind('cmd')]
  expect(selectDefaultFaceKindId(faceKinds)).toBe('cmd')
})
