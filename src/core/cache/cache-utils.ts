import { bridgifyObject } from 'yaob'

import { EdgeOtherMethods } from '../../types/types'

/** How often to poll for a real object (ms) */
const POLL_INTERVAL_MS = 300

/** Maximum time to wait for a real object before timing out (ms) */
const MAX_WAIT_MS = 60000

/**
 * Creates a shared poller that waits for a real object to become available.
 * Uses a single shared promise so multiple callers don't spawn independent
 * polling loops. Returns both `tryGet` (synchronous check) and `waitFor`
 * (async wait with timeout).
 */
export function makeRealObjectPoller<T>(
  getter: () => T | undefined,
  label: string
): {
  tryGet: () => T | undefined
  waitFor: () => Promise<T>
} {
  let sharedPromise: Promise<T> | undefined

  function tryGet(): T | undefined {
    return getter()
  }

  function waitFor(): Promise<T> {
    // Fast path: already available
    const immediate = tryGet()
    if (immediate != null) return Promise.resolve(immediate)

    // Reuse shared promise so all callers share one poll loop
    if (sharedPromise != null) return sharedPromise

    sharedPromise = new Promise((resolve, reject) => {
      const startTime = Date.now()
      let timeoutId: ReturnType<typeof setTimeout> | undefined

      const cleanup = (): void => {
        if (timeoutId != null) {
          clearTimeout(timeoutId)
          timeoutId = undefined
        }
      }

      const check = (): void => {
        try {
          const real = tryGet()
          if (real != null) {
            cleanup()
            resolve(real)
            return
          }

          if (Date.now() - startTime > MAX_WAIT_MS) {
            cleanup()
            sharedPromise = undefined
            reject(
              new Error(`Timed out waiting for ${label} after ${MAX_WAIT_MS}ms`)
            )
            return
          }

          timeoutId = setTimeout(check, POLL_INTERVAL_MS)
        } catch (error) {
          cleanup()
          sharedPromise = undefined
          reject(error)
        }
      }

      timeoutId = setTimeout(check, POLL_INTERVAL_MS)
    })

    return sharedPromise
  }

  return { tryGet, waitFor }
}

/**
 * Helper to create delegating otherMethods that wait for the real object.
 * Creates explicit functions for known method names only.
 * Methods not in the cache will be undefined until the real object loads.
 * GUI code should check if methods exist before calling them, or wait for real object.
 *
 * @param methodNames - Array of method names to create delegating stubs for
 * @param getRealOtherMethods - Callback to get real otherMethods if available
 * @param waitForReal - Async function that waits for and returns the real object
 * @param bridgify - If true, calls bridgifyObject on the result (needed for wallets)
 */
export function createDelegatingOtherMethods<
  T extends { otherMethods: EdgeOtherMethods }
>(
  methodNames: string[],
  getRealOtherMethods: () => EdgeOtherMethods | undefined,
  waitForReal: () => Promise<T>,
  bridgify: boolean = false
): EdgeOtherMethods {
  // If no method names cached, check if real methods are immediately available
  // If not, return empty object (GUI should check method existence)
  if (methodNames.length === 0) {
    const immediate = getRealOtherMethods()
    if (immediate != null) return immediate
    return {}
  }

  const otherMethods: { [name: string]: unknown } = {}

  // Create explicit methods for all cached method names
  for (const methodName of methodNames) {
    otherMethods[methodName] = async (...args: unknown[]) => {
      // First check if real methods are already available
      const immediate = getRealOtherMethods()
      if (immediate != null && typeof immediate[methodName] === 'function') {
        return immediate[methodName](...args)
      }

      // Wait for real wallet/config to load
      const real = await waitForReal()
      if (typeof real.otherMethods[methodName] !== 'function') {
        throw new Error(`Method ${methodName} not available on real object`)
      }
      return real.otherMethods[methodName](...args)
    }
  }

  // Mark the otherMethods object itself as bridgeable (like real wallets do)
  // This prevents yaob from trying to serialize individual function properties
  if (bridgify) {
    bridgifyObject(otherMethods)
  }

  return otherMethods as EdgeOtherMethods
}
