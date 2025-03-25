import { utf8 } from '../../util/encoding'
import {
  Address,
  changeProtocol,
  SubscribeResult
} from './change-server-protocol'

interface ChangeServerCallbacks {
  handleChange: (address: Address) => void
  handleClose: () => void
  handleConnect: () => void
}

export interface ChangeServerConnection {
  subscribe: (params: Address[]) => Promise<SubscribeResult[]>
  unsubscribe: (params: Address[]) => Promise<void>
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
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'

  const codec = changeProtocol.makeClientCodec({
    // We failed to send a message, so shut down the socket:
    handleError() {
      ws.close()
    },

    async handleSend(text) {
      ws.send(text)
    },

    localMethods: {
      update(params) {
        callbacks.handleChange(params)
      }
    }
  })

  ws.addEventListener('message', ev => {
    const text = utf8.stringify(new Uint8Array(ev.data as ArrayBuffer))
    codec.handleMessage(text)
  })

  ws.addEventListener('close', () => {
    out.connected = false
    codec.handleClose()
    callbacks.handleClose()
  })

  ws.addEventListener('error', () => ws.close())
  ws.addEventListener('open', () => {
    out.connected = true
    callbacks.handleConnect()
  })

  const out: ChangeServerConnection = {
    async subscribe(params) {
      return await codec.remoteMethods.subscribe(params)
    },

    async unsubscribe(params) {
      await codec.remoteMethods.unsubscribe(params)
    },

    close() {
      ws.close()
    },

    connected: false
  }
  return out
}
