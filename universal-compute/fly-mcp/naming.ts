export function deriveBaseName(input: string): string {
  return input.replace(/-(\d+)$/, '')
}

export function nextIndexForName(
  names: Array<string | undefined>,
  base: string,
): number {
  let max = -1
  for (const n of names) {
    if (!n) continue
    if (!n.startsWith(base + '-')) continue
    const rest = n.slice(base.length + 1)
    if (/^\d+$/.test(rest)) {
      const idx = parseInt(rest, 10)
      if (Number.isFinite(idx)) max = Math.max(max, idx)
    }
  }
  return max + 1
}
