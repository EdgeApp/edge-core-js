import {
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asUnknown,
  asValue,
  Cleaner,
  uncleaner
} from 'cleaners'

/**
 * A codec object can make calls to the remote system,
 * and can process incoming messages from the remote system.
 */
export interface RpcCodec<RemoteMethods> {
  /** Cancels all pending method calls if the connection closes. */
  handleClose: () => void

  /** Processes an incoming message from the remote side. */
  handleMessage: (message: string) => void

  /** Call these methods to send messages to the remote side. */
  remoteMethods: RemoteMethods
}

/**
 * To construct a codec, provide a way to send outgoing messages,
 * and implementations of any methods our side supports.
 */
export interface RpcCodecOpts<LocalMethods> {
  /** Called if `handleSend` fails. */
  handleError: (error: unknown) => void

  /** Sends a message to the remote side. */
  handleSend: (text: string) => Promise<void>

  /** Implement any messages this side supports receiving. */
  localMethods: LocalMethods
}

/**
 * The protocol object can construct client and server instances,
 * depending on which side you want to be.
 */
export interface RpcProtocol<ServerMethods, ClientMethods> {
  makeServerCodec: (
    opts: RpcCodecOpts<ServerMethods>
  ) => RpcCodec<ClientMethods>

  makeClientCodec: (
    opts: RpcCodecOpts<ClientMethods>
  ) => RpcCodec<ServerMethods>
}

/**
 * Type definitions for remote methods.
 *
 * For example:
 * ```
 * {
 *   method: { asParams: asTuple(asString, asNumber), asResult: asString }
 *   notification: { asParams: asTuple(asString, asNumber) }
 * }
 * ```
 */
interface MethodCleaners {
  [name: string]: {
    asParams: Cleaner<unknown>

    /** Cleans the method return value. Not present for notifications. */
    asResult?: Cleaner<unknown>
  }
}

interface RpcProtocolOpts<
  ServerCleaners extends MethodCleaners,
  ClientCleaners extends MethodCleaners
> {
  /**
   * Methods supported on the server side.
   */
  serverMethods: ServerCleaners

  /**
   * Methods supported on the client side.
   */
  clientMethods: ClientCleaners

  /**
   * Optionally used if the protocol differs from strict JSON-RPC 2.0.
   */
  asCall?: Cleaner<JsonRpcCall>
  asReturn?: Cleaner<JsonRpcReturn>

  /**
   * Optionally allow multiple returns for subscriptions (default `false`).
   */
  allowMultipleReturns?: boolean
}

/**
 * Accepts cleaners for the two sides of a protocol,
 * and returns a codec factory.
 */
export function makeRpcProtocol<
  ServerCleaners extends MethodCleaners,
  ClientCleaners extends MethodCleaners
>(
  opts: RpcProtocolOpts<ServerCleaners, ClientCleaners>
): RpcProtocol<Methods<ServerCleaners>, Methods<ClientCleaners>> {
  const {
    serverMethods,
    clientMethods,
    asCall = asJsonRpcCall,
    asReturn = asJsonRpcReturn,
    allowMultipleReturns = false
  } = opts

  return {
    makeServerCodec(opts) {
      return makeCodec(
        serverMethods,
        clientMethods,
        asCall,
        asReturn,
        allowMultipleReturns,
        opts
      )
    },
    makeClientCodec(opts) {
      return makeCodec(
        clientMethods,
        serverMethods,
        asCall,
        asReturn,
        allowMultipleReturns,
        opts
      )
    }
  }
}

type Methods<T> = {
  // Normal methods with return values:
  [Name in keyof T]: T[Name] extends {
    asParams: Cleaner<infer P>
    asResult: Cleaner<infer R>
  }
    ? (params: P) => Promise<R>
    : // Notifications, which have no return value:
    T[Name] extends {
        asParams: Cleaner<infer P>
      }
    ? (params: P) => void
    : // This should never happen:
      never
}

