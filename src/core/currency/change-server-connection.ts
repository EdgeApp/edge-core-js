import {
  changeProtocol,
  SubscribeParams,
  SubscribeResult
} from './change-server-protocol'

interface ChangeServerCallbacks {
  handleChange: (address: SubscribeParams) => void
  handleConnect: () => void
  handleDisconnect: () => void
  handleSubLost: (params: SubscribeParams) => void
}

export interface ChangeServerConnection {
  subscribe: (params: SubscribeParams[]) => Promise<SubscribeResult[]>
  unsubscribe: (params: SubscribeParams[]) => Promise<void>
  close: () => void
  connected: boolean
}

/**
 * Bundles a change-server Websocket and codec pair.
 */
export function connectChangeServer(
  url: string,
  callbacks: ChangeServerCallbacks
): ChangeServerConnection {
  let ws: WebSocket
  let closing = false
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | undefined
  function makeWs(): void {
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.addEventListener('message', ev => {
      codec.handleMessage(ev.data)
    })

    ws.addEventListener('close', () => {
      out.connected = false
      codec.handleClose()
      callbacks.handleDisconnect()
      // Reconnect after 5 seconds, unless intentionally closed:
      reconnectTimeoutId = setTimeout(() => {
        if (!closing) {
          makeWs()
        }
      }, 5000)
    })

    ws.addEventListener('error', errEvent => {
      console.error('changeServer websocket error:', errEvent)
      ws.close()
    })

    ws.addEventListener('open', () => {
      out.connected = true
      callbacks.handleConnect()
    })
  }
  makeWs()

  const codec = changeProtocol.makeClientCodec({
    // We failed to send a message, so shut down the socket:
    handleError(err) {
      console.error('changeServer error:', err)
      ws.close()
    },

    async handleSend(text) {
      ws.send(text)
    },

    localMethods: {
      update(params) {
        callbacks.handleChange(params)
      },
      subLost(params) {
        callbacks.handleSubLost(params)
      }
    }
  })

  const out: ChangeServerConnection = {
    async subscribe(params) {
      return await codec.remoteMethods.subscribe(params)
    },

    async unsubscribe(params) {
      await codec.remoteMethods.unsubscribe(params)
    },

    close() {
      closing = true
      if (reconnectTimeoutId != null) {
        clearTimeout(reconnectTimeoutId)
        reconnectTimeoutId = undefined
      }
      ws.close()
    },

    connected: false
  }
  return out
}
