export const FACE_KIND_SPECS = [
  {
    id: 'test',
    title: 'Test',
    description: 'A test face',
  },
  {
    id: 'inspector',
    title: 'Inspector',
    description: 'MCP Inspector that presents a web server UI',
  },
  {
    id: 'codex',
    title: 'Codex',
    description: 'Runs a Codex session and presents it in a ttyd ui',
  },
  {
    id: 'cmd',
    title: 'Command',
    description: 'Runs an arbitrary shell command in tmux with a ttyd view',
  },
] as const

export type FaceKindSpec = (typeof FACE_KIND_SPECS)[number]

export type FaceKindId = FaceKindSpec['id']

const FACE_KIND_SPEC_BY_ID = new Map<string, FaceKindSpec>(
  FACE_KIND_SPECS.map((spec) => [spec.id, spec]),
)

export function getFaceKindSpec(id: string): FaceKindSpec | undefined {
  return FACE_KIND_SPEC_BY_ID.get(id)
}

export function listFaceKindSpecs(): readonly FaceKindSpec[] {
  return FACE_KIND_SPECS
}

export function readConfiguredFaceKindSpecs(
  env: { get(name: string): string | undefined } = Deno.env,
): FaceKindSpec[] {
  const raw = env.get('DC_FACES')?.trim()
  if (!raw) {
    throw new Error('Missing DC_FACES environment variable')
  }
  const ids = raw.split(',').map((value) => value.trim()).filter((value) =>
    value.length > 0
  )
  if (ids.length === 0) {
    throw new Error('DC_FACES must list at least one face kind')
  }
  const seen = new Set<string>()
  const specs = ids.map((id) => {
    if (seen.has(id)) {
      throw new Error(`Duplicate face kind in DC_FACES: ${id}`)
    }
    seen.add(id)
    const spec = FACE_KIND_SPEC_BY_ID.get(id)
    if (!spec) {
      throw new Error(`Unknown face kind in DC_FACES: ${id}`)
    }
    return spec
  })
  return specs
}
