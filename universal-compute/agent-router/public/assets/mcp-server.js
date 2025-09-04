// Minimal MCP server running in the browser using a postMessage transport.
// - Transport: MessageChannel port provided by the parent window via postMessage
// - SDK: @modelcontextprotocol/sdk (ESM via esm.sh)

import { McpServer } from 'https://esm.sh/@modelcontextprotocol/sdk@1.17.4/server/mcp'

class PostMessageServerTransport {
  constructor(port) {
    this._port = port
    this._started = false
    /** @type {(msg:any, extra?: any)=>void} */
    this.onmessage = undefined
    /** @type {()=>void} */
    this.onclose = undefined
    /** @type {(err:Error)=>void} */
    this.onerror = undefined
    this.sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Math.random())
  }
  async start() {
    if (this._started) return
    this._started = true
    try {
      this._port.onmessage = (ev) => {
        try {
          this.onmessage && this.onmessage(ev.data)
        } catch (e) {
          this.onerror && this.onerror(e)
        }
      }
      // Some browsers require start() before receiving messages.
      if (this._port.start) this._port.start()
    } catch (e) {
      this.onerror && this.onerror(e)
      throw e
    }
  }
  async send(message /*, options */) {
    try {
      this._port.postMessage(message)
    } catch (e) {
      this.onerror && this.onerror(e)
      throw e
    }
  }
  async close() {
    try {
      // MessagePort.close() prevents further events
      if (this._port && this._port.close) this._port.close()
    } finally {
      this.onclose && this.onclose()
    }
  }
}

const statusEl = document.getElementById('status')
const setStatus = (text) => statusEl && (statusEl.textContent = text)

async function waitForMessagePortFromParent(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('Timed out waiting for mcp:connect MessagePort'))
    }, timeoutMs)

    function onMessage(ev) {
      // Expect a transferred MessagePort in ev.ports[0]
      if (ev && ev.data && ev.data.type === 'mcp:connect' && ev.ports && ev.ports.length > 0) {
        clearTimeout(to)
        window.removeEventListener('message', onMessage)
        resolve(ev.ports[0])
      }
    }

    window.addEventListener('message', onMessage)
    // Let the parent know we are ready to accept a port
    try {
      const parentWin = window.opener || (window.parent !== window ? window.parent : null)
      if (parentWin) parentWin.postMessage({ type: 'mcp:server-ready' }, '*')
    } catch (_) {
      // ignore cross-origin errors; parent should still be able to postMessage to us
    }
  })
}

async function main() {
  try {
    setStatus('waiting for parent…')
    const port = await waitForMessagePortFromParent()
    setStatus('connecting…')

    const server = new McpServer({ name: 'browser-mcp', version: '0.1.0' })

    // Simple tools to prove round-trip works
    server.tool('ping', async () => ({
      content: [{ type: 'text', text: 'pong (from browser)' }],
    }))

    server.tool('info', 'Returns basic browser info', async () => ({
      content: [
        { type: 'text', text: `userAgent: ${navigator.userAgent}` },
        { type: 'text', text: `language: ${navigator.language}` },
      ],
    }))

    const transport = new PostMessageServerTransport(port)
    await server.connect(transport)
    setStatus('connected')
    // Optional: notify client that tool list is ready
    server.sendToolListChanged()
  } catch (err) {
    console.error('[mcp-server] failed to start:', err)
    setStatus('error')
  }
}

main()
