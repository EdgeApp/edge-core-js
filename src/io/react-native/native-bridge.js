// @flow

export type NativeBridge = {
  call(name: string, ...args: mixed[]): Promise<any>,

  // The native code uses this method to pass return values.
  resolve: (id: number, value: mixed) => void,

  // The native code uses this method if a call fails.
  reject: (id: number, message: string) => void
}

export function makeNativeBridge(
  doCall: (id: number, name: string, args: mixed[]) => void
): NativeBridge {
  const list = makePendingList()
  return {
    call(name, ...args) {
      return new Promise((resolve, reject) => {
        doCall(list.add({ resolve, reject }), name, args)
      })
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
type PendingCall = {
  resolve: (value: mixed) => void,
  reject: (error: Error) => void
}

/**
 * Maintains a list of pending native calls.
 */
type PendingList = {
  add(call: PendingCall): number,
  grab(id: number): PendingCall
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
      delete map[String(id)]
      return call
    }
  }
}
