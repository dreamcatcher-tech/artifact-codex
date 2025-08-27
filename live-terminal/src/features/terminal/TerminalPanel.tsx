import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

type Props = {
  url?: string
  useMock?: boolean
  minCols?: number
}

export default function TerminalPanel({ url = '/api/stream', useMock = true, minCols = 80 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const lineBufRef = useRef<string>('')
  const maxColsRef = useRef<number>(minCols)
  const abortRef = useRef<AbortController | null>(null)
  const inputBufRef = useRef('')
  const [connected, setConnected] = useState(false)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const rootStyles = getComputedStyle(document.documentElement)
    const bg = (rootStyles.getPropertyValue('--terminal-bg') || '#0b0c0f').trim()
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: bg },
    })
    termRef.current = term

    if (containerRef.current) {
      const fit = new FitAddon()
      fitRef.current = fit
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit() // fit rows/cols to viewport width/height
      // Enforce minimum columns and any previously expanded width
      const targetCols = Math.max(minCols, maxColsRef.current, term.cols)
      if (targetCols !== term.cols) term.resize(targetCols, term.rows)
      setMinWidthPx(term)
      term.focus()
    }

    // Hook stdin: capture keystrokes
    const disposeData = term.onData((data) => handleInput(data))

    const ro = new ResizeObserver(() => {
      // Fit rows to container height; keep columns at least min/max
      fitRef.current?.fit()
      const targetCols = Math.max(minCols, maxColsRef.current, term.cols)
      if (targetCols !== term.cols) term.resize(targetCols, term.rows)
      setMinWidthPx(term)
    })
    if (containerRef.current) ro.observe(containerRef.current)

    term.writeln('Connecting to remote process...')
    startStream()

    return () => {
      ro.disconnect()
      abortRef.current?.abort('unmount')
      term.dispose()
      disposeData.dispose()
    }
  }, [])

  async function startStream() {
    const term = termRef.current!
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const stream = useMock ? createMockStdoutStream() : await fetchStream(url, abort.signal)
      setConnected(true)
      term.writeln('Connected. Streaming output...\r\n')
      await pumpStreamToTerminal(stream, term, abort.signal, (t) => updateWidth(t, term))
      term.writeln('\r\n<stream closed>')
    } catch (err: unknown) {
      if ((err as any)?.name === 'AbortError') return
      term.writeln(`\r\n<error> ${(err as Error).message}`)
    }
  }

  function stripAnsi(input: string) {
    const pattern = /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g
    return input.replace(pattern, '')
  }

  function updateWidth(text: string, term: Terminal) {
    // Reset line buffer on carriage return and newline; keep only current line content
    const lastCr = text.lastIndexOf('\r')
    let fragment = text
    if (lastCr >= 0) fragment = text.slice(lastCr + 1)
    const parts = fragment.split('\n')
    if (parts.length === 1) {
      lineBufRef.current += parts[0]
    } else {
      lineBufRef.current = parts[parts.length - 1]
    }
    const visible = stripAnsi(lineBufRef.current)
    const len = [...visible].length
    if (len > maxColsRef.current) {
      maxColsRef.current = len
      term.resize(maxColsRef.current, term.rows)
      setMinWidthPx(term)
    }
  }

  function setMinWidthPx(term: Terminal) {
    const anyTerm = term as unknown as { _core?: any }
    const cw = anyTerm._core?.
      _renderService?.
      dimensions?.
      css?.
      cell?.
      width
    const cellWidth = typeof cw === 'number' && cw > 0 ? cw : 9
    const minPx = Math.ceil(cellWidth * maxColsRef.current)
    if (containerRef.current) {
      containerRef.current.style.minWidth = `${minPx}px`
    }
  }

  function handleInput(data: string) {
    if (data === '\u0003') {
      termRef.current?.write('^C\r\n')
      inputBufRef.current = ''
      return
    }
    if (data === '\r') {
      const line = inputBufRef.current
      termRef.current?.write('\r\n')
      inputBufRef.current = ''
      // deno-lint-ignore no-console
      console.log('stdin:', line)
      const color = '\u001b[36m'
      termRef.current?.writeln(`${color}> received: ${line}\u001b[0m`)
      updateWidth(`> received: ${line}`, termRef.current!)
      return
    }
    if (data === '\u007F') {
      if (inputBufRef.current.length > 0) {
        inputBufRef.current = inputBufRef.current.slice(0, -1)
        termRef.current?.write('\b \b')
      }
      return
    }
    inputBufRef.current += data
    termRef.current?.write(data)
    updateWidth(data, termRef.current!)
  }

  return (
    <div style={{ height: '100%', width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
      <div
        ref={containerRef}
        style={{
          height: '100%',
          width: '100%',
          display: 'block',
        }}
        tabIndex={0}
        onMouseDown={() => termRef.current?.focus()}
        onTouchStart={() => termRef.current?.focus()}
      />
    </div>
  )

  
}

async function pumpStreamToTerminal(
  stream: ReadableStream<Uint8Array>,
  term: Terminal,
  signal?: AbortSignal,
  onText?: (text: string) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (value) {
        const text = decoder.decode(value)
        term.write(text)
        onText?.(text)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function fetchStream(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Failed to fetch stream: ${res.status}`)
  return res.body
}

function createMockStdoutStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const lines = [
    '\u001b[1;36mBooting remote container...\u001b[0m\n',
    'Pulling image layers [\u001b[33m##########\u001b[0m] 100%\n',
    'Starting process: \u001b[32m/app/bin/service --verbose\u001b[0m\n',
    '\nLog output:\n',
  ]
  let i = 0
  let tick = 0

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const interval = setInterval(() => {
        if (i < lines.length) {
          controller.enqueue(encoder.encode(lines[i++]))
          return
        }
        tick++
        const color = tick % 3 === 0 ? '\u001b[32m' : tick % 3 === 1 ? '\u001b[33m' : '\u001b[31m'
        const msg = `${color}[${new Date().toISOString()}] heartbeat ${tick} — all systems nominal\u001b[0m\n`
        controller.enqueue(encoder.encode(msg))
        if (tick >= 12) {
          clearInterval(interval)
          controller.close()
        }
      }, 500)
    },
  })
}

function CommandInput({
  onSend,
  disabled,
}: {
  onSend: (value: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim()) return
        onSend(value)
        setValue('')
      }}
      style={{ display: 'flex', gap: 8 }}
    >
      <input
        type="text"
        placeholder={disabled ? 'Connecting…' : 'Type a command and press Enter'}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        disabled={disabled}
        style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #2a2d34' }}
      />
      <button type="submit" disabled={disabled}>
        Send
      </button>
    </form>
  )
}

 
