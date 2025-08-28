import { beforeEach, describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'

function write(term: Terminal, data: string) {
  return new Promise<void>((resolve) => term.write(data, resolve))
}

function getCell(term: Terminal, x: number, y = 0) {
  const line = term.buffer.active.getLine(y)
  if (!line) throw new Error(`No line ${y}`)
  const cell = line.getCell(x)
  if (!cell) throw new Error(`No cell ${x},${y}`)
  return cell
}

describe('xterm ANSI/color handling', () => {
  let term: Terminal

  beforeEach(() => {
    term = new Terminal({ cols: 80, rows: 5, convertEol: true })
    // Not opening on a real DOM to avoid renderer requirements; parser + buffer still work.
  })

  it('applies standard SGR colors (red)', async () => {
    await write(term, '\u001b[31mRED\u001b[0m')
    const c0 = getCell(term, 0)
    expect(c0.getChars()).toBe('R')
    expect(c0.isFgPalette()).toBe(true)
    expect(c0.getFgColor()).toBe(1) // palette index 1 = red
    const c2 = getCell(term, 2)
    expect(c2.getChars()).toBe('D')
    expect(c2.isFgPalette()).toBe(true)
  })

  it('resets attributes with SGR 0', async () => {
    await write(term, '\u001b[31mR\u001b[0mX')
    const resetCell = getCell(term, 1) // X follows immediately after R
    expect(resetCell.getChars()).toBe('X')
    expect(resetCell.isFgDefault()).toBe(true)
  })

  it('supports 256-color palette (38;5;n)', async () => {
    await write(term, '\u001b[38;5;196mX\u001b[0m')
    const cell = getCell(term, 0)
    expect(cell.getChars()).toBe('X')
    expect(cell.isFgPalette()).toBe(true)
    expect(cell.getFgColor()).toBe(196)
  })

  it('supports truecolor (38;2;r;g;b)', async () => {
    await write(term, '\u001b[38;2;255;128;0mY\u001b[0m')
    const cell = getCell(term, 0)
    expect(cell.isFgRGB()).toBe(true)
    expect(cell.getFgColor()).toBe(0xff8000)
  })

  it('applies background color and bold', async () => {
    await write(term, '\u001b[1;42mZ\u001b[0m')
    const cell = getCell(term, 0)
    expect(cell.getChars()).toBe('Z')
    expect(cell.isBold() > 0).toBe(true)
    expect(cell.isBgPalette()).toBe(true)
    expect(cell.getBgColor()).toBe(2) // green background
  })
})