function makeCodec(
  localCleaners: MethodCleaners,
  remoteCleaners: MethodCleaners,
  asCall: Cleaner<JsonRpcCall>,
  asReturn: Cleaner<JsonRpcReturn>,
  allowMultipleReturns: boolean,
  opts: RpcCodecOpts<any>
): RpcCodec<any> {
  const { handleError, handleSend, localMethods } = opts
  const wasCall = uncleaner(asCall)
  const wasReturn = uncleaner(asReturn)

  const sendError = async (
    code: number,
    message: string,
    id: RpcId = null
  ): Promise<void> => {
    const payload = wasReturn({
      jsonrpc: '2.0',
      result: undefined,
      error: { code, message, data: undefined },
      id
    })
    return await handleSend(JSON.stringify(payload))
  }

  // Remote state:
  let nextRemoteId = 0
  const remoteCalls = new Map<number, PendingRemoteCall>()
  const remoteSubscriptions = new Map<number | string, string>()

  // Create proxy functions for each remote method:
  const remoteMethods: {
    [name: string]: (params: unknown) => unknown
  } = {}
  for (const methodName of Object.keys(remoteCleaners)) {
    const { asParams, asResult } = remoteCleaners[methodName]
    const wasParams = uncleaner(asParams)

    if (asResult == null) {
      // It's a notification, so send the message with no result handling:
      remoteMethods[methodName] = (params: unknown): void => {
        const payload = wasCall({
          jsonrpc: '2.0',
          method: methodName,
          params: wasParams(params)
        })
        handleSend(JSON.stringify(payload)).catch(handleError)
      }
    } else {
      // It's a method call, so sign up to receive a result:
      remoteMethods[methodName] = (params: unknown): unknown => {
        const id = nextRemoteId++
        const out = new Promise<unknown>((resolve, reject) => {
          remoteCalls.set(id, {
            asResult,
            resolve,
            reject
          })
        })

        // This is a subscription request:
        if (
          allowMultipleReturns &&
          localCleaners[methodName] != null &&
          localCleaners[methodName].asResult == null
        ) {
          // Keep track of the remote method name to send notifications
          remoteSubscriptions.set(id, methodName)
        }

        const request = wasCall({
          jsonrpc: '2.0',
          method: methodName,
          params: wasParams(params),
          id
        })
        handleSend(JSON.stringify(request)).catch(handleError)

        return out
      }
    }
  }

  function handleMessage(message: string): void {
    let json: unknown
    try {
      json = JSON.parse(message)
    } catch (error) {
      sendError(-32700, `Parse error: ${errorMessage(error)}`).catch(
        handleError
      )
      return
    }

    // TODO: We need to add support for batch calls.
    const call = asMaybe(asCall)(json)
    const response = asMaybe(asReturn)(json)

    if (call != null) {
      const cleaners = localCleaners[call.method]
      if (cleaners == null) {
        sendError(-32601, `Method not found: ${call.method}`).catch(handleError)
        return
      }

      if (cleaners.asResult != null && call.id == null) {
        sendError(-32600, `Invalid JSON-RPC request: missing id`).catch(
          handleError
        )
        return
      }

      if (cleaners.asResult == null && call.id != null) {
        sendError(
          -32600,
          `Invalid JSON-RPC request: notification has an id`
        ).catch(handleError)
        return
      }

      let cleanParams: unknown
      try {
        cleanParams = cleaners.asParams(call.params)
      } catch (error) {
        sendError(-32602, `Invalid params: ${errorMessage(error)}`).catch(
          handleError
        )
        return
      }

      const out = localMethods[call.method](cleanParams)
      if (cleaners.asResult != null && out?.then != null) {
        const wasResult = uncleaner(cleaners.asResult)
        out.then(
          (result: unknown) => {
            const response = wasReturn({
              jsonrpc: '2.0',
              result: wasResult(result),
              error: undefined,
              id: call.id ?? null
            })
            handleSend(JSON.stringify(response)).catch(handleError)
          },
          (error: unknown) => {
            sendError(1, errorMessage(error), call.id).catch(handleError)
          }
        )
      }
    } else if (response != null) {
      const { error, id, result } = response
      if (typeof id !== 'number') {
        // It's not a call we made...
        sendError(-32603, `Cannot find id ${String(id)}`, id).catch(handleError)
        return
      }
      const pendingCall = remoteCalls.get(id)

      // Handle subscription calls masquerading as returns:
      if (pendingCall == null) {
        const methodName = remoteSubscriptions.get(id)
        if (methodName == null) {
          sendError(-32603, `Cannot find id ${String(id)}`, id).catch(
            handleError
          )
          return
        }

        let cleanParams: unknown
        try {
          cleanParams = localCleaners[methodName].asParams(result)
        } catch (error) {
          sendError(-32602, `Invalid params: ${errorMessage(error)}`).catch(
            handleError
          )
          return
        }
        localMethods[methodName](cleanParams)
        return
      }
      remoteCalls.delete(id)

      if (error != null) {
        pendingCall.reject(new Error(error.message))
      } else {
        const { asResult } = pendingCall
        let cleanResult: unknown
        try {
          cleanResult = asResult(result)
        } catch (error) {
          pendingCall.reject(error)
        }
        pendingCall.resolve(cleanResult)
      }
    } else {
      sendError(-32600, `Invalid JSON-RPC request / response`).catch(
        handleError
      )
    }
  }

  function handleClose(): void {
    for (const call of remoteCalls.values()) {
      call.reject(new Error('JSON-RPC connection closed'))
    }
  }

  return {
    handleClose,
    handleMessage,
    remoteMethods: remoteMethods as any
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PendingRemoteCall {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
  asResult: Cleaner<unknown>
}

type RpcId = number | string | null

export interface JsonRpcCall {
  jsonrpc: '2.0'
  method: string
  params: unknown
  id?: RpcId // Missing for notifications
}

export interface JsonRpcReturn {
  jsonrpc: '2.0'
  result: unknown
  error?: { code: number; message: string; data?: unknown }
  id: RpcId // Null for protocol errors
}

const asRpcId = (raw: unknown): RpcId => {
  if (raw === null) return raw
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  throw new TypeError('Expected a string or an integer')
}

export const asJsonRpcCall = asObject<JsonRpcCall>({
  jsonrpc: asValue('2.0'),
  method: asString,
  params: asUnknown,
  id: asOptional(asRpcId)
})

export const asJsonRpcReturn = asObject<JsonRpcReturn>({
  jsonrpc: asValue('2.0'),
  result: asUnknown,
  error: asOptional(
    asObject({
      code: asNumber,
      message: asString,
      data: asUnknown
    })
  ),
  id: asRpcId
})
