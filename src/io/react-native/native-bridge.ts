interface NativeMethods {
  diskletDelete: (path: string) => Promise<void>
  diskletGetData: (path: string) => Promise<string> // base64
  diskletGetText: (path: string) => Promise<string>
  diskletList: (path: string) => Promise<{ [path: string]: 'file' | 'folder' }>
  diskletSetData: (path: string, data64: string) => Promise<void>
  diskletSetText: (path: string, text: string) => Promise<void>

  randomBytes: (size: number) => Promise<string> // base64

  scrypt: (
    data64: string,
    salt64: string,
    n: number,
    r: number,
    p: number,
    dklen: number
  ) => Promise<string> // base64
}

export interface NativeBridge {
  call: <Name extends keyof NativeMethods>(
    name: Name,
    ...args: Parameters<NativeMethods[Name]>
  ) => ReturnType<NativeMethods[Name]>

  // The native code uses this method to pass return values.
  resolve: (id: number, value: unknown) => void

  // The native code uses this method if a call fails.
  reject: (id: number, message: string) => void
}

export function makeNativeBridge(
  doCall: (id: number, name: string, args: unknown[]) => void
): NativeBridge {
  const list = makePendingList()
  return {
    call(name, ...args) {
      const promise = new Promise((resolve, reject) => {
        doCall(list.add({ resolve, reject }), name, args)
      })
      // TypeScript can't check our Java / Swift return values:
      return promise as any
    },
    resolve(id, value) {
      list.grab(id).resolve(value)
    },
    reject(id, message) {
      list.grab(id).reject(new Error(message))
    }
  }
}

/**
 * A pending call into native code.
 */
interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Maintains a list of pending native calls.
 */
interface PendingList {
  add: (call: PendingCall) => number
  grab: (id: number) => PendingCall
}

function makePendingList(): PendingList {
  const dummyCall: PendingCall = { resolve() {}, reject() {} }
  let lastId: number = 0

  if (typeof Map !== 'undefined') {
    // Better map-based version:
    const map = new Map()
    return {
      add(call) {
        const id = ++lastId
        map.set(id, call)
        return id
      },
      grab(id) {
        const call = map.get(id)
        if (call == null) return dummyCall
        map.delete(id)
        return call
      }
    }
  }

  // Slower object-based version:
  const map: { [id: string]: PendingCall } = {}
  return {
    add(call) {
      const id = ++lastId
      map[String(id)] = call
      return id
    },
    grab(id) {
      const call = map[String(id)]
      if (call == null) return dummyCall
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete map[String(id)]
      return call
    }
  }
}
