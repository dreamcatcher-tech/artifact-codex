export function slugify(value: string): string {
  const lower = value.toLowerCase()
  const replaced = lower.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-')
  return replaced.replace(/^-+|-+$/g, '')
}

export function segmentsToSlugs(segments: string[]): string[] {
  return segments.map((segment) => slugify(segment))
}
